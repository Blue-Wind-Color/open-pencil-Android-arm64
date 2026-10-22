import { CLOUD_PORTAL_PAGE_ROOTS } from '#cloud/contract'
import { withIndexingPolicy } from '#cloud/server'
import { Hono } from 'hono'

/** A file of the built portal (`bun run build:cloud-portal`). */
export type PortalFile = { body: ReadableStream | Uint8Array<ArrayBuffer>; type: string }

/** Reads the built portal's file at a URL path, or null when there is none. */
export type PortalFiles = (path: string, request: Request) => Promise<PortalFile | null>

const PAGE_PATH = '/cloud.html'

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-cache',
  // Desktop sign-in approval must never be framed by another site.
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
}

export type CloudServerOptions = {
  /** The built portal; without it, sign-in, account, and administration pages answer 404. */
  portal?: PortalFiles
  indexingPolicy: 'allow' | 'deny'
}

/**
 * A Cloud server as every runtime serves it: the portal's `cloud.html` at portal pages, the API
 * everywhere else, and the portal's assets and icons where the API has nothing.
 */
export function createCloudServer(
  api: { fetch(request: Request): Response | Promise<Response> },
  { portal, indexingPolicy }: CloudServerOptions
) {
  const server = new Hono()
  server.use(async (c, next) => {
    await next()
    c.res = withIndexingPolicy(c.res, c.req.path, indexingPolicy)
  })
  if (portal) {
    const pages = ['/', ...CLOUD_PORTAL_PAGE_ROOTS.flatMap((root) => [root, `${root}/*`])]
    server.on(['GET', 'HEAD'], pages, async (c) => {
      const page = await portal(PAGE_PATH, c.req.raw)
      return page ? c.body(page.body, 200, PAGE_HEADERS) : c.notFound()
    })
    server.on(['GET', 'HEAD'], '*', async (c, next) => {
      await next()
      if (c.res.status !== 404 || c.req.path === PAGE_PATH) return
      const file = await portal(c.req.path, c.req.raw)
      if (!file) return
      c.res = new Response(file.body, {
        headers: {
          'Content-Type': file.type,
          'Cache-Control': c.req.path.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    })
  }
  server.all('*', (c) => api.fetch(c.req.raw))
  return server
}
