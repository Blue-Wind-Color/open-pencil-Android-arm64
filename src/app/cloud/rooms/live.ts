import { effectScope, onScopeDispose, shallowRef, watch } from 'vue'

import { RELAY_SERVER_PEER, type CollaborationTicket } from '@open-pencil/cloud/contract'

import { leaveRoom, openDocumentRoom, roomForStore } from '@/app/collab/rooms'
import type { RoomIdentity, RoomSession } from '@/app/collab/session'
import type { JoinCollabRoom } from '@/app/collab/transport'
import { createCloudRelayJoin } from '@/app/collab/transport/cloud'
import type { EditorStore } from '@/app/editor/session'
import { createStorageAdapter } from '@/app/integrations/storage'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import {
  adoptStoredVersion,
  dropCanvasUploads,
  kickSyncEngine,
  replaceStoredVersion
} from '@/app/storage/sync'
import { onStorageWorkspaceEvent } from '@/app/storage/workspace/events'
import { allTabs, getTabForStore, getTabsSnapshot, reloadStorageDocumentInTab } from '@/app/tabs'

import { isCloudBinding } from '../documents/status'
import { cloudConnection, cloudConnections, type CloudSessionState } from '../sessions/connection'
import { cloudShareTarget } from '../sharing/document'
import { versionsChanged } from '../versions/history'
import { accountRoomIdentity } from './identity'
import { shareRoomUploads, uploadStoredDocument } from './upload'

/** Each Cloud tab's permission in its room, for the status beside the name. */
export const cloudRoomPermissions = shallowRef<ReadonlyMap<EditorStore, 'edit' | 'view'>>(new Map())
const starting = new WeakSet<EditorStore>()

function setPermission(store: EditorStore, permission: 'edit' | 'view' | null) {
  const next = new Map(cloudRoomPermissions.value)
  if (permission) next.set(store, permission)
  else next.delete(store)
  cloudRoomPermissions.value = next
}

/**
 * The editor that saves the room's document: the one with the lowest presence client among
 * signed-in editors, as the relay stamps them. Guests from a link may edit but cannot save.
 * Everyone else sees edits through the room, so nobody's revision conflicts with anyone else's.
 */
export function electCloudSaver(
  presence: ReadonlyMap<number, Record<string, unknown>>,
  self: { clientId: number; canSave: boolean }
): number | null {
  const editors = [...presence]
    .filter(([clientId, state]) => {
      if (clientId === self.clientId) return self.canSave
      const cloud = state.cloud
      if (typeof cloud !== 'object' || cloud === null) return false
      return Reflect.get(cloud, 'permission') === 'edit' && Reflect.get(cloud, 'kind') === 'user'
    })
    .map(([clientId]) => clientId)
  return editors.length ? Math.min(...editors) : null
}

/** Building on the server's latest revision: the room already holds every edit in it. */
async function catchUpWithServer(store: EditorStore): Promise<void> {
  const binding = store.getStorageBinding()
  if (!binding) return
  const documents = await createStorageAdapter(binding).listDocuments()
  const current = documents.find((document) => document.id === binding.documentId)
  if (current?.revision) {
    await getLocalCanvasStore().updateMeta(binding.documentId, { remoteRevision: current.revision })
  }
}

/**
 * Keeps this tab saving only while it is the room's saver, for as long as the current effect
 * scope runs. A tab that stops drops its queued uploads, since the room holds those edits; the
 * saver overwrites a revision it conflicts with, since the room's document already has every edit
 * in it, unless that revision is a restore, which moves the room on instead. Returns whether this
 * tab saves now.
 */
function followSaver(
  store: EditorStore,
  session: RoomSession,
  canSave: boolean,
  roomIsCurrent: () => Promise<boolean>
): () => boolean {
  let saving: boolean | null = null
  const documentId = () => store.getStorageBinding()?.documentId ?? null

  async function decide() {
    const saver = electCloudSaver(session.presence(), { clientId: session.clientId, canSave })
    const next = saver === session.clientId
    if (next === saving) return
    saving = next
    store.state.autosaveEnabled = next
    const id = documentId()
    if (!id) return
    if (!next) {
      await dropCanvasUploads(id)
      return
    }
    if (!(await roomIsCurrent())) return
    await catchUpWithServer(store).catch(() => undefined)
    // Only a stored document saves without asking where; the room never adds a file prompt.
    if (store.getStorageBinding() && store.hasUnsavedChanges()) await store.saveFigFile()
  }

  async function settleConflict(id: string) {
    if (!saving) return
    const meta = await getLocalCanvasStore().getMeta(id)
    if (meta?.syncStatus !== 'conflict' || !(await roomIsCurrent())) return
    await replaceStoredVersion(id)
    await kickSyncEngine()
  }

  watch(session.peers, () => void decide(), { immediate: true })
  // Edits in a tab that does not save are kept by the room and uploaded by the saver, so the
  // tab neither calls them unsaved nor asks about them on closing.
  watch(
    () => store.hasUnsavedChanges(),
    (dirty) => {
      if (dirty && saving === false) store.markDocumentSaved()
    }
  )
  onScopeDispose(
    onStorageWorkspaceEvent((event) => {
      const id = documentId()
      if (id && event.documentId === id) void settleConflict(id)
    })
  )
  return () => saving === true
}

