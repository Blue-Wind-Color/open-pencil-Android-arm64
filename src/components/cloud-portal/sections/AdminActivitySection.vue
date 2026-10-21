<script setup lang="ts">
import { useCloudPortalMessages, useI18n } from '@open-pencil/vue'

import { usePortal } from '@/app/cloud-portal/context'
import { usePortalLoad } from '@/app/cloud-portal/state'
import { formatDate } from '@/app/i18n/date'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

import PortalActivity from '../console/PortalActivity.vue'
import type { PortalActivityEntry } from '../types'

const portal = usePortal()
const messages = useCloudPortalMessages()
const { locale } = useI18n()

const { data: entries, error } = usePortalLoad(async (): Promise<PortalActivityEntry[]> => {
  // Events name accounts by ID; the people list gives them names.
  const [{ events }, { users }, { enrollments }] = await Promise.all([
    portal.api.audit(),
    portal.api.users(),
    portal.api.enrollments()
  ])
  const names = new Map(users.map((user) => [user.id, user.name]))
  const requesters = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment.email]))
  return events.map((event) => ({
    id: event.id,
    actor: {
      id: event.actorUserId,
      name: names.get(event.actorUserId) ?? messages.value.someoneElse
    },
    action: event.action,
    target: names.get(event.subjectId) ?? requesters.get(event.subjectId) ?? event.subjectId,
    when: formatDate(event.createdAt, 'date', locale.value)
  }))
}, [])
</script>

<template>
  <AppAlert v-if="error" tone="error" :heading="messages.errorTitle" :description="error" />
  <PortalActivity v-else :entries="entries" />
</template>
