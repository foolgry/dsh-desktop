/**
 * DSH Desktop main process: boots `dsh web` on the first free loopback port
 * (3080 upward) with Electron's embedded Node, waits for readiness, then loads
 * the UI in a single BrowserWindow. Owns the child process lifecycle, log
 * capture, navigation guards, and auto-updates.
 * @module dsh-desktop/main
 */

import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, screen, shell } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import type { Rectangle } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { delimiter, dirname, join } from 'node:path'
import {
  disableEntry,
  enterFullSafeMode,
  findCulprit,
  loadRecoveryActions,
  readLastAttemptLog,
  recordRecoveryAction,
  removeBundle,
  restoreAll,
} from './safe-mode.js'

/** First port tried for the dsh web server. */
const FIRST_PORT = 3080
/** Last port tried before giving up. */
const LAST_PORT = 3099
/** How long to wait for the server to answer before declaring boot failure. */
const READY_TIMEOUT_MS = 60_000
/** Release page used as the manual-download fallback when auto-update fails. */
const RELEASES_URL = 'https://github.com/foolgry/dsh-desktop/releases'

/**
 * 36×36 tray icon (whale with padding), embedded as a data URL
 * so the packaged app needs no extra resource files — electron-builder only
 * ships `dist/` and `node_modules/`. Regenerate from `build/icon.png` with:
 * `magick build/icon.png -trim +repage -resize 30x30 -gravity center -background none -extent 36x36`
 */
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAMAAADW3miqAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAHvUExURQAAAE1r/kJn/1Bt/01r/01q/U1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/gAAAIw+fZsAAACjdFJOUwAAAAAAABtQemMJjGAFMGaJmJR+j9H2bgQSvyICJCyh6+EeH9hpAw4XattD/BkW1fJlisr65i/awfSeC6rQMznk11LzMk/f/cg/qc7W7dNFpPuiWD0PMWi39eq74+ziOPnpKE3ExUY3wOgp95awNibLEHgIiElezL0Kn1OQSPgVQu6zDEvwZKhzE4fndBG173YN1Lk1JbbJ4CedizSlgi0HxoXQznh8AAAAAWJLR0QAiAUdSAAAAAd0SU1FB+oIDgYlI+W9c5EAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDgtMTRUMDE6MDc6MTQrMDA6MDAj9EBCAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA4LTE0VDAxOjA3OjE0KzAwOjAwUqn4/gAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wOC0xNFQwNjozNzozNSswMDowMAV/tbEAAAHaSURBVDjLY2AYBWDACAds7BycXECamwdIgCWQ1PDy8QsICgmLiIqJiUswMkqKSkmDNcnIItTIySsshgJFJSBfWXGxiqoak7qGphZckbbKYjjQEdRlZNTTX7zYwNDIWMXEFKbIzHwxMrAwY1STB9KWII4VVJG1zWJUYGvHaO8AYTryQRU5OS9GV+XC6OoGpN09PGG+81rs4O3ji6LKz18tYHFgULAGPAgUFUJC9cLCIyIhCqKiYxYvjg2IW2wZz4gIp4TEJBCPKzkFrCg1LT0DzMjMQgQlQ2C2PyS4NXICgXLmuXn5PiBFBYUINQy+i4ugUVBcorN4sVhiKWOZCVCRIDOSovLFFdZQVZVVICOi08SB7jOpRrKNoWaxZS2Yz8LIqFQAUlUHsragHllRQ+PipmagANhdLa3QUAhsY2RFSijF7YsDO0AKijuB0d4FVeTVjGwQA2N69+LGMqAiT+OeXsbOPkhASKOoAVqjmb24f8JERt1JiydPYZzqAVQTySPDiGoSIy+H2GKdaWUt0xcvnsHDNXMyKCRtGtCNkuAHxrp7Asie7AyRWVJ+sc79s2VQFIH8NWduIyx2Tefp1c/Py7JGNQmsakGDkGhrYHbmwkVh8GxBn2w4FAAA8TPI0GQOSlEAAAAASUVORK5CYII='

/** Directory holding dsh's own state (profiles, sessions), inside userData. */
function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
}

/** The web profile directory, where user-installed plugins are registered. */
function webProfileDir(): string {
  return join(dshHome(), 'profiles', 'web')
}

/** Recovery-action record consumed by the tray's restore menu item. */
function safeModeStateFile(): string {
  return join(app.getPath('userData'), 'safe-mode.json')
}

/** File that receives the dsh child's stdout and stderr. */
function logFile(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'dsh.log')
}

/**
 * Resolve the published CLI entry. The package has no `exports` map, so the
 * subpath resolves directly; in a packaged app the file lives in
 * `app.asar.unpacked`, which spawn can execute.
 * @returns absolute path to `@deepseek-ai/dsh/lib/bin.js`
 */
function dshBin(): string {
  const require = createRequire(import.meta.url)
  const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  return bin.includes('app.asar')
    ? bin.replace('app.asar', 'app.asar.unpacked')
    : bin
}

