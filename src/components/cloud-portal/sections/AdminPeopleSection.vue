<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import type { CloudAdminUserFilter } from '@open-pencil/cloud/contract'
import { useCloudPortalMessages } from '@open-pencil/vue/i18n'

import { usePortal } from '@/app/cloud-portal/context'
import { usePortalAction, usePortalLoad } from '@/app/cloud-portal/state'
import { useDateFormat } from '@/app/i18n/date'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

import PortalPeople from '../console/PortalPeople.vue'
import { personAction, portalPerson } from './people'

const PAGE_SIZE = 50

/** The accounts on this server, a page at a time, and what administrators do about them. */
const emit = defineEmits<{ total: [count: number]; open: [personId: string] }>()
const portal = usePortal()
const messages = useCloudPortalMessages()
const dates = useDateFormat()
const query = ref('')
const search = refDebounced(query, 250)
const filter = ref<CloudAdminUserFilter>('all')
const offset = ref(0)

const {
  data: listing,
  error: loadError,
  loading,
  reload
} = usePortalLoad(
  () =>
    portal.api.users({
      search: search.value.trim() || undefined,
      filter: filter.value,
      limit: PAGE_SIZE,
      offset: offset.value
    }),
  null
)
// After a failed load the last list belongs to another search or filter, so none is shown.
const people = computed(() =>
  (loadError.value ? [] : (listing.value?.users ?? [])).map((user) =>
    portalPerson(user, portal.account.value?.user.userId, dates)
  )
)
const counts = computed(
  () => listing.value?.counts ?? { all: 0, administrators: 0, suspended: 0, 'without-two-step': 0 }
)

const action = usePortalAction(async (change: () => Promise<unknown>) => {
  await change()
  await reload()
})
const error = computed(() => action.error.value ?? loadError.value)

// A new search or filter starts again from the first page.
watch([search, filter], () => {
  offset.value = 0
  void reload()
})
watch(offset, () => void reload())
watch(listing, (current) => {
  if (!current) return
  emit('total', current.counts.all)
  // A change that empties the last page, such as restoring its only person, steps back a page.
  const total = current.counts[filter.value]
  if (offset.value > 0 && offset.value >= total) {
    offset.value = Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE)
  }
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <AppAlert v-if="error" tone="error" :heading="messages.errorTitle" :description="error" />
    <PortalPeople
      v-model:query="query"
      v-model:filter="filter"
      :people="people"
      :counts="counts"
      :offset="offset"
      :page-size="PAGE_SIZE"
      :busy="action.busy.value || loading"
      @act="
        (person, kind, reason) => action.run(() => personAction(portal.api, person, kind, reason))
      "
      @open="(id) => emit('open', id)"
      @page="(next) => (offset = next)"
    />
  </div>
</template>
