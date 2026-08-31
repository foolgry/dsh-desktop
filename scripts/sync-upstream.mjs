/**
 * Sync-upstream entry for CI and `just sync`: polls npm for the latest
 * `@deepseek-ai/dsh`, and when it moved (or --force is passed) bumps the
 * dependency and computes the next desktop version. CI also passes --force
 * to rebuild the SAME upstream version when the repo itself changed since
 * the last release tag, or when a tag was left without a release by a
 * failed build.
 *
 * Desktop version scheme, designed to stay valid semver and strictly
 * increasing under electron-updater:
 * - upstream prerelease (e.g. 0.1.0-rc.6) → append a UTC build timestamp as
 *   an extra prerelease segment: 0.1.0-rc.6.202508151030, …
 * - upstream stable (e.g. 0.1.0) → independent patch line starting at
 *   X.Y.(Z+1), bumped until it exceeds the current desktop version
 *
 * The timestamp segment is a fixed-width YYYYMMDDHHMM (12 digits until the
 * year 10000), so lexicographic tag sorting (GitHub's tag dropdown, various
 * release pickers) matches chronological order — a plain counter breaks at
 * digit rollover, where "rc.6.9" sorts above "rc.6.11".
 *
 * Writes `changed`, `version`, and `upstream_version` to $GITHUB_OUTPUT when
 * present, and prints them otherwise. The lockfile refresh and the git
 * commit/tag are the caller's job. Always exits 0; `changed` carries the
 * verdict.
 *
 * Usage: node scripts/sync-upstream.mjs [--force]
 * @module dsh-desktop/scripts/sync-upstream
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve } from 'node:path'
import semver from 'semver'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATH = join(ROOT, 'package.json')
const UPSTREAM = '@deepseek-ai/dsh'
const SCOPE = '@deepseek-ai'

/**
 * Preinstalled companion packages that track their own npm `latest` on every
 * sync, independent of the upstream version scheme. `dshmarket` is pinned as
 * a preset plugin, but its release line (1.x) moves separately from dsh
 * (0.1.x) — and when dsh breaks an API the market imports, only a fresh
 * market release compiles again (dsh 0.1.2-alpha.1 deleted the
 * `installSettingsSection` export and market 1.10.x made the whole host exit
 * 1 at boot). Following it here keeps the preset from going stale between
 * upstream releases.
 */
const COMPANION_PACKAGES = ['dshmarket']

/** Latest published version of one companion package (its `latest` tag). */
function companionLatest(name) {
  return execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8' }).trim()
}

/**
 * Latest published upstream version, straight from the npm registry.
 *
 * Reads ALL dist-tags and takes the highest semver among them: upstream
 * publishes each rc to `next` first and only moves it to `latest` later (or
 * never), so `npm view version` — which reads `latest` only — misses fresh
 * rc releases for days (rc.7 and rc.8 both went undetected this way).
 */
function upstreamLatest() {
  const tags = JSON.parse(
    execFileSync('npm', ['view', UPSTREAM, 'dist-tags', '--json'], { encoding: 'utf8' }),
  )
  const best = Object.values(tags)
    .filter((v) => semver.valid(v))
    .sort(semver.rcompare)[0]
  if (!best) throw new Error(`no valid version in dist-tags of ${UPSTREAM}: ${JSON.stringify(tags)}`)
  return best
}

/**
 * Fixed-width UTC minute stamp (YYYYMMDDHHMM) used as the prerelease build
 * segment. UTC keeps CI runners in any timezone on the same clock.
 */
function buildStamp() {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
  )
}

/**
 * Compute the next desktop version for a new upstream release.
 * @param {string} current - current desktop version (package.json `version`)
 * @param {string} upstream - the upstream version being adopted
 * @returns {string} a valid semver strictly greater than `current`
 */