/**
 * Overlay that swaps the native OS folder dialog for the in-app file-tree
 * picker. The native picker (`directory-picker-auto` → `-native` on win32/darwin)
 * loads `koffi.node`; its prebuilt win32-x64 binary throws a NAPI fatal error
 * under Electron's embedded Node ABI, so the dialog worker dies before
 * reporting a result (issue #1). macOS uses `osascript` and Linux uses
 * `zenity`/`kdialog`, neither of which touches koffi, so this is win32-only.
 *
 * Disabling `-auto` and mounting both the browse backend and its UI surface
 * mirrors exactly what `-auto` does on its own `browse` branch.
 */
const BROWSE_PICKER_PATCH = `# Force the in-app file-tree picker (pure node:fs) instead of the native OS
# dialog. The native picker's koffi.node crashes under Electron's embedded Node
# ABI on win32 — see https://github.com/foolgry/dsh-desktop/issues/1
- id: directory-picker
  disabled: true

- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-client
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/**
 * On win32, persist the browse-picker overlay into userData and return its
 * path so it can be passed to `dsh web --patch`. Returns `undefined` on every
 * other platform, leaving the native picker (and its better UX) intact.
 * @returns path to the overlay file, or `undefined` when no override is needed
 */
function ensurePickerFallbackPatch(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const file = join(app.getPath('userData'), 'picker-browse-fallback.yml')
  writeFileSync(file, BROWSE_PICKER_PATCH, 'utf8')
  return file
}

/**
 * Plugins the desktop build presets into the web profile. They ship as regular
 * app dependencies (hoisted, asar-unpacked), so presetting needs no pnpm and
 * no network on the user's machine — the exact state `dsh plugin --profile
 * web add <name>` would produce, minus the registry round-trip.
 */
const PRESET_PLUGINS = ['dshmarket']

/**
 * The web profile's shipped bundle template. Must stay in sync with
 * `PROFILE_TEMPLATES.web` in @deepseek-ai/dsh-app-boot — the profile we
 * pre-create replaces the one `dsh web` would auto-initialize on first boot.
 */
const WEB_PROFILE_TEMPLATE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** Marker recording that the preset plugins were already applied. */
function presetMarkerFile(): string {
  return join(dshHome(), '.bundled-plugins-preset')
}

/** Profile manifest shape (the parts presetting touches). */
interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** dsh's profile patch-layer template (mirrors initProfile in dsh-app-boot). */
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

/** dsh's profile pnpm settings template (mirrors initProfile in dsh-app-boot). */
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * Resolve a bundled plugin's directory inside this installation. Same
 * require.resolve + asar-unpacked rewrite as {@link dshBin}; the plugin ships
 * in the app's hoisted node_modules, which the parent-walk from dist/main.js
 * reaches in both dev and packaged runs.
 * @param name - the plugin's package name
 * @returns the plugin's absolute package directory
 */
function bundledPluginDir(name: string): string {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve(`${name}/package.json`)
  const real = manifest.includes('app.asar')
    ? manifest.replace('app.asar', 'app.asar.unpacked')
    : manifest
  return dirname(real)
}

/**
 * Ensure `link` is a symlink to `target` (junction on win32, like dsh's own
 * fallback healer). A path occupied by anything other than our symlink is
 * left alone — something else owns the name, and resolution through it works.
 * @param link - the symlink path to maintain
 * @param target - the absolute directory it should point at
 */
function ensurePluginSymlink(link: string, target: string): void {
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    stat = undefined
  }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) return
    if (readlinkSync(link) === target) return
    unlinkSync(link)
  }
  symlinkSync(target, link, 'junction')
}

/**
 * Preset {@link PRESET_PLUGINS} into the web profile before `dsh web` boots:
 * append each to `dsh.profile.bundles` (with a `dependencies` entry, matching
 * what `dsh plugin add` reconciles) and link it into the flat module fallback
 * `$DSH_HOME/profiles/node_modules`. The fallback link is required: dsh's
 * healProfilesModuleFallback only links packages from the dsh app's own
 * dependency closure, which preset plugins are not part of, while the Loader
 * imports every bundle by bare name from the profile directory.
 *
 * Runs at most once (marker file): a user who later removes a preset plugin
 * via `dsh plugin remove` keeps that choice. Failures are logged and never
 * block the app from booting.
 */
function presetBundledPlugins(): void {
  try {
    const marker = presetMarkerFile()
    if (existsSync(marker)) return
    const plugins = PRESET_PLUGINS.map((name) => {
      const dir = bundledPluginDir(name)
      const version = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
      return { name, dir, version }
    })
    const profileDir = join(dshHome(), 'profiles', 'web')
    const manifestPath = join(profileDir, 'package.json')
    mkdirSync(profileDir, { recursive: true })
    let manifest: ProfileManifest
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
    } else {
      // Pre-create what `dsh web`'s first-boot initProfile would, with the
      // preset plugins already layered in, so the profile is complete before
      // the child ever loads it.
      manifest = {
        name: 'dsh-profile-web',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: [...WEB_PROFILE_TEMPLATE] } },
      }
      const patchPath = join(profileDir, 'cordis.patch.yml')
      if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
      const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
      if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
    }
    const bundles = manifest.dsh?.profile?.bundles ?? []
    let changed = false
    for (const plugin of plugins) {
      if (!bundles.includes(plugin.name)) {
        bundles.push(plugin.name)
        changed = true
      }
      manifest.dependencies ??= {}
      if (manifest.dependencies[plugin.name] === undefined) {
        manifest.dependencies[plugin.name] = `^${plugin.version}`
        changed = true
      }
    }
    if (changed) {
      manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
      writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    }
    const fallbackDir = join(dshHome(), 'profiles', 'node_modules')
    mkdirSync(fallbackDir, { recursive: true })
    for (const plugin of plugins) ensurePluginSymlink(join(fallbackDir, plugin.name), plugin.dir)
    writeFileSync(marker, `${JSON.stringify(Object.fromEntries(plugins.map((p) => [p.name, p.version])), undefined, 2)}\n`)
    appendFileSync(logFile(), `=== preset bundled plugins: ${PRESET_PLUGINS.join(', ')} applied ===\n`)
  } catch (error) {
    appendFileSync(logFile(), `\n=== preset bundled plugins failed: ${error instanceof Error ? error.message : String(error)} ===\n`)
  }
}

/**
 * Probe one loopback port.
 * @param port - candidate port
 * @returns whether something could bind it right now
 */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/**
 * Pick the first bindable loopback port in the configured range.
 * @returns a free port
 */
async function pickPort(): Promise<number> {
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    if (await isFree(port)) return port
  }
  throw new Error(`no free loopback port between ${FIRST_PORT} and ${LAST_PORT}`)
}

/**
 * Standalone pnpm plus a `node` shim for in-app plugin installs. dshmarket
 * and `dsh plugin add` spawn `pnpm` by bare name (and package lifecycle
 * scripts spawn `node`), but GUI launches inherit a bare launchd PATH with
 * neither — the marketplace then fails with "cannot find Node". We ship
 * `@pnpm/exe` (a self-contained SEA binary, no system Node needed) and
 * prepend its dir to the dsh child's PATH; the POSIX node shim reuses the
 * same Electron binary dsh runs on, which also keeps native builds on the
 * ABI the runtime actually loads.
 * @returns PATH prefix (trailing delimiter included) for the child env
 */
function toolingPathPrefix(): string {
  try {
    const parts: string[] = []
    if (process.platform !== 'win32') {
      const shimDir = join(app.getPath('userData'), 'tooling-bin')
      mkdirSync(shimDir, { recursive: true })
      const nodeShim = join(shimDir, 'node')
      const script = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`
      if (!existsSync(nodeShim) || readFileSync(nodeShim, 'utf8') !== script) {
        writeFileSync(nodeShim, script, { mode: 0o755 })
      }
      chmodSync(nodeShim, 0o755)
      parts.push(shimDir)
    }
    const require = createRequire(import.meta.url)
    const pkgJson = require.resolve('@pnpm/exe/package.json')
    const real = pkgJson.includes('app.asar')
      ? pkgJson.replace('app.asar', 'app.asar.unpacked')
      : pkgJson
    const pnpmDir = dirname(real)
    // The published tarball ships the SEA binary without the exec bit, and
    // setup.js's hardlink does not add it — fix it here or spawn gets EACCES.
    try {
      chmodSync(join(pnpmDir, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'), 0o755)
    } catch {
      // read-only install location; the spawn error surfaces downstream
    }
    parts.push(pnpmDir)
    return parts.join(delimiter) + delimiter
  } catch (error) {
    appendFileSync(logFile(), `\n=== tooling setup failed: ${error instanceof Error ? error.message : String(error)} ===\n`)
    return ''
  }
}

