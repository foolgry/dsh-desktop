# Installation

DSH Desktop ships as a ready-to-run installer — no Node.js, npm, or terminal needed on your machine.

## Download

Grab the latest build from the [Releases](https://github.com/foolgry/dsh-desktop/releases) page.

### macOS (Apple Silicon / M-series)

Download `DSH-Desktop-*-mac-arm64.dmg`.

The app is **unsigned**, so on first launch:

- If macOS says it "cannot verify the developer": **right-click the app → Open**.
- If it says **"DSH Desktop is damaged and can't be opened"**: this is the notarization quarantine attribute. Run this once in **Terminal**, then it opens normally:

  ```sh
  xattr -cr "/Applications/DSH Desktop.app"
  ```

### Windows (64-bit)

Download `DSH-Desktop-*-win-x64-setup.exe`.

SmartScreen will warn about risk — click **More info → Run anyway**.

## Updates

The app checks for new releases automatically every 4 hours after launch. Windows installs updates automatically; macOS (unsigned) shows a dialog with a download link.

::: tip
New desktop builds track the upstream `@deepseek-ai/dsh` npm package. A version like `0.1.0-rc.6.8` means "the 8th desktop build based on upstream `0.1.0-rc.6`".
:::
