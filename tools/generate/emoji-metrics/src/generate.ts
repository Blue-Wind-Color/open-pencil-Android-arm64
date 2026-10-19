/**
 * Writes the emoji metrics font into `packages/core/assets` from Noto Color Emoji at a
 * pinned google/fonts commit, with Noto's licence beside it. usage: bun generate.ts
 */
import { join } from 'node:path'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts-tools'

import { EMOJI_METRICS_ASSET, emojiMetricsFont } from './metrics'
import { readFontTables, writeFontTables } from './sfnt'

const SOURCE_COMMIT = '142c8963e7606b510c93a644c82a4c4cdeae6ef9'
const SOURCE = `https://raw.githubusercontent.com/google/fonts/${SOURCE_COMMIT}/ofl/notocoloremoji`
const COPYRIGHT =
  'Copyright 2021 Google Inc. All Rights Reserved. Derived from Noto Color Emoji: metrics only.'

async function download(file: string): Promise<Uint8Array> {
  const response = await fetch(`${SOURCE}/${file}`)
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

const [font, licence] = await Promise.all([
  download('NotoColorEmoji-Regular.ttf'),
  download('OFL.txt')
])
const output = writeFontTables(emojiMetricsFont(readFontTables(font), COPYRIGHT))
const assets = join(await resolveWorkspaceRoot(import.meta.dir), 'packages/core/assets')
await Bun.write(join(assets, EMOJI_METRICS_ASSET), output)
await Bun.write(join(assets, 'OpenPencilEmojiMetrics-OFL.txt'), licence)
console.log(`${EMOJI_METRICS_ASSET}: ${output.length} bytes`)