function nextVersion(current, upstream) {
  const parsed = semver.parse(upstream)
  if (!parsed) throw new Error(`upstream version ${upstream} is not valid semver`)
  let candidate
  if (parsed.prerelease.length > 0) {
    // Every sync run gets a fresh timestamp, so a --force rebuild of the same
    // upstream release naturally lands on a newer version without inspecting
    // `current` first.
    candidate = `${upstream}.${buildStamp()}`
  } else {
    // Stable upstream: independent patch line above it.
    candidate = `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
  }
  // Never publish a version that is not strictly newer (same-minute --force
  // rebuild, or upstream released the patch we had already claimed): bump the
  // trailing numeric segment until it clears `current`.
  while (!semver.gt(candidate, current)) {
    const segments = candidate.split('.')
    segments[segments.length - 1] = String(Number(segments[segments.length - 1]) + 1)
    candidate = segments.join('.')
  }
  return candidate
}

/**
 * Detect @deepseek-ai/* packages that are referenced ONLY as peerDependencies
 * across the installed harness tree, never as a real `dependencies` entry.
 *
 * electron-builder's production collector reads only `dependencies` and
 * `optionalDependencies` (app-builder-lib `nodeModulesCollector.isProdDependency`),
 * so a runtime-required package declared solely as a peer would be dropped on
 * packaging. Returning them lets the caller pin each one explicitly.
 *
 * @param {string} upstreamVersion - version to pin dsh-* peers to
 * @param {Record<string, string>} deps - current package.json `dependencies`,
 *   read to preserve exact (non-caret) pins
 * @returns {Record<string, string>} package name -> semver range
 */
function detectPeerOnlyRuntimeDeps(upstreamVersion, deps) {
  const scopeDir = join(ROOT, 'node_modules', SCOPE)
  let names = []
  try {
    names = readdirSync(scopeDir).filter((n) => !n.startsWith('.'))
  } catch {
    return {} // node_modules absent (e.g. no install yet) — nothing to detect
  }

  const metas = new Map()
  const depsReferenced = new Set()
  const peerReferenced = new Set()
  for (const name of names) {
    const fullName = `${SCOPE}/${name}`
    let pkgJson
    try {
      pkgJson = JSON.parse(readFileSync(join(scopeDir, name, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    metas.set(fullName, pkgJson)
    for (const dep of Object.keys(pkgJson.dependencies || {})) {
      if (dep.startsWith(`${SCOPE}/`)) depsReferenced.add(dep)
    }
    for (const peer of Object.keys(pkgJson.peerDependencies || {})) {
      if (peer.startsWith(`${SCOPE}/`)) peerReferenced.add(peer)
    }
  }

  const result = {}
  for (const fullName of peerReferenced) {
    if (depsReferenced.has(fullName)) continue
    const pkgJson = metas.get(fullName)
    if (!pkgJson) continue // referenced but not installed — cannot pin
    // dsh-* peers track the upstream release; other peers (e.g. cordis-*)
    // keep their own installed version under a ^ range. A range that pnpm
    // failed to resolve gets pinned exactly (no ^): the caret expansion of a
    // prerelease pin like ^0.1.2-alpha.2 drops the prerelease lower bound, so
    // when a companion package's stale peer range forces a re-resolve, the
    // registry lookup hits "no matching version" for the unreleased stable
    // (dsh-settings during 0.1.2-alpha, via dshmarket's peer).
    const base = fullName.startsWith(`${SCOPE}/dsh`) ? upstreamVersion : pkgJson.version
    const exact = deps[fullName] !== undefined && !deps[fullName].startsWith('^')
    result[fullName] = exact ? base : `^${base}`
  }
  return result
}

/**
 * Merge detected peer-only runtime deps into `deps`, adding new ones and
 * bumping versions of existing entries. Entries are never removed: a peer that
 * later becomes a real dependency elsewhere stays pinned (harmless — the package
 * is still installed) rather than risk a stale reference after a rename.
 * @param {Record<string, string>} deps - package.json `dependencies` to mutate
 * @param {string} upstreamVersion - version to pin dsh-* peers to
 */
function syncPeerOnlyRuntimeDeps(deps, upstreamVersion) {
  const peerOnly = detectPeerOnlyRuntimeDeps(upstreamVersion, deps)
  const added = []
  const updated = []
  for (const [name, range] of Object.entries(peerOnly)) {
    if (deps[name] == null) {
      added.push(name)
    } else if (deps[name] !== range) {
      updated.push(`${name}: ${deps[name]} -> ${range}`)
    }
    deps[name] = range
  }
  if (added.length) console.log(`peer-only runtime deps added: ${added.join(', ')}`)
  if (updated.length) console.log(`peer-only runtime deps updated: ${updated.join('; ')}`)
}

function main() {
  const force = process.argv.includes('--force')
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
  const latest = upstreamLatest()
  const pinned = pkg.dependencies[UPSTREAM]
  const upstreamChanged = pinned !== latest

  // Companion packages move on their own; a newer release needs a rebuild
  // even when the upstream dependency itself did not budge. The stored range
  // is a caret, so membership (not string equality) decides whether the npm
  // latest is already covered.
  const companionUpdates = []
  for (const name of COMPANION_PACKAGES) {
    const range = pkg.dependencies[name]
    if (range === undefined) continue
    const latestCompanion = companionLatest(name)
    if (!semver.valid(latestCompanion)) {
      throw new Error(`companion ${name}: npm returned invalid version ${latestCompanion}`)
    }
    if (!semver.satisfies(latestCompanion, range)) {
      companionUpdates.push(`${name}: ${range} -> ^${latestCompanion}`)
      pkg.dependencies[name] = `^${latestCompanion}`
    }
  }
  const changed = force || upstreamChanged || companionUpdates.length > 0

  if (!changed) {
    console.log(`upstream unchanged at ${latest}; nothing to do`)
  } else {
    const version = nextVersion(pkg.version, latest)
    pkg.dependencies[UPSTREAM] = latest
    pkg.version = version
    pkg.dsh = { ...pkg.dsh, upstream: UPSTREAM, upstreamVersion: latest }
    // Re-pin the @deepseek-ai/* peer-only runtime deps for the new upstream
    // version: electron-builder's production collector ignores peerDependencies,
    // so these must be listed as real dependencies to survive packaging.
    syncPeerOnlyRuntimeDeps(pkg.dependencies, latest)
    writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
    console.log(`upstream ${pinned} -> ${latest}; desktop version -> ${version}`)
    for (const update of companionUpdates) console.log(`companion updated: ${update}`)
  }

  // `changed` = a build is wanted (upstream moved, or --force from a
  // repo-change / orphan-tag / manual rebuild); `upstream_changed` = the
  // upstream dependency itself moved, which CI uses to word the commit.
  const outputs = {
    changed: String(changed),
    upstream_changed: String(upstreamChanged),
    version: pkg.version,
    upstream_version: latest,
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
    )
  } else {
    console.log(outputs)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}

export { nextVersion, buildStamp }