/**
 * Puts a stored document's tab into its room: an empty room takes this tab's document once the
 * relay has answered, one editor saves for everyone, and a viewer never saves.
 */
export function openCloudDocumentRoom(
  store: EditorStore,
  options: {
    roomId: string
    transport: JoinCollabRoom
    permission: 'edit' | 'view'
    /** A guest from a link edits but has no account to save with. */
    guest?: boolean
    /**
     * Whether the document is still in this room; false once it was restored to a version, when
     * the room is left for `onRestored` to move the tab on.
     */
    roomIsCurrent?: () => Promise<boolean>
    onRestored?: () => void
    /** How the saver gets the document onto the server; the tab's own upload unless a test stands in. */
    uploadNow?: () => Promise<boolean>
    /** Who the tab is in the room; the device's own identity unless an account names it. */
    identity?: RoomIdentity
  }
) {
  const canEdit = options.permission === 'edit'
  const canSave = canEdit && !options.guest
  const session = openDocumentRoom(store, options.roomId, options.transport, options.identity)
  // Everything the room follows lives in one scope, so stopping it leaves nothing behind.
  const scope = effectScope(true)
  const uploads = scope.run(() => {
    setPermission(store, options.permission)
    // A viewer sees the room's edits and makes none, as Figma's view-only files do.
    store.setReadOnly(!canEdit)
    if (!canSave) store.state.autosaveEnabled = false
    onScopeDispose(() => {
      setPermission(store, null)
      store.setReadOnly(false)
    })
    // Someone named, renamed, or saved a checkpoint anywhere: an open history loads it again.
    onScopeDispose(session.onVersionsChanged(() => versionsChanged(store)))
    const stopSynced = session.onSynced((peerId) => {
      if (peerId !== RELAY_SERVER_PEER) return
      stopSynced()
      if (canEdit && !session.roomHasDocument()) session.shareDocument()
    })
    onScopeDispose(stopSynced)
    // Unsure whether the document moved on, the saver waits rather than overwrite a restore.
    const saving = followSaver(store, session, canSave, async () => {
      const current = options.roomIsCurrent ? await options.roomIsCurrent().catch(() => null) : true
      if (current === false) options.onRestored?.()
      return current === true
    })
    const shared = shareRoomUploads(session.upload, {
      saving,
      saverPeer: () => {
        const elected = electCloudSaver(session.presence(), { clientId: session.clientId, canSave })
        return elected === null || elected === session.clientId
          ? null
          : (session.peerForClient(elected) ?? null)
      },
      upload: options.uploadNow ?? (() => uploadStoredDocument(store))
    })
    onScopeDispose(() => shared.stop())
    return shared
  })
  if (!uploads) throw new Error('The room could not start')
  return {
    session,
    /** Whether the server now holds the room's document with every edit this tab has seen. */
    upload: uploads.upload,
    stop: () => scope.stop()
  }
}

/**
 * The relay connection for a room, presenting the ticket just issued first and a fresh one from
 * `next` before each expires.
 */
export function cloudRelayTransport(
  url: string,
  first: CollaborationTicket,
  next: () => Promise<CollaborationTicket>,
  onRestored?: () => void
): JoinCollabRoom {
  let unused: CollaborationTicket | null = first
  return createCloudRelayJoin({
    url,
    async ticket() {
      const ticket = unused ?? (await next())
      unused = null
      // A restore moves the document to a new room; this one has nothing left to join.
      if (ticket.roomId !== first.roomId) return null
      return { token: ticket.token, expiresAt: ticket.expiresAt }
    },
    onRestored
  })
}

type LiveRoom = Pick<ReturnType<typeof openCloudDocumentRoom>, 'stop' | 'upload'>

/**
 * Each tab's live Cloud room, stopped when the tab closes or the room starts over, with the
 * watcher that notices the tab closing, which leaving the room stops as well.
 */
const liveRooms = new Map<EditorStore, { room: LiveRoom; stopWatching: () => void }>()
/** The server and account each tab joined its room as, so a change of account joins again. */
const joinedAs = new WeakMap<EditorStore, { serverId: string; accountId: string | null }>()

/** Leaves the room's saving and status behind once its tab closes. */
export function stopWithTab(store: EditorStore, room: LiveRoom): void {
  liveRooms.get(store)?.stopWatching()
  const stopWatching = watch(allTabs, () => {
    if (roomForStore(store)) return
    if (liveRooms.get(store)?.room === room) {
      liveRooms.delete(store)
      room.stop()
    }
    stopWatching()
  })
  liveRooms.set(store, { room, stopWatching })
}

