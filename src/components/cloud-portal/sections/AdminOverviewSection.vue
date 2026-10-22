<script setup lang="ts">
import { useCloudPortalMessages } from '@open-pencil/vue/i18n'

import { usePortal } from '@/app/cloud-portal/context'
import { usePortalLoad } from '@/app/cloud-portal/state'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

import PortalStatus from '../console/PortalStatus.vue'
import type { PortalServerStatus } from '../types'

const emit = defineEmits<{ open: [section: 'requests' | 'email'] }>()
const portal = usePortal()
const messages = useCloudPortalMessages()
const { data: status, error } = usePortalLoad<PortalServerStatus | null>(
  () => portal.api.operations(),
  null
)
</script>

<template>
  <AppAlert v-if="error" tone="error" :heading="messages.errorTitle" :description="error" />
  <PortalStatus v-else-if="status" :status="status" @open="(section) => emit('open', section)" />
</template>
