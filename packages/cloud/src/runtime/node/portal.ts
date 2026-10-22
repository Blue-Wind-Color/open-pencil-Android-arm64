import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import type { PortalFiles } from '#cloud/runtime/portal/server'
import { getMimeType } from 'hono/utils/mime'

/** The built portal's files in `directory`, never anything outside it. */
export function nodePortalFiles(directory: string): PortalFiles {
  const root = resolve(directory)
  return async (path) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      return null
    }
    const type = getMimeType(decoded)
    const file = resolve(root, `.${decoded}`)
    if (!type || !file.startsWith(`${root}${sep}`)) return null
    try {
      return { body: new Uint8Array(await readFile(file)), type }
    } catch {
      return null
    }
  }
}
