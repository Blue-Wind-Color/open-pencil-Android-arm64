import { deflateSync, inflateSync } from 'fflate'
import { decompress as fzstdDecompressSync } from 'fzstd'

import { isZstdCompressed } from './protocol'

export const FIG_KIWI_DEFAULT_VERSION = 101

/** Compresses a fig-kiwi data chunk. */
export type FigDataCompressor = (data: Uint8Array) => Uint8Array

/** The zstd level Figma itself saves with. */
export const FIG_ZSTD_DEFAULT_LEVEL = 3

type BunZstdCompress = (data: Uint8Array, options?: { level?: number }) => Uint8Array

function bunZstdCompress(): BunZstdCompress | undefined {
  const g = globalThis as { Bun?: { zstdCompressSync?: BunZstdCompress } }
  return g.Bun?.zstdCompressSync
}

/**
 * Bun's zstd at its default level, or deflate where zstd needs loading first. Figma reads both,
 * so writers that cannot wait, such as the clipboard, use this one.
 */
export const defaultFigDataCompressor: FigDataCompressor = (data) =>
  bunZstdCompress()?.(data) ?? deflateSync(data)

let wasmZstd: Promise<(data: Uint8Array, level: number) => Uint8Array> | undefined

/** The WebAssembly zstd encoder, loaded once; a failed load is retried on the next call. */
export async function loadWasmFigDataCompressor(
  level = FIG_ZSTD_DEFAULT_LEVEL
): Promise<FigDataCompressor> {
  wasmZstd ??= import('@hpcc-js/wasm-zstd')
    .then(({ Zstd }) => Zstd.load())
    .then(
      (zstd) => (data: Uint8Array, compressionLevel: number) =>
        zstd.compress(data, compressionLevel)
    )
    .catch((error: unknown) => {
      wasmZstd = undefined
      throw error
    })
  const compress = await wasmZstd
  return (data) => compress(data, level)
}

/**
 * A zstd compressor at `level`: Bun's own where it runs, the WebAssembly build elsewhere. Figma
 * opens every level, but only frames that declare their decompressed size, which both write.
 */
export async function loadFigDataCompressor(
  level = FIG_ZSTD_DEFAULT_LEVEL
): Promise<FigDataCompressor> {
  const native = bunZstdCompress()
  if (native) return (data) => native(data, { level })
  return loadWasmFigDataCompressor(level)
}

function bunZstdDecompressSync(data: Uint8Array): Uint8Array | undefined {
  const g = globalThis as { Bun?: { zstdDecompressSync?: (data: Uint8Array) => Uint8Array } }
  return g.Bun?.zstdDecompressSync?.(data)
}

export function parseFigKiwiChunks(binary: Uint8Array): Uint8Array[] | null {
  const header = new TextDecoder().decode(binary.slice(0, 8))
  if (header !== 'fig-kiwi') return null

  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  let offset = 12

  const chunks: Uint8Array[] = []
  while (offset < binary.length) {
    const chunkLen = view.getUint32(offset, true)
    offset += 4
    chunks.push(binary.slice(offset, offset + chunkLen))
    offset += chunkLen
  }
  return chunks.length >= 2 ? chunks : null
}

export function decompressFigKiwiData(compressed: Uint8Array): Uint8Array {
  if (isZstdCompressed(compressed)) {
    const decompressed = bunZstdDecompressSync(compressed)
    if (decompressed) return decompressed
    return fzstdDecompressSync(compressed)
  }

  try {
    return inflateSync(compressed)
  } catch {
    throw new Error('Failed to decompress fig-kiwi data')
  }
}

export async function decompressFigKiwiDataAsync(compressed: Uint8Array): Promise<Uint8Array> {
  if (isZstdCompressed(compressed)) {
    const bunDecompressed = bunZstdDecompressSync(compressed)
    if (bunDecompressed) return bunDecompressed
    return fzstdDecompressSync(compressed)
  }
  try {
    return inflateSync(compressed)
  } catch {
    throw new Error('Failed to decompress fig-kiwi data')
  }
}

export function buildFigKiwi(
  schemaDeflated: Uint8Array,
  dataRaw: Uint8Array,
  version = FIG_KIWI_DEFAULT_VERSION,
  compress: FigDataCompressor = defaultFigDataCompressor
): Uint8Array {
  const dataCompressed = compress(dataRaw)

  const total = 8 + 4 + 4 + schemaDeflated.length + 4 + dataCompressed.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  out.set(new TextEncoder().encode('fig-kiwi'), 0)
  view.setUint32(8, version, true)

  let offset = 12
  view.setUint32(offset, schemaDeflated.length, true)
  offset += 4
  out.set(schemaDeflated, offset)
  offset += schemaDeflated.length

  view.setUint32(offset, dataCompressed.length, true)
  offset += 4
  out.set(dataCompressed, offset)

  return out
}
