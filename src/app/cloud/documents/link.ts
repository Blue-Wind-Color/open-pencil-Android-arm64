import { useSessionStorage } from '@vueuse/core'
import * as v from 'valibot'
import { ref, watch } from 'vue'

import { cloudDocumentPath, cloudDocumentURL } from '@open-pencil/cloud/contract'
import { cloudMessages } from '@open-pencil/vue'

import type { EditorStore } from '@/app/editor/session'
import { toast } from '@/app/shell/ui'
import { openStorageDocumentInNewTab } from '@/app/tabs'
import { IS_BROWSER, OFFICIAL_CLOUD_URL } from '@/constants'

import { cloudSignedIn, openCloudConnect } from '../connect/flow'
import { cloudServerHost, normalizeCloudServerURL } from '../servers/address'
import { addCloudServer, cloudServers, findCloudServer } from '../servers/store'
import { cloudAPIClient, cloudConnection } from '../sessions/connection'
import { CLOUD_STORAGE_PROVIDER_ID } from '../sessions/token'
import { openVersionHistory, previewVersion, versionHistoryOf } from '../versions/history'
import { isCloudBinding } from './status'

/**
 * A document's address for its members, `/cloud/documents/:id?server=…`, with `&version=…` for
 * one of its versions. Unlike invitations and share links it carries no secret: the server
 * decides whether whoever signs in may open it.
 */
export type CloudDocumentLink = { documentId: string; server: string; versionId: string | null }

const CLOUD_DOCUMENT_PATH = /^\/cloud\/documents\/([^/]+)$/

const linkSchema = v.object({
  documentId: v.string(),
  server: v.string(),
  versionId: v.nullable(v.string())
})

/** The link this tab is opening while it signs in, kept for the tab so it survives leaving. */
const stored = IS_BROWSER
  ? useSessionStorage<string | null>('open-pencil:cloud-document-link', null)
  : ref<string | null>(null)

/** The document link a web address carries, if it is one. */
export function readCloudDocumentLink(url: URL): CloudDocumentLink | null {
  const [, id] = url.pathname.match(CLOUD_DOCUMENT_PATH) ?? []
  const server = url.searchParams.get('server')
  if (!id || !server) return null
  try {
    return {
      documentId: decodeURIComponent(id),
      server,
      versionId: url.searchParams.get('version')
    }
  } catch {
    // A broken escape such as `%E0` is no link; it must not stop the app from starting.
    return null
  }
}

/**
 * What the tab of `store` has at its address: its Cloud document, and the version shown in place
 * of it. Null for anything else, or while signed out of its server.
 */
export function cloudDocumentAddress(
  store: EditorStore
): { path: string; query: Record<string, string> } | null {
  const history = versionHistoryOf(store)
  const binding = (history?.store ?? store).getStorageBinding()
  if (!binding || !isCloudBinding(binding) || !binding.profileId) return null
  const server = findCloudServer(binding.profileId)
  if (!server) return null
  const version = history?.preview?.version.id
  return {
    path: cloudDocumentPath(binding.documentId),
    query: version ? { server: server.url, version } : { server: server.url }
  }
}

/** Where links to the document in `store` go: its server, while that advertises an editor. */
function linkTarget(store: EditorStore) {
  const binding = (versionHistoryOf(store)?.store ?? store).getStorageBinding()
  const server = binding?.profileId ? findCloudServer(binding.profileId) : null
  const discovery = server ? cloudConnection(server.id).discovery : null
  return binding && server && discovery?.appURL ? { binding, server, discovery } : null
}

/** Whether versions of the document in `store` can be linked to. */
export function canLinkToVersions(store: EditorStore): boolean {
  return linkTarget(store) !== null
}

/** The link to copy for a version of the document in `store`, on its server's own editor. */
export function cloudVersionLinkURL(store: EditorStore, versionId: string): string | null {
  const target = linkTarget(store)
  if (!target) return null
  const { binding, server, discovery } = target
  return cloudDocumentURL(discovery.appURL, server.url, binding.documentId, versionId)
}

/**
 * Opens a document link: the document in a tab, and the version in the history when the link
 * names one. Signed out, it signs in first and picks the link up again after. A server this app
 * never used is only named, not added, so a link alone never connects it anywhere new.
 */
export async function openCloudDocumentLink(link: CloudDocumentLink): Promise<void> {
  const messages = cloudMessages.get()
  const url = normalizeCloudServerURL(link.server)
  if (!url) {
    toast.error(messages.documentLinkFailed)
    return
  }
  let server = cloudServers.value.find((candidate) => candidate.url === url) ?? null
  if (!server && url === OFFICIAL_CLOUD_URL)
    server = await addCloudServer({ kind: 'official', url })
  if (!server) {
    toast.error(messages.documentLinkUnknownServer({ host: cloudServerHost(url) }))
    return
  }
  const connection = cloudConnection(server.id)
  if (connection.state !== 'signed-in' || !connection.discovery) {
    stored.value = JSON.stringify(link satisfies CloudDocumentLink)
    openCloudConnect({ serverId: server.id })
    return
  }
  stored.value = null
  const client = cloudAPIClient(server, connection.discovery)
  const download = await client.getDocument(link.documentId).catch(() => null)
  if (!download) {
    toast.error(messages.documentLinkFailed)
    return
  }
  const { document } = download
  // Opening reports its own failure.
  const store = await openStorageDocumentInNewTab(
    {
      id: document.id,
      name: document.name,
      updatedAt: document.updatedAt,
      revision: document.currentRevisionId
    },
    {
      providerId: CLOUD_STORAGE_PROVIDER_ID,
      profileId: server.id,
      containerId: document.workspaceId
    }
  ).catch(() => null)
  if (!store || !link.versionId) return
  const shown = await client.getDocumentVersion(document.id, link.versionId).catch(() => null)
  if (shown) {
    openVersionHistory(store)
    await previewVersion(store, shown.version)
  }
  if (!shown || versionHistoryOf(store)?.failed) toast.error(messages.versionFailed)
}

/** Drops a link kept while signing in, as when the tab opens with another one. */
export function forgetCloudDocumentLink(): void {
  stored.value = null
}

/** Picks a document link back up once signing in for it finished. */
export function resumeCloudDocumentLink(): () => void {
  return watch(cloudSignedIn, (signedIn) => {
    const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), linkSchema), stored.value ?? '')
    if (!signedIn || !parsed.success) return
    const url = normalizeCloudServerURL(parsed.output.server)
    if (url !== findCloudServer(signedIn.serverId)?.url) return
    void openCloudDocumentLink(parsed.output)
  })
}
