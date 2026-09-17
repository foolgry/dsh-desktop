/**
 * Sync-upstream entry for CI and `just sync`: polls npm for the newest
 * `@deepseek-ai/dsh` the registry can actually resolve, and when it moved (or
 * --force is passed) bumps the dependency and computes the next desktop
 * version. CI also passes --force to rebuild the SAME upstream version when
 * the repo itself changed since the last release tag, or when a tag was left
 * without a release by a failed build.
 *
 * "Newest resolvable": candidates are tried newest-first and skipped while
 * their first-party dependency ranges have no published match — upstream
 * ships the monorepo as one batch and sometimes lands the main package
 * before its siblings, and adopting such a half-published release used to
 * wedge the lockfile refresh (and thus every scheduled run) for days.
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

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve } from 'node:path'
import semver from 'semver'

const execFileP = promisify(execFile)

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
 * Published upstream versions worth considering, newest first.
 *
 * The full version list (a superset of dist-tags) instead of `npm view
 * version` — which reads `latest` only — because upstream publishes each rc
 * to `next` first and only moves it to `latest` later (or never), so rc.7
 * and rc.8 both went undetected that way.
 */
async function upstreamCandidates() {
  const { stdout } = await execFileP('npm', ['view', UPSTREAM, 'versions', '--json'], {
    encoding: 'utf8',
  })
  const versions = JSON.parse(stdout)
  const valid = versions.filter((v) => semver.valid(v)).sort(semver.rcompare)
  if (!valid.length) throw new Error(`no valid published versions of ${UPSTREAM}`)
  return valid
}

/** npm registry manifest of a single upstream version. */
async function upstreamMeta(version) {
  const { stdout } = await execFileP('npm', ['view', `${UPSTREAM}@${version}`, '--json'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

/** All published versions of one package, cached per run; empty if unlisted. */
const versionsCache = new Map()
async function publishedVersions(name) {
  if (!versionsCache.has(name)) {
    versionsCache.set(
      name,
      await execFileP('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8' })
        .then(({ stdout }) => JSON.parse(stdout).filter((v) => semver.valid(v)))
        .catch(() => []), // unlisted or unreachable: nothing resolvable there
    )
  }
  return versionsCache.get(name)
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Whether pnpm can resolve `version` from the registry today: every
 * first-party range it pulls in — plus the peer-only pins this bump would
 * write into package.json — must match at least one published version.
 *
 * Upstream ships the dsh monorepo as one batch and occasionally lands the
 * main package before its siblings (0.1.6-alpha.2 went out while
 * dsh-code-runtime had no 0.1.6-* release), which wedged every scheduled run
 * on the lockfile refresh until the stragglers appeared. Third-party ranges
 * are not checked: independent packages don't move in lockstep with dsh.
 */
async function installable(version, depsAfterBump) {
  let meta
  try {
    meta = await upstreamMeta(version)
  } catch (err) {
    console.log(`upstream ${version}: manifest unavailable (${err.message.split('\n')[0]})`)
    return false
  }
  // Every (name, range) pair must resolve, not one range per name: the root
  // package.json may pin a different (older) range than the upstream manifest
  // declares for the same package, and pnpm has to satisfy both.
  const pairs = new Map()
  const add = (name, range) => {
    if (typeof name === 'string' && name.startsWith(`${SCOPE}/`) && typeof range === 'string') {
      pairs.set(`${name} ${range}`, [name, range])
    }
  }
  for (const [name, range] of Object.entries(meta.dependencies ?? {})) add(name, range)
  for (const [name, range] of Object.entries(meta.peerDependencies ?? {})) add(name, range)
  for (const [name, range] of Object.entries(depsAfterBump)) add(name, range)

  const missing = []
  await mapPool([...pairs.values()], 8, async ([name, range]) => {
    const versions = await publishedVersions(name)
    if (!versions.some((v) => semver.satisfies(v, range))) missing.push(`${name}@${range}`)
  })
  if (missing.length) {
    console.log(
      `upstream ${version}: ${missing.length} first-party dependency range(s) unresolvable ` +
        `(e.g. ${missing.slice(0, 3).join(', ')}); not adoptable yet`,
    )
    return false
  }
  return true
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
 * later becomes a real dependency elsewhere stays pinned (harmless — the
 * package is still installed) rather than risk a stale reference after a rename.
 * @param {Record<string, string>} deps - package.json `dependencies` to mutate
 * @param {string} upstreamVersion - version to pin dsh-* peers to
 * @param {boolean} [log=true] - false for dry-run previews (a failing
 *   candidate would otherwise print its planned pins before being rejected)
 */
function syncPeerOnlyRuntimeDeps(deps, upstreamVersion, log = true) {
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
  if (!log) return
  if (added.length) console.log(`peer-only runtime deps added: ${added.join(', ')}`)
  if (updated.length) console.log(`peer-only runtime deps updated: ${updated.join('; ')}`)
}

async function main() {
  const force = process.argv.includes('--force')
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
  const pinned = pkg.dependencies[UPSTREAM]
  const pinnedVersion = semver.valid(pinned) ?? semver.minVersion(pinned)?.version
  if (!pinnedVersion) throw new Error(`pinned ${UPSTREAM} range ${pinned} has no valid version`)

  // Newest-to-oldest, adopt the first release the registry can actually
  // resolve; never fall back below the version already pinned (that one is
  // known-installable, so "no candidate" simply means staying put).
  let latest = null
  for (const candidate of await upstreamCandidates()) {
    if (!semver.gt(candidate, pinnedVersion)) break
    const preview = { ...pkg.dependencies }
    syncPeerOnlyRuntimeDeps(preview, candidate, false)
    if (await installable(candidate, preview)) {
      latest = candidate
      break
    }
  }
  if (!latest) {
    console.warn(`no installable ${UPSTREAM} release above ${pinnedVersion} yet; staying on it`)
    latest = pinnedVersion
  }
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
  await main()
}

export { nextVersion, buildStamp, installable, upstreamCandidates }
