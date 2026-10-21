<script setup lang="ts">
import { useObjectUrl } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import { useCloudMessages } from '@open-pencil/vue'

import { openCloudConnect } from '@/app/cloud/connect/flow'
import { resolveCloudConflict, type CloudConflictChoice } from '@/app/cloud/documents/conflict'
import { useCloudDocumentStatus } from '@/app/cloud/documents/status'
import { cloudRoomPermissions } from '@/app/cloud/rooms/live'
import { showCloudServerOnHome } from '@/app/cloud/servers/store'
import { cloudConnection } from '@/app/cloud/sessions/connection'
import { cloudShareOpen } from '@/app/cloud/sharing/dialog'
import { useEditorStore } from '@/app/editor/active-store'
import { useDateFormat } from '@/app/i18n/date'
import { createStorageAdapter } from '@/app/integrations/storage'
import { openHomeLocation } from '@/app/shell/menu/navigation'
import { toast } from '@/app/shell/ui'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { resumeStorageSync } from '@/app/storage/sync'
import CloudConflictDialog from '@/components/cloud/conflict/CloudConflictDialog.vue'

import CloudDocumentStatus from './CloudDocumentStatus.vue'

/** The open document's Cloud status beside its name, and the choice when it conflicts. */
const store = useEditorStore()
const router = useRouter()
const t = useCloudMessages()
const dates = useDateFormat()
const { state, location, meta } = useCloudDocumentStatus(() => store.getStorageBinding())

const ago = (iso: string | null | undefined) => (iso ? dates.relative(iso) : '')
const savedAgo = computed(() => ago(meta.value?.lastSyncedAt) || null)
const viewOnly = computed(() => cloudRoomPermissions.value.get(store) === 'view')
/**
 * Saving and saved need nothing from the person, and the tab's dot already shows unsaved edits,
 * so the status shows only for what does: being offline, a failed save, a conflict, view only.
 */
const needsAttention = computed(
  () =>
    viewOnly.value ||
    state.value === 'offline' ||
    state.value === 'error' ||
    state.value === 'conflict'
)

const resolving = ref(false)
const choice = ref<CloudConflictChoice>('keep-both')
const localPreview = shallowRef<Blob | null>(null)
const localPreviewURL = useObjectUrl(localPreview)
const cloudSavedAt = ref<string | null>(null)

async function openConflict() {
  const binding = store.getStorageBinding()
  if (!binding) return
  choice.value = 'keep-both'
  resolving.value = true
  const thumb = await getLocalCanvasStore().readThumb(binding.documentId)
  localPreview.value = thumb ? new Blob([Uint8Array.from(thumb)], { type: 'image/png' }) : null
  const stored = await createStorageAdapter(binding)
    .getDocumentMetadata?.(binding.documentId)
    .catch(() => null)
  cloudSavedAt.value = stored?.updatedAt ?? null
}

async function confirm(picked: CloudConflictChoice) {
  resolving.value = false
  try {
    await resolveCloudConflict(
      store,
      picked,
      t.value.conflictYourCopyName({ name: store.state.documentName })
    )
  } catch {
    toast.error(t.value.conflictResolveFailed)
  }
}

/** Home lists one server's workspaces at a time, so it switches to this document's server. */
function openWorkspace() {
  const binding = store.getStorageBinding()
  if (!binding?.profileId || !binding.containerId) return
  showCloudServerOnHome(binding.profileId)
  openHomeLocation(router, { kind: 'workspace', id: binding.containerId })
}

function retry() {
  const serverId = location.value?.serverId
  if (serverId && cloudConnection(serverId).state !== 'signed-in') {
    openCloudConnect({ serverId })
    return
  }
  void resumeStorageSync()
}
</script>

<template>
  <template v-if="state && location">
    <CloudDocumentStatus
      v-if="needsAttention"
      :state="state"
      :workspace="location.workspace ?? location.host"
      :host="location.host"
      :saved-ago="savedAgo"
      :view-only="viewOnly"
      @resolve="openConflict"
      @share="cloudShareOpen = true"
      @retry="retry"
      @open-workspace="openWorkspace"
    />
    <CloudConflictDialog
      v-model:open="resolving"
      v-model:choice="choice"
      :document-name="store.state.documentName"
      :mine="{
        previewURL: localPreviewURL,
        by: t.conflictYouOnThisDevice,
        savedAgo: ago(meta?.updatedAt)
      }"
      :cloud="{ previewURL: null, savedAgo: ago(cloudSavedAt) }"
      @confirm="confirm"
      @later="resolving = false"
    />
  </template>
</template>
