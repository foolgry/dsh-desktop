/**
 * DSH Desktop main process: boots `dsh web` on the first free loopback port
 * (3080 upward) with Electron's embedded Node, waits for readiness, then loads
 * the UI in a single BrowserWindow. Owns the child process lifecycle, log
 * capture, navigation guards, and auto-updates.
 * @module dsh-desktop/main
 */

import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

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
    // Used by window chrome on win/linux; ignored on macOS (dock icon is set
    // separately at startup).
    icon: devIcon(),
  })
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show DSH Desktop', click: () => showWindow(port) },
      { type: 'separator' },
      {
        label: 'Quit DSH Desktop',
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

/** Run a command with output appended to the dsh log; resolves the exit code. */
function runLogged(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    appendFileSync(logFile(), `\n=== update: ${command} ${args.join(' ')} ===\n`)
    const child = spawn(command, args)
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
      title: 'Update failed',
      message: 'The Homebrew upgrade did not complete.',
      detail: `See the log for brew's output: ${logFile()}\nYou can also install the latest version manually from the releases page.`,
      buttons: ['Open releases page', 'Later'],
    })
    if (response === 0) void shell.openExternal(RELEASES_URL)
    return
  }
  await runLogged('/usr/bin/xattr', ['-cr', appBundlePath()])
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Update installed',
    message: 'The new version was installed via Homebrew.',
    detail: 'Restart DSH Desktop now to use it?',
    buttons: ['Restart', 'Later'],
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
    title: 'Update available',
    message: `DSH Desktop ${version} is available.`,
    detail: brewManaged
      ? 'This installation is managed by Homebrew and can be upgraded in place, then the app restarts.'
      : 'macOS builds are unsigned and cannot update themselves. Download the latest installer from the releases page.',
    buttons: brewManaged ? ['Update via Homebrew', 'Download from GitHub', 'Later'] : ['Open releases page', 'Later'],
  })
  if (brewManaged && response === 0) await runBrewUpdate()
  else if (response === (brewManaged ? 1 : 0)) void shell.openExternal(RELEASES_URL)
}

/** Version already prompted for this run, so 4-hourly checks don't re-nag. */
let promptedVersion: string | undefined
/** Set once a background download starts; gates the error dialog to real
 * download failures instead of transient network errors from checkForUpdates. */
let downloadInFlight = false

/**
 * Wire electron-updater: check on start and then every 4 hours. Windows
 * downloads in the background and offers a restart-to-update dialog; macOS
 * skips the doomed self-update (unsigned builds) and goes straight to the
 * Homebrew / manual-download prompt.
 */
function setupAutoUpdate(): void {
  if (!app.isPackaged) return
  void import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.autoDownload = process.platform !== 'darwin'
    autoUpdater.on('update-available', (info) => {
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
          title: 'Update ready',
          message: `DSH Desktop ${info.version} has been downloaded.`,
          detail: 'Restart now to apply the update. Without a restart it is applied the next time the app quits.',
          buttons: ['Restart and update', 'Later'],
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
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
/** Port the dsh server bound; kept so hidden-window restores can recreate the window. */
let serverPort = 0
/** Set only by an explicit quit (tray menu, Cmd+Q); guards the close-to-tray interception. */
let quitting = false

async function boot(): Promise<void> {
  const port = await pickPort()
  serverPort = port
  presetBundledPlugins()
  dshChild = startDsh(port)
  await waitReady(port, dshChild)
  mainWindow = createWindow(port)
  createTray(port)
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

  // Explicit quit paths (tray "Quit", Cmd+Q, boot-failure quit) flip this so
  // the window's close handler lets the window actually close.
  app.on('before-quit', () => {
    quitting = true
  })
  // The app lives in the tray once the window is closed; never quit just
  // because no window is open (issue #3).
  app.on('window-all-closed', () => {})
  // macOS dock click while running in the tray reopens the window.
  app.on('activate', () => {
    if (serverPort && !mainWindow?.isVisible()) showWindow(serverPort)
  })
  app.on('will-quit', () => {
    tray?.destroy()
    if (dshChild && dshChild.exitCode === null) dshChild.kill()
  })
}