/**
 * Spawn `dsh web --port <port>` under Electron's embedded Node
 * (`ELECTRON_RUN_AS_NODE`), so end users need no system Node. Output is
 * appended to the userData log.
 * @param port - the probed free port
 * @returns the running child
 */
function startDsh(port: number): ChildProcess {
  const log = logFile()
  appendFileSync(log, `\n=== dsh web starting on port ${port} at ${new Date().toISOString()} ===\n`)
  // --expose-internals is required by cordis-plugin-hmr's HMR service, which
  // ships in the base profile and reads Node internals unavailable by default.
  const args = ['--expose-internals', dshBin(), 'web']
  // The shell loads the UI in its own window; dsh's default behavior of
  // opening the system browser on top of that is a redundant tab per launch.
  args.push('--no-open')
  // win32: the native folder dialog's koffi.node crashes under Electron's ABI
  // (issue #1), so overlay the pure-JS browse picker instead. --patch must
  // come BEFORE --port: the web subcommand uses enablePositionalOptions() with
  // a greedy [args...], so once the unknown option --port starts being
  // collected as a positional, any later --patch is no longer parsed
  // (issue #2).
  const pickerPatch = ensurePickerFallbackPatch()
  if (pickerPatch) {
    args.push('--patch', pickerPatch)
    appendFileSync(log, `=== win32: using browse directory picker (native koffi crashes under Electron ABI; issue #1) ===\n`)
  }
  args.push('--port', String(port))
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      PATH: `${toolingPathPrefix()}${process.env.PATH ?? ''}`,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: dshHome(),
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => appendFileSync(log, chunk))
  child.stderr?.on('data', (chunk: Buffer) => appendFileSync(log, chunk))
  child.on('exit', (code, signal) =>
    appendFileSync(log, `\n=== dsh web exited (code ${code}, signal ${signal}) at ${new Date().toISOString()} ===\n`),
  )
  return child
}

