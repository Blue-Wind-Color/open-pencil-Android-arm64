import type { CloudDiscovery } from '#cloud/contract'

/** Canonical web links come from the owning instance, never the caller's window. */
function editorURL(discovery: CloudDiscovery, path: string, serverURL: string): URL {
  if (!discovery.appURL) throw new Error('This instance does not advertise a public editor URL')
  const url = new URL(discovery.appURL)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The public editor URL must use HTTP or HTTPS')
  }
  url.pathname = path
  url.search = ''
  url.hash = ''
  url.searchParams.set('server', serverURL)
  return url
}

export function cloudShareURL(
  discovery: CloudDiscovery,
  serverURL: string,
  shareId: string,
  secret: string
): string {
  const url = editorURL(discovery, `/cloud/share/${encodeURIComponent(shareId)}`, serverURL)
  url.hash = secret
  return url.href
}

/**
 * A document's address for its members, `/cloud/documents/:id?server=…`, or one of its versions
 * with `&version=…`. It carries no secret: whoever opens it signs in, and the server decides.
 */
export function cloudDocumentURL(
  discovery: CloudDiscovery,
  serverURL: string,
  documentId: string,
  versionId: string | null = null
): string {
  const url = editorURL(discovery, cloudDocumentPath(documentId), serverURL)
  if (versionId) url.searchParams.set('version', versionId)
  return url.href
}

export function cloudDocumentPath(documentId: string): string {
  return `/cloud/documents/${encodeURIComponent(documentId)}`
}

/** The two kinds of Cloud link that carry a secret: invitations and documents shared by link. */
export type CloudLinkKind = 'invitations' | 'share'

/**
 * The desktop app's form of a Cloud link, `openpencil://cloud/<kind>/<id>?server=…#secret`, which
 * `desktop/src/deep_link.rs` validates before the editor sees it.
 */
export function cloudDesktopLinkURL(
  kind: CloudLinkKind,
  id: string,
  serverURL: string,
  secret: string
): string {
  const url = new URL(`openpencil://cloud/${kind}/${encodeURIComponent(id)}`)
  url.searchParams.set('server', serverURL)
  url.hash = secret
  return url.href
}

/** Accept only same-origin application paths for post-authentication navigation. */
export function cloudRedirectPath(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  const origin = 'https://redirect.invalid'
  const url = new URL(value, origin)
  if (url.origin !== origin) return fallback
  return `${url.pathname}${url.search}${url.hash}`
}