/**
 * Joins a Cloud document's room on its server's relay, when the server runs one. Edits reach
 * everyone in the room as they happen; an empty room takes this tab's document once the relay
 * has answered; a viewer's tab is read-only.
 */
export async function startCloudRoom(store: EditorStore): Promise<void> {
  const binding = store.getStorageBinding()
  if (!binding || !isCloudBinding(binding) || roomForStore(store) || starting.has(store)) return
  const target = cloudShareTarget(binding)
  if (!target?.discovery.capabilities.collaboration) return
  starting.add(store)
  try {
    const first = await target.client.getCollaborationTicket(binding.documentId)
    // The document may have moved, or its tab closed, while the ticket was on its way.
    const current = store.getStorageBinding() === binding && getTabForStore(store)
    if (first.provider !== 'relay' || !first.serverURL || !current) return
    const nextTicket = () => target.client.getCollaborationTicket(binding.documentId)
    const restart = () => void restartCloudRoom(store)
    const account = cloudConnection(target.server.id).account
    joinedAs.set(store, { serverId: target.server.id, accountId: account?.id ?? null })
    const room = openCloudDocumentRoom(store, {
      // The account as the connection knows it now, so a new name reaches the room.
      identity: account
        ? accountRoomIdentity(() => cloudConnection(target.server.id).account ?? account)
        : undefined,
      roomId: first.roomId,
      transport: cloudRelayTransport(first.serverURL, first, nextTicket, restart),
      permission: first.permission,
      roomIsCurrent: async () => (await nextTicket()).roomId === first.roomId,
      onRestored: restart
    })
    stopWithTab(store, room)
  } finally {
    starting.delete(store)
  }
}

/**
 * Gets the document of `store` onto its server as the tab shows it: through the room's saver
 * while the tab is in a room, or by uploading it itself. Whether it got there.
 */
export function uploadCloudDocument(store: EditorStore): Promise<boolean> {
  return liveRooms.get(store)?.room.upload() ?? uploadStoredDocument(store)
}

const restarting = new WeakSet<EditorStore>()

/** Takes the tab out of its room, leaving the document it shows as it is. */
function leaveCloudRoom(store: EditorStore): void {
  const live = liveRooms.get(store)
  live?.stopWatching()
  live?.room.stop()
  liveRooms.delete(store)
  joinedAs.delete(store)
  const session = roomForStore(store)
  if (session) leaveRoom(session)
}

/**
 * Joins the room again as whoever is signed in now, after signing in as another account or out.
 * The relay knows a peer by the account on its ticket, so the old connection cannot carry on.
 */
async function rejoinCloudRoom(store: EditorStore): Promise<void> {
  if (restarting.has(store)) return
  restarting.add(store)
  try {
    leaveCloudRoom(store)
    await startCloudRoom(store)
  } finally {
    restarting.delete(store)
  }
}

/** Sessions that ended for good, unlike a check in progress or a server out of reach for now. */
const ENDED: ReadonlySet<CloudSessionState> = new Set(['signed-out', 'expired', 'closed'])

/**
 * Whether the tab's room was joined as someone the server no longer has signed in here: a session
 * that ended, which can keep its account, or another account or none, as signing out leaves. A
 * check in progress or an outage keeps the account, so it changes nothing.
 */
function accountChanged(store: EditorStore): boolean {
  const joined = joinedAs.get(store)
  if (!joined) return false
  const connection = cloudConnection(joined.serverId)
  if (ENDED.has(connection.state)) return true
  return (connection.account?.id ?? null) !== joined.accountId
}

/**
 * Moves a tab to its document's new room after the document was restored to a version: the old
 * room's edits are left behind, the tab shows the restored document, and it joins again.
 */
export async function restartCloudRoom(store: EditorStore): Promise<void> {
  const binding = store.getStorageBinding()
  if (!binding || restarting.has(store)) return
  restarting.add(store)
  try {
    leaveCloudRoom(store)
    // The tab shows what it downloaded: another tab of the document may still write the local copy.
    await reloadStorageDocumentInTab(store, await adoptStoredVersion(binding.documentId))
    // The restore is in the history now; the old room closed before it could say so.
    versionsChanged(store)
    await startCloudRoom(store)
  } finally {
    restarting.delete(store)
  }
}

/** Starts the room of every open Cloud document, as tabs open and documents move to Cloud. */
export function watchCloudRooms(): () => void {
  return watch(
    () => {
      // Tabs, their bindings, and sign-ins are reactive; the snapshot carries the stores.
      void allTabs.value
      void cloudConnections.value
      return getTabsSnapshot().map((tab) => [tab.store, tab.store.getStorageBinding()] as const)
    },
    (entries) => {
      for (const [store] of entries) {
        const joining = accountChanged(store) ? rejoinCloudRoom(store) : startCloudRoom(store)
        void joining.catch(() => undefined)
      }
    },
    { immediate: true }
  )
}
