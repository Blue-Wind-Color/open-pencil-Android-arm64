import { encodeParam, parseURL, withFragment, withQuery } from 'ufo'

/** The two kinds of Cloud link that carry a secret: invitations and documents shared by link. */
export type CloudLinkKind = 'invitations' | 'share'

/**
 * A link on an instance's public editor, `appURL`, naming the server it belongs to. Canonical
 * links come from the owning instance, never the caller's window; a secret travels in the
 * fragment, so it never reaches access logs or `Referer` headers.
 */
function editorLink(
  appURL: string | undefined,
  path: string,
  query: Record<string, string | undefined>,
  secret?: string
): string {
  if (!appURL) throw new Error('This instance does not advertise a public editor URL')
  const { protocol, host } = parseURL(appURL)
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error('The public editor URL must use HTTP or HTTPS')
  }
  const link = withQuery(`${protocol}//${host}${path}`, query)
  return secret ? withFragment(link, secret) : link
}

/** An invitation to a document or a workspace, `/cloud/invitations/:id?server=…#token`. */
export function cloudInvitationURL(
  appURL: string | undefined,
  serverURL: string,
  invitationId: string,
  token: string
): string {
  return editorLink(
    appURL,
    `/cloud/invitations/${encodeParam(invitationId)}`,
    { server: serverURL },
    token
  )
}

/** A document shared by link, `/cloud/share/:id?server=…#secret`. */
export function cloudShareURL(
  appURL: string | undefined,
  serverURL: string,
  shareId: string,
  secret: string
): string {
  return editorLink(appURL, `/cloud/share/${encodeParam(shareId)}`, { server: serverURL }, secret)
}

/**
 * A document's address for its members, `/cloud/documents/:id?server=…`, or one of its versions
 * with `&version=…`. It carries no secret: whoever opens it signs in, and the server decides.
 */
export function cloudDocumentURL(
  appURL: string | undefined,
  serverURL: string,
  documentId: string,
  versionId: string | null = null
): string {
  return editorLink(appURL, cloudDocumentPath(documentId), {
    server: serverURL,
    version: versionId ?? undefined
  })
}

export function cloudDocumentPath(documentId: string): string {
  return `/cloud/documents/${encodeParam(documentId)}`
}

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
  return withFragment(
    withQuery(`openpencil://cloud/${kind}/${encodeParam(id)}`, { server: serverURL }),
    secret
  )
}
