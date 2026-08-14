/**
 * DSH Desktop main process: boots `dsh web` on the first free loopback port
 * (3080 upward) with Electron's embedded Node, waits for readiness, then loads
 * the UI in a single BrowserWindow. Owns the child process lifecycle, log
 * capture, navigation guards, and auto-updates.
 * @module dsh-desktop/main
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** First port tried for the dsh web server. */
const FIRST_PORT = 3080
/** Last port tried before giving up. */
const LAST_PORT = 3099
/** How long to wait for the server to answer before declaring boot failure. */
const READY_TIMEOUT_MS = 60_000
/** Release page used as the manual-download fallback when auto-update fails. */
const RELEASES_URL = 'https://github.com/foolgry/dsh-desktop/releases'

/** Directory holding dsh's own state (profiles, sessions), inside userData. */
function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
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
  const args = ['--expose-internals', dshBin(), 'web', '--port', String(port)]
  // win32: the native folder dialog's koffi.node crashes under Electron's ABI
  // (issue #1), so overlay the pure-JS browse picker instead.
  const pickerPatch = ensurePickerFallbackPatch()
  if (pickerPatch) {
    args.push('--patch', pickerPatch)
    appendFileSync(log, `=== win32: using browse directory picker (native koffi crashes under Electron ABI; issue #1) ===\n`)
  }
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
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
 * Poll the server until it answers HTTP or the child dies.
 * @param port - port the server was asked to bind
 * @param child - the dsh child, watched for early exit
 */
async function waitReady(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh exited with code ${child.exitCode} before becoming ready`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      if (res.ok) return
    } catch {
      // connection refused while the server is still booting; keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`dsh did not answer on port ${port} within ${READY_TIMEOUT_MS / 1000}s`)
}

/**
 * Create the single application window pointed at the local server.
 * @param port - port the server bound
 */
function createWindow(port: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DSH Desktop',
    autoHideMenuBar: true,
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
 * Wire electron-updater: check on start and then periodically. Unsigned
 * builds cannot apply updates on macOS, so a failed download falls back to a
 * dialog that opens the release page for manual download.
 */
function setupAutoUpdate(): void {
  if (!app.isPackaged) return
  void import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.autoDownload = true
    autoUpdater.on('error', (error) => {
      appendFileSync(logFile(), `\n=== auto-update error: ${error.message} ===\n`)
      void dialog
        .showMessageBox({
          type: 'info',
          title: 'Update available',
          message: 'A new version is available but could not be installed automatically.',
          detail: 'Download the latest installer from the releases page.',
          buttons: ['Open releases page', 'Later'],
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
  })
}

let dshChild: ChildProcess | undefined

async function boot(): Promise<void> {
  const port = await pickPort()
  dshChild = startDsh(port)
  await waitReady(port, dshChild)
  createWindow(port)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    setupAutoUpdate()
    try {
      await boot()
    } catch (error) {
      dialog.showErrorBox(
        'DSH Desktop failed to start',
        `${error instanceof Error ? error.message : String(error)}\n\nLog: ${logFile()}`,
      )
      app.quit()
    }
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    if (dshChild && dshChild.exitCode === null) dshChild.kill()
  })
}
