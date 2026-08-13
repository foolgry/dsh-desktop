/**
 * Sync-upstream entry for CI and `just sync`: polls npm for the latest
 * `@deepseek-ai/dsh`, and when it moved (or --force is passed) bumps the
 * dependency and computes the next desktop version.
 *
 * Desktop version scheme, designed to stay valid semver and strictly
 * increasing under electron-updater:
 * - upstream prerelease (e.g. 0.1.0-rc.6) → append a build number as an extra
 *   prerelease segment: 0.1.0-rc.6.1, 0.1.0-rc.6.2, …
 * - upstream stable (e.g. 0.1.0) → independent patch line starting at
 *   X.Y.(Z+1), bumped until it exceeds the current desktop version
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
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import semver from 'semver'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATH = join(ROOT, 'package.json')
const UPSTREAM = '@deepseek-ai/dsh'

/** Latest published upstream version, straight from the npm registry. */
function upstreamLatest() {
  return execFileSync('npm', ['view', UPSTREAM, 'version'], { encoding: 'utf8' }).trim()
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
    // Same upstream release already packaged (a --force rebuild): bump the
    // trailing build number; a fresh upstream release starts it at 1.
    candidate = current.startsWith(`${upstream}.`)
      ? semver.inc(current, 'prerelease')
      : `${upstream}.1`
  } else {
    // Stable upstream: independent patch line above it.
    candidate = `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
  }
  // Never publish a version that is not strictly newer (e.g. upstream
  // released the patch we had already claimed).
  while (!semver.gt(candidate, current)) {
    candidate = semver.inc(candidate, 'patch')
  }
  return candidate
}

const force = process.argv.includes('--force')
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
const latest = upstreamLatest()
const pinned = pkg.dependencies[UPSTREAM]
const changed = force || pinned !== latest

if (!changed) {
  console.log(`upstream unchanged at ${latest}; nothing to do`)
} else {
  const version = nextVersion(pkg.version, latest)
  pkg.dependencies[UPSTREAM] = latest
  pkg.version = version
  pkg.dsh = { ...pkg.dsh, upstream: UPSTREAM, upstreamVersion: latest }
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`upstream ${pinned} -> ${latest}; desktop version -> ${version}`)
}

const outputs = {
  changed: String(changed),
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
