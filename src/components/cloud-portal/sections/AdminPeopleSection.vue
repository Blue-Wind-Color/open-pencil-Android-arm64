<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { useCloudPortalMessages, useI18n } from '@open-pencil/vue'

import { usePortal } from '@/app/cloud-portal/context'
import { usePortalAction, usePortalLoad } from '@/app/cloud-portal/state'
import { formatDate } from '@/app/i18n/date'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

import PortalPeople from '../console/PortalPeople.vue'
import type { PortalPerson } from '../types'

const emit = defineEmits<{ total: [count: number] }>()
const portal = usePortal()
const messages = useCloudPortalMessages()
const { locale } = useI18n()
const query = ref('')
const search = refDebounced(query, 250)

const {
  data: listing,
  error: loadError,
  reload
} = usePortalLoad(async (): Promise<{ people: PortalPerson[]; total: number } | null> => {
  const { users, total } = await portal.api.users(search.value.trim() || undefined)
  const you = portal.account.value?.user.userId
  const people = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    admin: user.role === 'admin',
    suspended: user.banned === true,
    joinedOn: formatDate(user.createdAt, 'date', locale.value),
    you: user.id === you
  }))
  return { people, total }
}, null)
const people = computed(() => listing.value?.people ?? [])

const { error: actionError, run: act } = usePortalAction(async (change: () => Promise<unknown>) => {
  await change()
  await reload()
})
const error = computed(() => actionError.value ?? loadError.value)

watch(search, () => void reload())
watch(listing, (current) => current && emit('total', current.total))
</script>

<template>
  <div class="flex flex-col gap-3">
    <AppAlert v-if="error" tone="error" :heading="messages.errorTitle" :description="error" />
    <PortalPeople
      v-model:query="query"
      :people="people"
      @toggle-admin="(person) => act(() => portal.api.setAdmin(person.id, !person.admin))"
      @sign-out-everywhere="
        (person) => act(() => portal.api.userAction('revoke-sessions', person.id))
      "
      @toggle-suspended="
        (person) => act(() => portal.api.userAction(person.suspended ? 'unban' : 'ban', person.id))
      "
    />
  </div>
</template>
