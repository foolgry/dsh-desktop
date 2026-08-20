/**
 * Safe-mode recovery for plugin-induced boot failures. When `dsh web` dies
 * before readiness, the loader's error usually names the plugin at fault
 * ("failed to apply loader entry …" for apply-time crashes, "cannot resolve
 * profile bundle …" for missing files). This module parses that signal out
 * of the child log and applies the minimal reversible fix:
 *
 *  1. `disableEntry` — append an `id`/`disabled: true` row to the profile's
 *     `cordis.patch.yml`, the same mechanism the plugin marketplace's own
 *     "disable" toggle writes, so the user can re-enable from the UI.
 *  2. `removeBundle` — drop a package from the profile manifest's
 *     `dsh.profile.bundles` list, for crashes that happen before patches
 *     apply (bundle resolution runs first).
 *  3. `enterFullSafeMode` — back up both user patch layers and strip every
 *     non-built-in bundle, guaranteeing a plugin-free boot.
 *
 * Every mutation is recorded in `safe-mode.json` under userData so the tray
 * menu can offer a one-click restore later.
 * @module dsh-desktop/safe-mode
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** How much of the child log's tail to scan for the crash signature. */
const LOG_SCAN_BYTES = 128 * 1024

/** One reversible mutation applied during recovery. */
export type RecoveryAction =
  | { type: 'disable-entry'; entryId: string; block: string }
  | { type: 'remove-bundle'; packageName: string }
  | FullSafeModeAction

/** The full safe-mode strip, recorded for restore. */
export interface FullSafeModeAction {
  type: 'full-safe-mode'
  removedBundles: string[]
  patchBackup: boolean
  homePatchBackup: boolean
}

/** The plugin the loader blames for the latest crash. */
export type Culprit =
  | { kind: 'apply'; entryId: string; packageName: string }
  | { kind: 'unresolvable'; packageName: string }

/**
 * Read the portion of the log belonging to the most recent boot attempt —
 * everything after the last "dsh web starting" marker. Old crashes stay in
 * the file forever, so scanning without this anchor would keep blaming a
 * plugin that was already dealt with.
 * @param logPath - the dsh child log
 * @returns the last attempt's output (capped at {@link LOG_SCAN_BYTES})
 */
export function readLastAttemptLog(logPath: string): string {
  if (!existsSync(logPath)) return ''
  const content = readFileSync(logPath, 'utf8')
  const tail = content.slice(-LOG_SCAN_BYTES)
  const marker = tail.lastIndexOf('=== dsh web starting')
  return marker === -1 ? tail : tail.slice(marker)
}

/**
 * Find the plugin responsible for the crash in one attempt's log output.
 * Apply-time loader errors name both the entry id and the package; bundle
 * resolution errors name only the package. The last match wins — a nested
 * `[cause]` chain repeats the message, and the innermost frame is the
 * specific one.
 * @param attemptLog - output of one boot attempt (see {@link readLastAttemptLog})
 * @returns the culprit, or `undefined` when the crash is not attributable
 */
export function findCulprit(attemptLog: string): Culprit | undefined {
  const apply = /failed to (?:apply|import) loader entry ([^\s(]+) \(([^)]+)\)/g
  let culprit: Culprit | undefined
  for (const match of attemptLog.matchAll(apply)) {
    culprit = { kind: 'apply', entryId: match[1], packageName: match[2] }
  }
  const unresolvable = /cannot resolve profile bundle "([^"]+)"/g
  for (const match of attemptLog.matchAll(unresolvable)) {
    culprit = { kind: 'unresolvable', packageName: match[1] }
  }
  return culprit
}

/**
 * Whether the patch file already carries a `disabled: true` row for
 * `entryId`. Scans row by row rather than matching the id anywhere — an
 * `insert` block mentions the same id without disabling it.
 */
function hasDisableRow(content: string, entryId: string): boolean {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== `- id: ${entryId}`) continue
    for (let j = i + 1; j < lines.length && !lines[j].startsWith('- '); j++) {
      if (lines[j].trim() === 'disabled: true') return true
    }
  }
  return false
}

/**
 * Append a disable row for `entryId` to the profile's patch layer. The file
 * ships as a top-level flow-style `[]`, which a block-style row cannot
 * follow, so a bare `[]` line is replaced rather than appended to. A
 * disable row for the same entry is never duplicated.
 * @param patchPath - the profile's `cordis.patch.yml`
 * @param entryId - loader entry id to disable
 * @returns the exact YAML block written (for later restore), or `undefined`
 *   when the entry is already disabled
 */
export function disableEntry(patchPath: string, entryId: string): string | undefined {
  const block = `- id: ${entryId}\n  disabled: true\n`
  const content = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  if (hasDisableRow(content, entryId)) return undefined
  const lines = content.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length > 0 && lines[lines.length - 1].trim() === '[]') lines.pop()
  const head = lines.join('\n').trimEnd()
  writeFileSync(patchPath, (head === '' ? '' : `${head}\n`) + block, 'utf8')
  return block
}

/** Profile manifest shape (the parts recovery touches). */
interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function readManifest(manifestPath: string): ProfileManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
}

function writeManifest(manifestPath: string, manifest: ProfileManifest): void {
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
}

