<script setup lang="ts">
import { useI18n, useStickyNote } from '@open-pencil/vue'

import PanelSection from '@/components/ui/panel/PanelSection.vue'

import StickyControls from './StickyControls.vue'

const { panels } = useI18n()
const {
  active,
  color,
  textSize,
  authorVisible,
  typeface,
  bodyFont,
  setColor,
  setTextSize,
  setAuthorVisible,
  setTypeface
} = useStickyNote()
</script>

<template>
  <PanelSection v-if="active" :label="panels.sticky">
    <StickyControls
      :color="color"
      :text-size="textSize"
      :author-visible="authorVisible"
      :typeface="typeface"
      :body-font="bodyFont ?? undefined"
      @update:color="setColor"
      @update:text-size="setTextSize"
      @update:author-visible="setAuthorVisible"
      @update:typeface="setTypeface"
    />
  </PanelSection>
</template>
