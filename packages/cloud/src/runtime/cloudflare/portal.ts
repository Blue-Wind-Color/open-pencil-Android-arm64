import type { PortalFiles } from '#cloud/runtime/portal/server'

/** The built portal's files from the Worker's static assets. */
export function assetPortalFiles(assets: Fetcher): PortalFiles {
  return async (path, request) => {
    const file = await assets.fetch(new URL(path, request.url))
    if (!file.ok || !file.body) return null
    return {
      body: file.body,
      type: file.headers.get('Content-Type') ?? 'application/octet-stream'
    }
  }
}