/**
 * Drop `packageName` from the profile manifest's `dsh.profile.bundles`.
 * Used when the package's files are missing or unloadable: bundle
 * resolution runs before any patch layer, so a `disabled: true` row cannot
 * save a plugin that fails this early. The `dependencies` entry is kept on
 * purpose — the package stays installed, only its boot-time loading stops.
 * @param manifestPath - the profile's `package.json`
 * @param packageName - bundle to remove
 * @returns whether the bundle list actually changed
 */
export function removeBundle(manifestPath: string, packageName: string): boolean {
  const manifest = readManifest(manifestPath)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(packageName)) return false
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles: bundles.filter((name) => name !== packageName) },
  }
  writeManifest(manifestPath, manifest)
  return true
}

/**
 * Strip everything user-modifiable from the profile: both patch layers are
 * renamed aside (fresh `[]` left in place) and every bundle outside
 * `builtinBundles` is removed from the manifest. Missing pieces are skipped,
 * so this is safe to call on a half-initialized profile.
 * @param homeDir - `$DSH_HOME` (holds the home-level patch layer)
 * @param profileDir - the web profile directory
 * @param builtinBundles - bundle names that must never be stripped
 * @returns the recorded action for later restore
 */
export function enterFullSafeMode(homeDir: string, profileDir: string, builtinBundles: string[]): FullSafeModeAction {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const patchBackup = existsSync(patchPath)
  if (patchBackup) {
    renameSync(patchPath, `${patchPath}.safe-backup`)
    writeFileSync(patchPath, '[]\n', 'utf8')
  }
  const homePatchPath = join(homeDir, 'cordis.patch.yml')
  const homePatchBackup = existsSync(homePatchPath)
  if (homePatchBackup) renameSync(homePatchPath, `${homePatchPath}.safe-backup`)
  const manifestPath = join(profileDir, 'package.json')
  const removedBundles: string[] = []
  if (existsSync(manifestPath)) {
    const manifest = readManifest(manifestPath)
    const bundles = manifest.dsh?.profile?.bundles ?? []
    for (const name of bundles) {
      if (!builtinBundles.includes(name)) removedBundles.push(name)
    }
    if (removedBundles.length > 0) {
      manifest.dsh = {
        ...manifest.dsh,
        profile: { ...manifest.dsh?.profile, bundles: bundles.filter((name) => builtinBundles.includes(name)) },
      }
      writeManifest(manifestPath, manifest)
    }
  }
  return { type: 'full-safe-mode', removedBundles, patchBackup, homePatchBackup }
}

/**
 * Read the recorded recovery actions.
 * @param statePath - `safe-mode.json` under userData
 * @returns every action applied so far, oldest first
 */
export function loadRecoveryActions(statePath: string): RecoveryAction[] {
  if (!existsSync(statePath)) return []
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as { actions?: RecoveryAction[] }
    return Array.isArray(parsed.actions) ? parsed.actions : []
  } catch {
    return []
  }
}

/**
 * Append an action to the recovery record.
 * @param statePath - `safe-mode.json` under userData
 * @param action - the mutation just applied
 */
export function recordRecoveryAction(statePath: string, action: RecoveryAction): void {
  const actions = loadRecoveryActions(statePath)
  actions.push(action)
  writeFileSync(statePath, JSON.stringify({ actions }, undefined, 2) + '\n', 'utf8')
}

/**
 * Undo every recorded recovery action, newest first, then delete the state
 * file. Individual reversals are best-effort: if the user already
 * re-enabled a plugin from the marketplace (rewriting the patch file in the
 * process), the missing block is simply skipped.
 * @param statePath - `safe-mode.json` under userData
 * @param homeDir - `$DSH_HOME`
 * @param profileDir - the web profile directory
 */
export function restoreAll(statePath: string, homeDir: string, profileDir: string): void {
  const actions = loadRecoveryActions(statePath)
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const manifestPath = join(profileDir, 'package.json')
  for (const action of [...actions].reverse()) {
    try {
      if (action.type === 'disable-entry') {
        if (!existsSync(patchPath)) continue
        const content = readFileSync(patchPath, 'utf8')
        if (content.includes(action.block)) {
          writeFileSync(patchPath, content.replace(action.block, ''), 'utf8')
        }
      } else if (action.type === 'remove-bundle') {
        const manifest = readManifest(manifestPath)
        const bundles = manifest.dsh?.profile?.bundles ?? []
        if (!bundles.includes(action.packageName)) {
          manifest.dsh = {
            ...manifest.dsh,
            profile: { ...manifest.dsh?.profile, bundles: [...bundles, action.packageName] },
          }
          writeManifest(manifestPath, manifest)
        }
      } else {
        if (existsSync(manifestPath) && action.removedBundles.length > 0) {
          const manifest = readManifest(manifestPath)
          const bundles = manifest.dsh?.profile?.bundles ?? []
          const restored = [...bundles]
          for (const name of action.removedBundles) {
            if (!restored.includes(name)) restored.push(name)
          }
          manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: restored } }
          writeManifest(manifestPath, manifest)
        }
        if (action.patchBackup && existsSync(`${patchPath}.safe-backup`)) {
          renameSync(`${patchPath}.safe-backup`, patchPath)
        }
        const homePatchPath = join(homeDir, 'cordis.patch.yml')
        if (action.homePatchBackup && existsSync(`${homePatchPath}.safe-backup`)) {
          renameSync(`${homePatchPath}.safe-backup`, homePatchPath)
        }
      }
    } catch {
      // a single failed reversal must not strand the rest of the restore
    }
  }
  rmSync(statePath, { force: true })
}