/**
 * Poll the server until it answers HTTP or the child dies. Readiness requires
 * three consecutive OK answers: `dsh web` binds its port before the plugin
 * tree finishes loading, so a plugin crash lets the server answer for a
 * brief window (~50ms) and then exit — a single OK is not proof of life.
 * @param port - port the server was asked to bind
 * @param child - the dsh child, watched for early exit
 */
async function waitReady(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let stableAnswers = 0
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh exited with code ${child.exitCode} before becoming ready`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      if (res.ok) {
        stableAnswers++
        if (stableAnswers >= 3) return
      } else {
        stableAnswers = 0
      }
    } catch {
      // connection refused while the server is still booting; keep polling
      stableAnswers = 0
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`dsh did not answer on port ${port} within ${READY_TIMEOUT_MS / 1000}s`)
}

/**
 * Whale icon from `build/` for dev mode (`electron .` uses Electron's default
 * bundle icon, which leaks into the dock, window chrome, and dialogs).
 * Returns `undefined` when packaged — electron-builder bakes the real icon
 * into the bundle/exe there.
 */
function devIcon(): Electron.NativeImage | undefined {
  if (app.isPackaged) return undefined
  const file = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(file) ? nativeImage.createFromPath(file) : undefined
}

/** Persisted window geometry, restored on the next launch. */
interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/**
 * Read the last saved window geometry. A state is only honored when it is
 * plausibly sized and at least partially intersects some display's work area —
 * a window saved on a now-unplugged external monitor would otherwise restore
 * off-screen where the user cannot grab it.
 */
function loadWindowState(): WindowState | undefined {
  try {
    const saved = JSON.parse(readFileSync(windowStateFile(), 'utf8')) as Partial<WindowState>
    if (typeof saved.x !== 'number' || typeof saved.y !== 'number') return undefined
    if (typeof saved.width !== 'number' || typeof saved.height !== 'number') return undefined
    if (saved.width < 800 || saved.height < 600) return undefined
    const area = screen.getDisplayMatching(saved as Rectangle).workArea
    const visible =
      saved.x < area.x + area.width &&
      saved.y < area.y + area.height &&
      saved.x + saved.width > area.x &&
      saved.y + saved.height > area.y
    if (!visible) return undefined
    return {
      x: saved.x,
      y: saved.y,
      width: saved.width,
      height: saved.height,
      maximized: saved.maximized === true,
    }
  } catch {
    return undefined
  }
}

/** Save the window's normal (non-maximized) geometry. Never throws. */
function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getNormalBounds()
    const state: WindowState = { ...bounds, maximized: win.isMaximized() }
    writeFileSync(windowStateFile(), JSON.stringify(state) + '\n')
  } catch {
    // non-fatal: a lost geometry falls back to the default on next launch
  }
}

/**
 * Create the single application window pointed at the local server.
 * @param port - port the server bound
 */
function createWindow(port: number): BrowserWindow {
  const saved = loadWindowState()
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    ...(saved === undefined ? {} : { x: saved.x, y: saved.y }),
    minWidth: 800,
    minHeight: 600,
    title: 'DSH Desktop',
    autoHideMenuBar: true,
    // Used by window chrome on win/linux; ignored on macOS (dock icon is set
    // separately at startup).
    icon: devIcon(),
  })
  if (saved?.maximized) win.maximize()
  // Persist geometry (debounced — resize/move fire in bursts) so the next
  // launch reopens where the user left it.
  let saveTimer: NodeJS.Timeout | undefined
  const persist = (): void => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      if (!win.isDestroyed()) saveWindowState(win)
    }, 300)
  }
  win.on('resize', persist)
  win.on('move', persist)
  // Closing the window hides it to the tray instead of quitting, so long
  // agent tasks keep running in the background (issue #3). Real exit only
  // happens via the tray menu / Cmd+Q, which flips `quitting` first.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  // The UI is a local agent console; anything off-origin is an external link
  // and belongs in the user's real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  void win.loadURL(`http://127.0.0.1:${port}/`)
  return win
}

/**
 * Show the main window again (tray click, dock click, second instance).
 * Recreates it if it was somehow destroyed.
 * @param port - port the server bound
 */
