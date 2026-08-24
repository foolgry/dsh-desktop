#!/usr/bin/env node
/**
 * CI smoke test: boot `dsh web` straight from the installed dependency tree
 * and require three consecutive HTTP 200s — the same readiness rule the
 * desktop shell applies. Catches a pinned upstream whose web entry no longer
 * boots (bad publish, missing peer-only dep) before installers ship.
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
const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))

const child = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(PORT)], {
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (chunk) => process.stdout.write(chunk))
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
      stableAnswers = res.ok ? stableAnswers + 1 : 0
      if (stableAnswers >= 3) return
    } catch {
      stableAnswers = 0
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`dsh did not answer on port ${PORT} within ${READY_TIMEOUT_MS / 1000}s`)
}

try {
  await ready()
  console.log(`smoke: dsh web ready on 127.0.0.1:${PORT}`)
} catch (error) {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  child.kill()
}
