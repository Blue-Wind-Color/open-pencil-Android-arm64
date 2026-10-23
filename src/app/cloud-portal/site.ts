import { useLocalStorage } from '@vueuse/core'

import {
  CloudPortalAPIError,
  createCloudPortalClient,
  discoverCloud,
  type CloudPortalClient
} from '@open-pencil/cloud/client'
import type { CloudAccountStatus } from '@open-pencil/cloud/contract'

/**
 * A Cloud server serves the editor to signed-in people and, where the server allows the local
 * editor, to visitors who chose to use it without an account; everyone else gets the welcome
 * page first.
 */
export const WELCOME_PATH = '/welcome'

const CLOUD_LINK_PATH = /^\/cloud\/(documents|share|invitations)\/[^/]+$/

/**
 * Whether an address is a link to a document, a shared file, or an invitation, which sign in on
 * their own: it names its server, and a shared file or invitation carries its secret.
 */
export function isCloudLink(url: URL): boolean {
  const [, kind] = url.pathname.match(CLOUD_LINK_PATH) ?? []
  if (!kind || !url.searchParams.get('server')) return false
  return kind === 'documents' || url.hash.length > 1
}

/** Whether this browser chose to use the server's editor without an account. */
const localEditor = useLocalStorage('open-pencil:cloud-site-local', false, {
  // Written before the page leaves for the editor.
  flush: 'sync',
  writeDefaults: false
})

/** Opens the server's editor without an account, now and on later visits from this browser. */
export function openLocalEditor(): void {
  localEditor.value = true
  globalThis.location.assign('/')
}

/** Who is signed in to the server, or `unreachable` when it cannot say. */
export type SiteAccount = CloudAccountStatus | null | 'unreachable'

/**
 * Where a visit to an editor page belongs: null for the editor, or the welcome page, which sends
 * an account waiting for review on to its standing page. An account that may use the server
 * gets the editor, and so does an unreachable server, since the editor works without it.
 * Without an account, the root asks first unless this browser chose the local editor, and every
 * page does where the server does not allow it.
 */
export function siteDestination(visit: {
  path: string
  account: SiteAccount
  localEditor: boolean
  choseLocalEditor: boolean
}): string | null {
  const { path, account } = visit
  if (account === 'unreachable' || account?.state === 'active') return null
  if (visit.localEditor && (path !== '/' || visit.choseLocalEditor)) return null
  return WELCOME_PATH
}

async function signedInAccount(api: CloudPortalClient): Promise<SiteAccount> {
  try {
    return await api.accountStatus()
  } catch (error) {
    if (error instanceof CloudPortalAPIError && error.kind === 'authentication-required')
      return null
    console.warn('[Cloud] Could not read who is signed in', error)
    return 'unreachable'
  }
}

/**
 * Before the editor boots on a Cloud server: leaves for the welcome page when the visit belongs
 * there (`siteDestination`). Returns whether the editor should boot. A server whose discovery
 * fails is taken not to allow the local editor; one that cannot say who is signed in at all is
 * unreachable, and the editor opens.
 */
export async function enterCloudSite(location: Location = globalThis.location): Promise<boolean> {
  if (isCloudLink(new URL(location.href))) return true
  const [discovery, account] = await Promise.all([
    discoverCloud(location.origin).catch(() => null),
    signedInAccount(createCloudPortalClient({ baseURL: location.origin }))
  ])
  const destination = siteDestination({
    path: location.pathname,
    account,
    localEditor: discovery?.localEditor ?? false,
    choseLocalEditor: localEditor.value
  })
  if (!destination) return true
  location.replace(destination)
  return false
}
