import { fromUint8Array } from 'js-base64'

import type { DocumentDownload } from '@open-pencil/cloud/contract'

import type { StorageTransferProgress } from '../types'

export async function cloudChecksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return fromUint8Array(new Uint8Array(digest))
}

/** A revision's bytes from the object store, checked against what the server recorded. */
export async function downloadCloudRevision(
  download: DocumentDownload,
  objectFetch: (input: string, init: RequestInit) => Promise<Response>,
  options: { signal?: AbortSignal; onProgress?: (progress: StorageTransferProgress) => void } = {}
): Promise<Uint8Array> {
  const response = await objectFetch(download.download.url, {
    method: download.download.method,
    headers: download.download.headers,
    signal: options.signal
  })
  if (!response.ok) throw new Error(`Cloud document download failed with HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (
    bytes.byteLength !== download.byteSize ||
    (await cloudChecksum(bytes)) !== download.checksum
  ) {
    throw new Error('The downloaded Cloud document does not match what the server stored')
  }
  options.onProgress?.({ transferredBytes: bytes.byteLength, totalBytes: download.byteSize })
  return bytes
}

/**
 * Reads exactly `length` bytes of a response, stopping a body that runs past them rather than
 * receiving the rest.
 */
async function readExactly(response: Response, length: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(length)
  let received = 0
  const reader = response.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (received + value.byteLength > length) {
        await reader.cancel()
        throw new Error(`Cloud document range read sent more than the ${length} bytes asked for`)
      }
      bytes.set(value, received)
      received += value.byteLength
    }
  }
  if (received !== length) {
    throw new Error(`Cloud document range read sent ${received} of the ${length} bytes asked for`)
  }
  return bytes
}

/**
 * Bytes `start` to `endExclusive` of a revision, for reading its preview without the rest. Only
 * a partial response of exactly that range counts: a store that ignores the range, or answers
 * another one, is stopped rather than left sending the file. `Content-Range` is checked when the
 * store's CORS rules let the browser read it.
 */
export async function readCloudRevisionRange(
  download: DocumentDownload,
  objectFetch: (input: string, init: RequestInit) => Promise<Response>,
  start: number,
  endExclusive: number
): Promise<Uint8Array> {
  const response = await objectFetch(download.download.url, {
    method: download.download.method,
    headers: { ...download.download.headers, Range: `bytes=${start}-${endExclusive - 1}` }
  })
  const range = response.headers.get('Content-Range')
  if (
    response.status !== 206 ||
    (range && !range.startsWith(`bytes ${start}-${endExclusive - 1}/`))
  ) {
    await response.body?.cancel()
    throw new Error(
      `Cloud document range read failed with HTTP ${response.status}${range ? ` (${range})` : ''}`
    )
  }
  return readExactly(response, endExclusive - start)
}
