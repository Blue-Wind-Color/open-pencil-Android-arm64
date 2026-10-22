import { describe, expect, test } from 'bun:test'

import { createCloudServer, type PortalFiles } from '#cloud/runtime/portal/server'

const files: Record<string, string> = {
  '/cloud.html': '<!doctype html><title>Portal</title>',
  '/assets/cloud-abc.js': 'export {}',
  '/favicon.svg': '<svg/>'
}

const portal: PortalFiles = async (path) => {
  const text = files[path]
  return text === undefined
    ? null
    : {
        body: Uint8Array.from(new TextEncoder().encode(text)),
        type: path.endsWith('.svg') ? 'image/svg+xml' : 'text/plain'
      }
}

const api = {
  fetch: (request: Request) =>
    new URL(request.url).pathname === '/api/session'
      ? Response.json({ ok: true })
      : new Response('Not found', { status: 404 })
}

const server = createCloudServer(api, { portal, indexingPolicy: 'deny' })
const request = (path: string, method = 'GET') =>
  server.request(new Request(`https://cloud.example${path}`, { method }))

describe('Cloud server', () => {
  test('serves the page at portal paths, never framed and never cached', async () => {
    const page = await request('/cloud/device?user_code=ABCD')
    expect(await page.text()).toContain('Portal')
    expect(page.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
    expect(page.headers.get('Cache-Control')).toBe('no-cache')
    expect((await request('/account')).status).toBe(200)
    expect(await (await request('/')).text()).toContain('Portal')
  })

  test('leaves other paths and methods to the API', async () => {
    expect(await (await request('/api/session')).json()).toEqual({ ok: true })
    expect((await request('/account', 'POST')).status).toBe(404)
  })

  test('serves hashed assets as immutable and icons briefly cached where the API has nothing', async () => {
    const asset = await request('/assets/cloud-abc.js')
    expect(await asset.text()).toBe('export {}')
    expect(asset.headers.get('Cache-Control')).toContain('immutable')
    const icon = await request('/favicon.svg')
    expect(icon.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(icon.headers.get('Cache-Control')).not.toContain('immutable')
    expect((await request('/assets/missing.js')).status).toBe(404)
    expect((await request('/cloud.html')).status).toBe(404)
  })

  test('applies the indexing policy to every answer', async () => {
    for (const path of ['/account', '/api/session', '/favicon.svg']) {
      expect((await request(path)).headers.get('X-Robots-Tag')).toContain('noindex')
    }
  })

  test('answers 404 at portal paths without a portal build', async () => {
    const bare = createCloudServer(api, { indexingPolicy: 'allow' })
    expect((await bare.request('https://cloud.example/account')).status).toBe(404)
  })
})
