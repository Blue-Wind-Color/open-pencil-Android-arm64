import { IS_CLOUD_SITE } from '@/constants'

import { checkCloudAvailability } from '../availability'
import { cloudSignedIn } from '../connect/flow'
import {
  forgetCloudDocumentLink,
  openCloudDocumentLink,
  readCloudDocumentLink,
  resumeCloudDocumentLink
} from '../documents/link'
import { resumeCloudInvitation } from '../invitations/flow'
import {
  bindDesktopCloudLinks,
  forgetCloudLink,
  openCloudLink,
  readCloudLink,
  resumeCloudLink
} from '../links'
import { addCloudSiteServer, cloudServers, findCloudServer } from '../servers/store'
import { refreshCloudConnection } from './connection'
import { takePendingCloudSignIn } from './sign-in'

/**
 * Adds the server that serves this editor, if one does, checks every known server once the app
 * starts, finishes a sign-in this tab left for the server's pages to do, and opens an invitation,
 * a shared link, or a document link the tab was opened with, or the desktop app was sent. A
 * link's secret is taken out of the address at once.
 */
export async function startCloudSessions(options: {
  /** Leaves a Cloud link's address, so its secret is not kept in history. */
  leaveLinkAddress(): Promise<unknown>
}): Promise<void> {
  if (IS_CLOUD_SITE) await addCloudSiteServer()
  void checkCloudAvailability(globalThis.location.href)
  const address = new URL(globalThis.location.href)
  const link = readCloudLink(address)
  const documentLink = readCloudDocumentLink(address)
  // The link the tab opens with is the one to open, not one kept from an earlier sign-in.
  if (documentLink || link) {
    forgetCloudDocumentLink()
    forgetCloudLink()
  }
  resumeCloudDocumentLink()
  resumeCloudLink()
  if (link) await options.leaveLinkAddress()
  const pending = takePendingCloudSignIn()
  await Promise.all(cloudServers.value.map((server) => refreshCloudConnection(server)))
  const server = pending ? findCloudServer(pending) : null
  if (server) cloudSignedIn.value = { serverId: server.id }
  if (link?.kind !== 'invitations') resumeCloudInvitation()
  if (link) await openCloudLink(link)
  if (documentLink) await openCloudDocumentLink(documentLink)
  await bindDesktopCloudLinks()
}
