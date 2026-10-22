import { useLocalStorage } from '@vueuse/core'
import { ref } from 'vue'

import { createCloudAPIClient } from '@open-pencil/cloud/client'
import { randomHex } from '@open-pencil/scene-graph/random'

import { useCollabIdentity } from '@/app/collab/identity'
import { downloadCloudDocument } from '@/app/integrations/storage/cloud/download'
import { storageFetch } from '@/app/integrations/storage/s3/fetch'
import { getTabForStore, openFileInNewTab } from '@/app/tabs'
import { IS_BROWSER } from '@/constants'

import { sharedCloudRoomImages } from '../rooms/images'
import {
  cloudRelayTransport,
  leaveRefusedRoom,
  openCloudDocumentRoom,
  stopWithTab
} from '../rooms/live'
import { normalizeCloudServerURL } from '../servers/address'
import { cloudFetch, discoverCloudServer } from '../sessions/connection'

/** Who this browser is to rooms it joins from links, kept so a guest stays the same person. */
const guestId = IS_BROWSER
  ? useLocalStorage('open-pencil:cloud-guest-id', randomHex(16))
  : ref(randomHex(16))

export type CloudShareLink = { shareId: string; server: string; secret: string }

/**
 * Opens a document someone shared by link: its latest revision in a tab of its own, then its
 * room as a guest with the link's permission. A guest has no account on the server, so the tab
 * is a copy that never saves there; edits reach the document through the room.
 */
export async function openCloudShareLink(link: CloudShareLink): Promise<void> {
  const url = normalizeCloudServerURL(link.server)
  if (!url) throw new TypeError('The link names no server')
  const discovery = await discoverCloudServer(url)
  const client = createCloudAPIClient(discovery.apiURL, { fetch: cloudFetch })
  const input = {
    secret: link.secret,
    guestName: useCollabIdentity().name.value,
    guestId: guestId.value
  }
  const { document } = await client.getSharedDocument(link.shareId, input)
  const bytes = await downloadCloudDocument(document, (input, init) => storageFetch(input, init))
  const name = document.document.name
  const store = await openFileInNewTab(
    new File([Uint8Array.from(bytes)], `${name}.fig`, { type: 'application/octet-stream' })
  )
  if (!discovery.capabilities.collaboration) return
  const first = await client.getSharedCollaborationTicket(link.shareId, input)
  // The tab may have closed while the ticket was on its way.
  if (first.provider !== 'relay' || !first.serverURL || !getTabForStore(store)) return
  const room = openCloudDocumentRoom(store, {
    roomId: first.roomId,
    transport: cloudRelayTransport(
      first.serverURL,
      first,
      () => client.getSharedCollaborationTicket(link.shareId, input),
      // A guest has no account to save with, so leaving is all a refusal changes.
      { onRefused: () => leaveRefusedRoom(store, { permission: first.permission, canSave: false }) }
    ),
    permission: first.permission,
    guest: true,
    images: sharedCloudRoomImages(client, link.shareId, input)
  })
  stopWithTab(store, room)
}
