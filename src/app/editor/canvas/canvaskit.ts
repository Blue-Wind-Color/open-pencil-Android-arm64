import canvasKitWasm from 'canvaskit-wasm/bin/canvaskit.wasm?url'

import { setCanvasKitLocator } from '@open-pencil/core/canvaskit'

/**
 * Importing CanvasKit's binary as an asset lets Vite serve it in development and emit a hashed
 * copy with the build, so no host keeps a second copy in `public/`. Kept apart from other
 * modules because `?url` imports only resolve in a Vite build, not in the Bun test runner.
 */
export function installCanvasKitBinary(): void {
  setCanvasKitLocator(() => canvasKitWasm)
}