function showWindow(port: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(port)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Splash shown from app-ready until the dsh server answers; without it the
 * dock icon appears but nothing responds for the whole boot (worst case:
 * minutes of silent safe-mode retries). */
let splashWindow: BrowserWindow | undefined

/**
 * Small frameless "starting" window. The dsh child may legitimately take tens
 * of seconds (plugin tree, cold disk, recovery retries); this keeps the app
 * visibly alive until the real window can load a live server.
 */
function createSplash(): void {
  const zh = app.getLocale().startsWith('zh')
  const text = zh ? '正在启动 DSH Desktop…' : 'Starting DSH Desktop…'
  const hint = zh ? '首次启动或插件较多时需要一点时间' : 'First launch or many plugins can take a moment'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;
background:#fff;color:#333;font:14px -apple-system,"Segoe UI",sans-serif;user-select:none}
@media (prefers-color-scheme:dark){html,body{background:#1e1e1e;color:#ddd}}
.wrap{text-align:center;line-height:1.8}
.spin{width:28px;height:28px;margin:0 auto 14px;border:3px solid #4d6bfe33;
border-top-color:#4d6bfe;border-radius:50%;animation:r .9s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
small{font-size:12px;opacity:.55}
</style></head><body><div class="wrap"><div class="spin"></div>${text}<br><small>${hint}</small></div></body></html>`
  splashWindow = new BrowserWindow({
    width: 360,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    title: 'DSH Desktop',
    icon: devIcon(),
  })
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

/** Tear the splash down once its job (covering the boot) is done. */
function destroySplash(): void {
  splashWindow?.destroy()
  splashWindow = undefined
}

/**
 * Create the system-tray icon with a show/quit menu. The tray owns the app
 * lifecycle once the window is hidden: left-click restores the window,
 * "Quit" is the only path that tears down the dsh child.
 * @param port - port the server bound
 */
function createTray(port: number): void {
  // Declare the 36px PNG as a @2x representation so its logical size is
  // 18pt — status-item images are laid out in points, and a 1x image would
  // be clipped to the menu-bar height and look oversized.
  const icon = nativeImage.createEmpty()
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_DATA_URL })
  // macOS menu bar: render as an adaptive monochrome silhouette so the whale
  // stays visible on both light and dark menu bars. Windows keeps the color
  // icon in the notification area.
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('DSH Desktop')
  // Menu labels follow the OS locale; the rest of the app's dialogs remain
  // Chinese-first for now.
  const zh = app.getLocale().startsWith('zh')
  const labels = zh
    ? { show: '显示 DSH Desktop', update: '检查更新…', logs: '打开日志', data: '打开数据目录', restore: '恢复被禁用的插件并重启', quit: '退出 DSH Desktop' }
    : { show: 'Show DSH Desktop', update: 'Check for Updates…', logs: 'Open log', data: 'Open data folder', restore: 'Restore disabled plugins and restart', quit: 'Quit DSH Desktop' }
  // Recovery actions survive the crash that triggered them, so the restore
  // item is offered whenever the record is non-empty — not only right after
  // a safe-mode boot.
  const recovery = loadRecoveryActions(safeModeStateFile()).length > 0
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.show, click: () => showWindow(port) },
      { label: labels.update, click: () => void manualUpdateCheck() },
      // Troubleshooting entries: the log is the first place to look when the
      // UI misbehaves, and the data dir holds profiles/sessions/plugins.
      { label: labels.logs, click: () => shell.showItemInFolder(logFile()) },
      { label: labels.data, click: () => void shell.openPath(dshHome()) },
      ...(recovery
        ? ([
            { type: 'separator' },
            { label: labels.restore, click: () => restorePluginsAndRelaunch() },
          ] as const)
        : []),
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => showWindow(port))
}

/** Homebrew cask token for installs that came from the community tap. */
const BREW_CASK = 'dsh-desktop'
/** Absolute brew locations — GUI apps inherit no shell PATH. */
const BREW_BINS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

function brewBin(): string | undefined {
  return BREW_BINS.find((bin) => existsSync(bin))
}

/** Whether this installation is managed by Homebrew (the cask is installed). */
function isBrewManaged(): boolean {
  const brew = brewBin()
  if (!brew) return false
  try {
    return spawnSync(brew, ['list', '--cask', BREW_CASK], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/** Path of the .app bundle this process runs from (the `xattr -cr` target). */
function appBundlePath(): string {
  const marker = '.app/'
  const idx = process.execPath.indexOf(marker)
  return idx === -1 ? process.execPath : process.execPath.slice(0, idx + marker.length - 1)
}

/**
 * Proxy environment for update subprocesses. GUI launches inherit a bare
 * launchd env with no proxy variables, so brew/curl go direct to GitHub's
 * asset CDN — which for users behind a proxy crawls and then dies with
 * curl(56). Read macOS's system proxy via scutil and translate it into the
 * standard *_PROXY variables brew and curl honor.
 */
function systemProxyEnv(): NodeJS.ProcessEnv {
  if (process.platform !== 'darwin') return {}
  try {
    const out = spawnSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8' }).stdout ?? ''
    const get = (key: string): string | undefined =>
      out.match(new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)`, 'm'))?.[1]
    if (get('HTTPSEnable') === '1' && get('HTTPSProxy') !== undefined) {
      const server = `http://${get('HTTPSProxy')}:${get('HTTPSPort') ?? '443'}`
      return { HTTPS_PROXY: server, HTTP_PROXY: server, ALL_PROXY: server }
    }
    if (get('HTTPEnable') === '1' && get('HTTPProxy') !== undefined) {
      const server = `http://${get('HTTPProxy')}:${get('HTTPPort') ?? '80'}`
      return { HTTPS_PROXY: server, HTTP_PROXY: server, ALL_PROXY: server }
    }
    if (get('SOCKSEnable') === '1' && get('SOCKSProxy') !== undefined) {
      return { ALL_PROXY: `socks5://${get('SOCKSProxy')}:${get('SOCKSPort') ?? '1080'}` }
    }
  } catch {
    // no proxy info readable; fall back to a direct connection
  }
  return {}
}

/** Run a command with output appended to the dsh log; resolves the exit code. */
function runLogged(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    appendFileSync(logFile(), `\n=== update: ${command} ${args.join(' ')} ===\n`)
    const child = spawn(command, args, { env: { ...process.env, ...systemProxyEnv() } })
    child.stdout?.on('data', (chunk: Buffer) => appendFileSync(logFile(), chunk))
    child.stderr?.on('data', (chunk: Buffer) => appendFileSync(logFile(), chunk))
    child.on('error', () => resolve(null))
    child.on('exit', (code) => resolve(code))
  })
}

