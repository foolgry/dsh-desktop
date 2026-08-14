# DSH Desktop — task runner. Requires pnpm and just.

default:
    @just --list

# Install dependencies
install:
    pnpm install

# Run the app from source (needs pnpm install first)
dev:
    pnpm run dev

# Type-check and compile the main process
build:
    pnpm run build

# Build the macOS installer (dmg + zip) into dist-installer/
dist-mac:
    pnpm run dist:mac

# Build the Windows installer (nsis) into dist-installer/
dist-win:
    pnpm run dist:win

# Check npm for a new @deepseek-ai/dsh release and bump this package
sync:
    node scripts/sync-upstream.mjs

# Start the docs dev server (VitePress) at http://localhost:5173
docs:
    pnpm docs:dev

# Build the docs site into docs/.vitepress/dist
docs-build:
    pnpm docs:build
