# Installation

DSH Desktop ships as a ready-to-run installer — no Node.js, npm, or terminal needed on your machine.

## Download

Grab the latest build from the [Releases](https://github.com/foolgry/dsh-desktop/releases) page.

### macOS (Apple Silicon / M-series)

Homebrew is the recommended install — one command does everything:

```sh
brew install --cask foolgry/tap/dsh-desktop && xattr -cr "/Applications/DSH Desktop.app"
```

The `xattr -cr` clears the quarantine attribute on the unnotarized app, preventing the "damaged" error on first launch. Installed via Homebrew, future updates are one click away in the app's update dialog ("Update via Homebrew" — see **Updates** below).

Or download `DSH-Desktop-*-mac-arm64.dmg` from Releases and install manually. The app is **unsigned**, so on first launch:

- If macOS says it "cannot verify the developer": **right-click the app → Open**.
- If it says **"DSH Desktop is damaged and can't be opened"**: run the `xattr` command above once in **Terminal**, then it opens normally.

### Windows (64-bit)

Download `DSH-Desktop-*-win-x64-setup.exe`.

SmartScreen will warn about risk — click **More info → Run anyway**.

## Updates

The app checks for new releases automatically every 4 hours after launch:

- **Windows**: the update downloads in the background; click "Restart and update" in the dialog to apply it, or it is installed automatically the next time the app quits.
- **macOS** (unsigned, so it cannot update itself): a dialog announces the new version. If the app was installed via Homebrew, "Update via Homebrew" runs `brew upgrade --cask dsh-desktop` + `xattr -cr` for you and restarts the app; otherwise a button opens the Releases page for a manual download.

::: tip
New desktop builds track the upstream `@deepseek-ai/dsh` npm package. A version like `0.1.0-rc.6.8` means "the 8th desktop build based on upstream `0.1.0-rc.6`".
:::