/**
 * macOS update path for Homebrew-managed installs: `brew upgrade --cask`,
 * clear the quarantine attribute the unsigned build trips over, then offer an
 * immediate relaunch. Failures fall back to the manual releases page.
 */
async function runBrewUpdate(): Promise<void> {
  const brew = brewBin()
  if (!brew) return
  const code = await runLogged(brew, ['upgrade', '--cask', BREW_CASK])
  if (code !== 0) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: '更新失败',
      message: '通过 Homebrew 升级没有完成。',
      detail: `brew 的输出见日志：${logFile()}\n也可以从发布页手动下载最新版本安装。`,
      buttons: ['打开发布页', '稍后'],
    })
    if (response === 0) void shell.openExternal(RELEASES_URL)
    return
  }
  await runLogged('/usr/bin/xattr', ['-cr', appBundlePath()])
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '更新已安装',
    message: '新版本已通过 Homebrew 安装完成。',
    detail: '现在重启 DSH Desktop 以使用新版本吗？',
    buttons: ['重启', '稍后'],
  })
  if (response !== 0) return
  // app.exit() skips will-quit, so tear down the tray and dsh child here —
  // an orphaned dsh server would otherwise keep holding its port.
  quitting = true
  tray?.destroy()
  if (dshChild && dshChild.exitCode === null) dshChild.kill()
  app.relaunch()
  app.exit(0)
}

/**
 * macOS update prompt: unsigned builds cannot update themselves, so offer the
 * Homebrew path when the cask manages this install, else point at the
 * releases page for a manual download.
 */
async function promptMacUpdate(version: string): Promise<void> {
  const brewManaged = isBrewManaged()
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `DSH Desktop ${version} 已发布。`,
    detail: brewManaged
      ? '当前安装由 Homebrew 管理，可以原地升级，完成后应用会自动重启。'
      : 'macOS 版本未签名，无法自动更新。请从发布页下载最新安装包。',
    buttons: brewManaged ? ['通过 Homebrew 更新', '从 GitHub 下载', '稍后'] : ['打开发布页', '稍后'],
  })
  if (brewManaged && response === 0) await runBrewUpdate()
  else if (response === (brewManaged ? 1 : 0)) void shell.openExternal(RELEASES_URL)
}

/** Version already prompted for this run, so 4-hourly checks don't re-nag. */
let promptedVersion: string | undefined
/** Set once a background download starts; gates the error dialog to real
 * download failures instead of transient network errors from checkForUpdates. */
let downloadInFlight = false
/** The wired updater, set once the dynamic import in setupAutoUpdate lands. */
let updater: AppUpdater | undefined
/** Re-entrancy guard for the menu-triggered check; also routes the outcome. */
let manualCheckInFlight = false
/** Whether the in-flight manual check found an update (set by the event). */
let manualSawUpdate = false

/**
 * Menu/tray-triggered update check. Unlike the silent 4-hourly poll, a manual
 * click always reports back: re-prompts even for an already-nagged version,
 * says so when already current, and surfaces network failures.
 */
async function manualUpdateCheck(): Promise<void> {
  if (manualCheckInFlight) return
  const zh = app.getLocale().startsWith('zh')
  if (!app.isPackaged || !updater) {
    await dialog.showMessageBox({
      type: 'info',
      title: zh ? '检查更新' : 'Check for Updates',
      message: zh ? '开发模式不检查更新。' : 'Update checks are disabled in development mode.',
    })
    return
  }
  manualCheckInFlight = true
  manualSawUpdate = false
  promptedVersion = undefined
  try {
    await updater.checkForUpdates()
  } catch {
    // the error event already logged the detail
    await dialog.showMessageBox({
      type: 'error',
      title: zh ? '检查更新失败' : 'Update Check Failed',
      message: zh ? '无法连接到更新服务器，请检查网络后重试。' : 'Could not reach the update server. Check your network and retry.',
    })
    return
  } finally {
    manualCheckInFlight = false
  }
  if (manualSawUpdate) {
    // macOS already shows its prompt from the update-available handler.
    if (process.platform !== 'darwin') {
      await dialog.showMessageBox({
        type: 'info',
        title: zh ? '发现新版本' : 'Update Available',
        message: zh ? '发现新版本，正在后台下载，完成后会提示你重启。' : 'A new version is downloading in the background; you will be prompted to restart.',
      })
    }
    return
  }
  await dialog.showMessageBox({
    type: 'info',
    title: zh ? '检查更新' : 'Check for Updates',
    message: zh ? `当前已是最新版本（${app.getVersion()}）。` : `You are on the latest version (${app.getVersion()}).`,
  })
}

/**
 * Application menu with a manual "Check for Updates" entry. Kept role-based
 * so the standard items (especially Edit's copy/paste for the web UI) survive.
 */
function setupAppMenu(): void {
  const zh = app.getLocale().startsWith('zh')
  const checkItem: Electron.MenuItemConstructorOptions = {
    label: zh ? '检查更新…' : 'Check for Updates…',
    click: () => void manualUpdateCheck(),
  }
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            checkItem,
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    )
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        label: zh ? '帮助' : 'Help',
        submenu: [checkItem, { type: 'separator' as const }, { role: 'about' as const }],
      },
    ]),
  )
}

