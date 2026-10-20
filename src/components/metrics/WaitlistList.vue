<script setup lang="ts">
import { computed, ref } from 'vue'

import { formatTime } from '@/app/metrics/format'
import AppButton from '@/components/ui/button/AppButton.vue'
import { metricsWaitlist } from '@/theme/metrics/dashboard'

import type { WaitlistSignup } from './types'

/**
 * Latest Cloud waitlist sign-ups by email domain; addresses never reach the dashboard. A long
 * range shows the newest few until asked for the rest.
 */
const { signups } = defineProps<{ signups: WaitlistSignup[] }>()
const ui = metricsWaitlist()

const COLLAPSED_ROWS = 6
const expanded = ref(false)
const shown = computed(() => (expanded.value ? signups : signups.slice(0, COLLAPSED_ROWS)))
const hidden = computed(() => signups.length - shown.value.length)
</script>

<template>
  <div>
    <ul :class="ui.list()">
      <li v-for="signup in shown" :key="signup.signedUpAt" :class="ui.row()">
        <span :class="ui.domain()">{{ signup.domain }}</span>
        <span :class="ui.time()">{{ formatTime(signup.signedUpAt) }}</span>
        <span :class="ui.status()" :data-confirmed="signup.confirmed">
          {{ signup.confirmed ? 'Confirmed' : 'Waiting' }}
        </span>
      </li>
    </ul>
    <AppButton v-if="hidden > 0" size="sm" :class="ui.more()" @click="expanded = true">
      Show {{ hidden }} more
    </AppButton>
  </div>
</template>
