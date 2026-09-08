#!/usr/bin/env node
/**
 * CI smoke test: boot `dsh web` straight from the installed dependency tree
 * and verify it serves the UI. Catches a pinned upstream whose web entry no
 * longer boots (bad publish, missing peer-only dep) before installers ship.
 *
 * The child runs on Electron's embedded Node (ELECTRON_RUN_AS_NODE) — the
 * exact runtime the desktop shell uses. Native modules are rebuilt for
 * Electron's ABI before this step, so booting under the setup-node binary
 * would exercise a different NODE_MODULE_VERSION than what ships, and a
 * module that only loads under plain Node would pass here and crash for
 * users (fs-ext in 0.1.3-alpha.2 did exactly that).
 *
 * Two probes:
 * 1. readiness — three consecutive HTTP answers of any status, the same
 *    crash-window rule the desktop shell applies (binds the port before the
 *    plugin tree loads, then may die). Any status counts: 0.1.2-alpha.2 put
 *    the UI behind a token login, so anonymous probes now get 401 forever —
 *    requiring a specific status couples the smoke test to one auth design.
 * 2. authenticated UI — exchange the stdout token for a session cookie and
 *    require a final 200, proving a user can actually open the app.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const PORT = 3999
const READY_TIMEOUT_MS = 90_000

const require = createRequire(import.meta.url)
const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
// `electron` the package exports the path of the downloaded binary when
// required from plain Node — not Electron's main-process API.
const electronBin = require('electron')
const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))

// --expose-internals mirrors the shell: cordis-plugin-hmr's HMR service reads
// Node internals that are hidden by default.
const child = spawn(electronBin, ['--expose-internals', bin, 'web', '--no-open', '--port', String(PORT)], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
// Chunks can split the `?token=` line, so matches accumulate across chunks.
let stdoutTail = ''
let token
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  stdoutTail += chunk.toString()
  if (token === undefined) {
    const match = stdoutTail.match(/[?&]token=([A-Za-z0-9._-]+)/)
    if (match) token = match[1]
  }
  stdoutTail = stdoutTail.slice(-512)
})
child.stderr.on('data', (chunk) => process.stderr.write(chunk))

async function ready() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let stableAnswers = 0
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh exited with code ${child.exitCode} before becoming ready`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`)
      // Any answer proves the HTTP stack is up; see the file comment.
      stableAnswers++
      if (stableAnswers >= 3) return
    } catch {
      stableAnswers = 0
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`dsh did not answer on port ${PORT} within ${READY_TIMEOUT_MS / 1000}s`)
}

/**
 * Follow dsh's token login by hand (undici keeps no cookie jar): GET the
 * token URL without following the 303, carry the issued session cookie to
 * `/`, and require the UI to answer 200.
 */
async function authenticatedUi() {
  if (token === undefined) {
    throw new Error('no ?token= in `dsh web` output — the UI would be unreachable')
  }
  const exchange = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: 'manual' })
  const cookies = exchange.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
  const ui = await fetch(`http://127.0.0.1:${PORT}/`, {
    ...(cookies ? { headers: { cookie: cookies } } : {}),
  })
  if (!ui.ok) {
    throw new Error(`authenticated UI probe failed: token exchange ${exchange.status}, follow-up ${ui.status}`)
  }
}

try {
  await ready()
  console.log(`smoke: dsh web answering on 127.0.0.1:${PORT}`)
  await authenticatedUi()
  console.log(`smoke: authenticated UI answered 200 on 127.0.0.1:${PORT}`)
} catch (error) {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  child.kill()
}