/**
 * Wire electron-updater: check on start and then every 4 hours. Windows
 * downloads in the background and offers a restart-to-update dialog; macOS
 * skips the doomed self-update (unsigned builds) and goes straight to the
 * Homebrew / manual-download prompt.
 */
function setupAutoUpdate(): void {
  if (!app.isPackaged) return
  // electron-updater is CJS and exposes autoUpdater via an Object.defineProperty
  // getter, which cjs-module-lexer cannot see — under NodeNext ESM the named
  // import is undefined and only `default` (module.exports) carries it.
  void import('electron-updater').then((mod) => {
    const { autoUpdater } = (mod as unknown as { default?: typeof mod }).default ?? mod
    updater = autoUpdater
    autoUpdater.autoDownload = process.platform !== 'darwin'
    autoUpdater.on('update-available', (info) => {
      if (manualCheckInFlight) manualSawUpdate = true
      if (process.platform === 'darwin') {
        if (info.version === promptedVersion) return
        promptedVersion = info.version
        void promptMacUpdate(info.version)
      } else {
        downloadInFlight = true
      }
    })
    autoUpdater.on('update-downloaded', (info) => {
      downloadInFlight = false
      void dialog
        .showMessageBox({
          type: 'info',
          title: '更新已就绪',
          message: `DSH Desktop ${info.version} 已下载完成。`,
          detail: '现在重启以应用更新。不重启的话，下次退出应用时也会自动安装。',
          buttons: ['重启并更新', '稍后'],
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall(true, true)
        })
    })
    autoUpdater.on('error', (error) => {
      appendFileSync(logFile(), `\n=== auto-update error: ${error.message} ===\n`)
      if (!downloadInFlight) return
      downloadInFlight = false
      void dialog
        .showMessageBox({
          type: 'info',
          title: '发现新版本',
          message: '有新版本可用，但无法自动安装。',
          detail: '请从发布页下载最新安装包。',
          buttons: ['打开发布页', '稍后'],
        })
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(RELEASES_URL)
        })
    })
    const check = (): void => {
      autoUpdater.checkForUpdates().catch(() => {
        // transient network failure; the next scheduled check retries
      })
    }
    check()
    setInterval(check, 4 * 60 * 60 * 1000)
  }).catch((error: Error) => {
    appendFileSync(logFile(), `\n=== auto-update setup failed: ${error.message} ===\n`)
  })
}

let dshChild: ChildProcess | undefined
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
/** Port the dsh server bound; kept so hidden-window restores can recreate the window. */
let serverPort = 0
/** Set only by an explicit quit (tray menu, Cmd+Q); guards the close-to-tray interception. */
let quitting = false
/** Set once the server is ready and the window/tray exist; `activate` before
 * that point would otherwise create a window pointed at a dead port. */
let booted = false

/**
 * Ask the user about one recovery step. "View log" reveals the log in the
 * file manager and re-shows the same dialog; anything else resolves the
 * final choice.
 * @param options - dialog text; `confirm` is the recovery button label
 * @returns whether the user approved the recovery action
 */
async function confirmRecovery(options: { title: string; message: string; detail: string; confirm: string }): Promise<boolean> {
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: options.title,
      message: options.message,
      detail: `${options.detail}\n\n日志：${logFile()}`,
      buttons: [options.confirm, '查看日志', '退出'],
      defaultId: 0,
      cancelId: 2,
    })
    if (response === 1) {
      shell.showItemInFolder(logFile())
      continue
    }
    return response === 0
  }
}

/**
 * Decide the next recovery step after a failed boot attempt, escalating one
 * rung at a time: silent retry → disable the blamed plugin entry → remove an
 * unloadable bundle → full safe mode (every self-installed plugin off). Each
 * rung is tried at most once per session (`tried`) and every mutation goes
 * through the confirmation dialog before being recorded for the tray's
 * restore item.
 * @param attempt - 1-based count of the attempt that just failed
 * @param tried - recovery rungs already applied this session
 * @returns whether to retry booting after the applied fix
 */
