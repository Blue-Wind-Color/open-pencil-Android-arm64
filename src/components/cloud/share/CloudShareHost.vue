<script setup lang="ts">
import { computed, watch } from 'vue'

import type { DocumentPermission } from '@open-pencil/cloud/contract'
import { useCloudMessages } from '@open-pencil/vue'

import { cloudConnection } from '@/app/cloud/sessions/connection'
import { cloudShareOpen } from '@/app/cloud/sharing/dialog'
import { cloudShareTarget, type CloudShareLink } from '@/app/cloud/sharing/document'
import { useCloudSharing } from '@/app/cloud/sharing/use'
import { useActiveEditorStoreRef } from '@/app/editor/active-store'
import { useDateFormat } from '@/app/i18n/date'
import { useSendLink } from '@/app/shell/share/link'
import { toast } from '@/app/shell/ui'

import CloudShareDialog from './CloudShareDialog.vue'

/**
 * The active Cloud document's share dialog: who can open it and its link, managed on the server.
 * One for the app, so the header's Share button and the mobile one open the same dialog.
 */
const storeRef = useActiveEditorStoreRef()
const t = useCloudMessages()

const target = computed(() => {
  const binding = storeRef.value?.getStorageBinding()
  return binding ? cloudShareTarget(binding) : null
})
const cloudSharing = useCloudSharing(target)
const { sharing, linkURL, inviting } = cloudSharing
const { sendsLink, copied, send } = useSendLink()

const workspace = computed(() => {
  const binding = storeRef.value?.getStorageBinding()
  if (!binding?.profileId) return null
  const found = cloudConnection(binding.profileId).workspaces.find(
    (candidate) => candidate.id === binding.containerId
  )
  return found ? { name: found.name, permission: 'edit' as const } : null
})
const dates = useDateFormat()
const members = computed(() =>
  (sharing.value?.members ?? []).map((member) => ({
    ...member,
    pendingUntil: member.pendingUntil ? dates.format(member.pendingUntil, 'day') : undefined
  }))
)

async function refresh() {
  if (!(await cloudSharing.refresh())) toast.error(t.value.shareLoadFailed)
}

/** Says when a change did not take; the dialog shows what the server kept either way. */
async function changed(outcome: Promise<boolean>) {
  if (!(await outcome)) toast.error(t.value.shareChangeFailed)
}

const invite = (email: string, permission: DocumentPermission) =>
  changed(cloudSharing.invite(email, permission))
const changeMember = (id: string, permission: DocumentPermission | 'remove') =>
  changed(cloudSharing.changeMember(id, permission))
const changeLink = (link: CloudShareLink) => changed(cloudSharing.changeLink(link))
const resetLink = () => changed(cloudSharing.resetLink())

/** Sends the link prepared with the sharing, so the share sheet opens straight from the tap. */
function sendLink() {
  const url = linkURL.value
  if (!url) {
    toast.error(t.value.shareLoadFailed)
    return
  }
  void send(url, storeRef.value?.state.documentName)
}

watch(
  () => [cloudShareOpen.value, target.value] as const,
  ([open, current]) => {
    // Nothing to share, such as after signing out, closes the dialog rather than leave it to pop
    // up later on its own.
    if (!current) cloudShareOpen.value = false
    else if (open) void refresh()
  }
)
</script>

<template>
  <CloudShareDialog
    v-if="target"
    v-model:open="cloudShareOpen"
    :document-name="storeRef?.state.documentName ?? ''"
    :workspace="workspace"
    :members="members"
    :link="sharing?.link ?? { access: 'restricted' }"
    :can-manage="sharing?.canManage ?? false"
    :links="sharing?.links"
    :inviting="inviting"
    :copied="copied"
    :sends-link="sendsLink"
    @invite="invite"
    @change-member="changeMember"
    @change-link="changeLink"
    @copy-link="sendLink"
    @reset-link="resetLink"
  />
</template>
