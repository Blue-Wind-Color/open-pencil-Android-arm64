<script setup lang="ts">
import { computed } from 'vue'

import { variableText } from '@open-pencil/scene-graph'
import {
  BindableValueRoot,
  useEditor,
  useI18n,
  useVisibilityBindingProvider
} from '@open-pencil/vue'

import BoundFieldRow from '@/components/properties/binding/BoundFieldRow.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import { VARIABLE_TYPE_ICONS } from '@/components/variables/type-icons'

/**
 * The variable a layer's visibility follows, with its value here and a way to let go of it.
 */
const { nodeId } = defineProps<{ nodeId: string }>()

const editor = useEditor()
const { panels } = useI18n()
const provider = useVisibilityBindingProvider()
const targets = computed(() => [{ nodeId, path: 'visible' }])

function valueText(variableId: string) {
  return variableText(editor.graph.resolveVariableForNode(nodeId, variableId))
}
</script>

<template>
  <BindableValueRoot v-slot="binding" :provider="provider" :targets="targets" :value="true">
    <BoundFieldRow
      v-if="binding.state !== 'unbound'"
      :label="panels.layerVisibility"
      :name="binding.variable?.name ?? binding.bindingId ?? panels.unresolvedVariable"
      :value="binding.variable ? valueText(binding.variable.id) : undefined"
      :tone="binding.state === 'unresolved' ? 'unresolved' : 'variable'"
    >
      <template #icon>
        <component
          :is="VARIABLE_TYPE_ICONS[binding.variable?.type ?? 'BOOLEAN']"
          class="size-3.5 shrink-0 text-muted"
          aria-hidden="true"
        />
      </template>
      <template #actions>
        <IconButton :label="panels.detachVariable" @click="binding.actions.unbind()">
          <icon-lucide-unlink class="size-3.5" />
        </IconButton>
      </template>
    </BoundFieldRow>
  </BindableValueRoot>
</template>
