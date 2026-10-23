import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import type { SiteFiles } from '#cloud/runtime/site/server'
import { getMimeType } from 'hono/utils/mime'

/** The built site's files in `directory`, never anything outside it. */
export function nodeSiteFiles(directory: string): SiteFiles {
  const root = resolve(directory)
  return async (path) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      return null
    }
    const file = resolve(root, `.${decoded}`)
    if (!file.startsWith(`${root}${sep}`)) return null
    try {
      return {
        body: new Uint8Array(await readFile(file)),
        // Documents such as the editor's demo `.fig` have no registered type.
        type: getMimeType(decoded) ?? 'application/octet-stream'
      }
    } catch {
      return null
    }
  }
}
