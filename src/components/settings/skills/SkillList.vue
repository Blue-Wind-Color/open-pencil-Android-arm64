<script setup lang="ts">
import { useAIMessages, useCommonMessages } from '@open-pencil/vue/i18n'

import type { SkillListEntry } from '@/app/ai/skills/settings/use'
import type { Skill } from '@/app/ai/skills/types'
import AppActionRow from '@/components/ui/list/AppActionRow.vue'

const { entries } = defineProps<{ entries: SkillListEntry[] }>()

const emit = defineEmits<{ open: [skill: Skill] }>()

const ai = useAIMessages()
const common = useCommonMessages()

function status(entry: SkillListEntry): string {
  if (entry.untrusted) return ai.value.skillsNotTrusted
  if (entry.shadowed) return ai.value.skillsNotUsed
  return entry.enabled ? common.value.enabled : common.value.disabled
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-slot="skill-list">
    <AppActionRow
      v-for="entry in entries"
      :key="entry.skill.name"
      :data-skill="entry.skill.name"
      @click="emit('open', entry.skill)"
    >
      <template #leading><icon-lucide-book-open class="size-3.5" /></template>
      {{ entry.skill.name }}
      <template #description>
        <span class="line-clamp-2">{{ entry.skill.description }}</span>
      </template>
      <template #trailing>
        <span class="text-xs">{{ status(entry) }}</span>
        <icon-lucide-chevron-right class="size-3.5" />
      </template>
    </AppActionRow>
  </div>
</template>