async function proposeRecovery(attempt: number, tried: Set<string>): Promise<boolean> {
  // First failure may be transient (port race, slow disk): retry silently.
  if (attempt === 1) return true
  const culprit = findCulprit(readLastAttemptLog(logFile()))
  const profileDir = webProfileDir()
  if (culprit?.kind === 'apply' && !tried.has(`entry:${culprit.entryId}`)) {
    tried.add(`entry:${culprit.entryId}`)
    const approved = await confirmRecovery({
      title: '插件加载失败',
      message: `插件「${culprit.packageName}」导致 DSH 无法启动。`,
      detail:
        '是否只禁用这个插件并重试？之后可以随时在插件市场重新启用。' +
        '如果问题持续存在，请向插件作者反馈。',
      confirm: '禁用插件并重试',
    })
    if (!approved) return false
    const block = disableEntry(join(profileDir, 'cordis.patch.yml'), culprit.entryId)
    if (block !== undefined) {
      recordRecoveryAction(safeModeStateFile(), { type: 'disable-entry', entryId: culprit.entryId, block })
      appendFileSync(logFile(), `\n=== safe mode: disabled plugin entry "${culprit.entryId}" (${culprit.packageName}) ===\n`)
    } else {
      appendFileSync(logFile(), `\n=== safe mode: plugin entry "${culprit.entryId}" was already disabled ===\n`)
    }
    return true
  }
  if (culprit?.kind === 'unresolvable' && !tried.has(`bundle:${culprit.packageName}`)) {
    tried.add(`bundle:${culprit.packageName}`)
    const approved = await confirmRecovery({
      title: '插件文件缺失',
      message: `插件「${culprit.packageName}」无法加载，它的文件缺失或不完整。`,
      detail:
        '是否把它从启动列表中移除并重试？插件本体仍然保留，之后可以通过托盘菜单' +
        '「恢复被禁用的插件」还原，或在插件市场重新安装。',
      confirm: '移除插件并重试',
    })
    if (!approved) return false
    removeBundle(join(profileDir, 'package.json'), culprit.packageName)
    recordRecoveryAction(safeModeStateFile(), { type: 'remove-bundle', packageName: culprit.packageName })
    appendFileSync(logFile(), `\n=== safe mode: removed bundle "${culprit.packageName}" from the profile ===\n`)
    return true
  }
  if (!tried.has('full')) {
    tried.add('full')
    const approved = await confirmRecovery({
      title: '启动失败',
      message: 'DSH 多次启动失败，且无法定位到具体某个插件。',
      detail:
        '是否以安全模式启动？所有自行安装的插件都会被禁用（内置功能不受影响）。' +
        '启动成功后，可通过托盘菜单「恢复被禁用的插件」一键还原。\n\n' +
        '如果安全模式也起不来，多半是安装本身坏了——请重新下载安装最新版本。',
      confirm: '以安全模式启动',
    })
    if (!approved) return false
    const action = enterFullSafeMode(dshHome(), profileDir, WEB_PROFILE_TEMPLATE)
    recordRecoveryAction(safeModeStateFile(), action)
    appendFileSync(logFile(), `\n=== safe mode: full plugin strip, removed bundles: ${action.removedBundles.join(', ') || '(none)'} ===\n`)
    return true
  }
  return false
}

/**
 * Tray-menu restore: undo every recorded safe-mode mutation and relaunch so
 * the profile boots with the restored plugins. Uses `app.exit` like the
 * Homebrew update path, so the child and tray are torn down manually first.
 */
function restorePluginsAndRelaunch(): void {
  restoreAll(safeModeStateFile(), dshHome(), webProfileDir())
  appendFileSync(logFile(), `\n=== safe mode: all recovery actions restored, relaunching ===\n`)
  quitting = true
  tray?.destroy()
  if (dshChild && dshChild.exitCode === null) dshChild.kill()
  app.relaunch()
  app.exit(0)
}

/**
 * Boot the dsh server with the safe-mode recovery ladder: retry on failure,
 * and when the loader's error names a plugin, offer to neutralize just that
 * plugin before escalating to a full plugin-free boot. Throws only when the
 * user declines recovery or every rung has been exhausted.
 */
async function boot(): Promise<void> {
  presetBundledPlugins()
  const tried = new Set<string>()
  let attempt = 0
  for (;;) {
    attempt++
    const port = await pickPort()
    serverPort = port
    dshChild = startDsh(port)
    try {
      await waitReady(port, dshChild)
      destroySplash()
      mainWindow = createWindow(port)
      createTray(port)
      booted = true
      if (attempt > 1) appendFileSync(logFile(), `\n=== boot succeeded after ${attempt - 1} failed attempt(s) ===\n`)
      return
    } catch (error) {
      appendFileSync(
        logFile(),
        `\n=== boot attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)} ===\n`,
      )
      // A hung child (readiness timeout without exit) still holds its port.
      if (dshChild.exitCode === null) dshChild.kill()
      if (!(await proposeRecovery(attempt, tried))) throw error
    }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Re-launching the app while it lives in the tray brings the window back.
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    // Dev mode only: replace Electron's default dock icon with the whale.
    const icon = devIcon()
    if (icon && process.platform === 'darwin') app.dock?.setIcon(icon)
    setupAppMenu()
    setupAutoUpdate()
    createSplash()
    try {
      await boot()
    } catch (error) {
      destroySplash()
      dialog.showErrorBox(
        'DSH Desktop 启动失败',
        `${error instanceof Error ? error.message : String(error)}\n\n日志：${logFile()}`,
      )
      app.quit()
    }
  })

  // Explicit quit paths (tray "Quit", Cmd+Q, boot-failure quit) flip this so
  // the window's close handler lets the window actually close.
  app.on('before-quit', () => {
    quitting = true
    // Flush any debounced geometry save: quitting from a visible window never
    // passes through the close handler that normally persists it.
    if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow)
  })
  // The app lives in the tray once the window is closed; never quit just
  // because no window is open (issue #3).
  app.on('window-all-closed', () => {})
  // macOS dock click while running in the tray reopens the window. Guarded
  // by `booted`: macOS can fire activate during launch, and creating the
  // window then would point it at a port the server hasn't bound yet.
  app.on('activate', () => {
    if (booted && serverPort && !mainWindow?.isVisible()) showWindow(serverPort)
  })
  app.on('will-quit', () => {
    tray?.destroy()
    if (dshChild && dshChild.exitCode === null) dshChild.kill()
  })
}
