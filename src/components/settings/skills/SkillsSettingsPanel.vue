<script setup lang="ts">
import { useFileDialog } from '@vueuse/core'
import { AlertDialogAction, AlertDialogCancel } from 'reka-ui'
import { computed, ref } from 'vue'

import { useAIMessages, useCommonMessages, useSettingsMessages } from '@open-pencil/vue/i18n'

import { useSkillsSettings, type SkillSourceGroup } from '@/app/ai/skills/settings/use'
import { useSettingsFormGuard } from '@/app/settings/navigation/use'
import SettingsGroup from '@/components/settings/layout/SettingsGroup.vue'
import SettingsPage from '@/components/settings/layout/SettingsPage.vue'
import SettingsRow from '@/components/settings/layout/SettingsRow.vue'
import SettingsSection from '@/components/settings/layout/SettingsSection.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppAlertDialogRoot, AppDialogFooter, AppDialogHeader } from '@/components/ui/dialog'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import PanelDrillIn from '@/components/ui/panel/PanelDrillIn.vue'
import AppSwitch from '@/components/ui/toggle/AppSwitch.vue'

import { useSkillMessages } from './messages'
import SkillDetails from './SkillDetails.vue'
import SkillList from './SkillList.vue'

const ai = useAIMessages()
const common = useCommonMessages()
const settings = useSettingsMessages()
const messages = useSkillMessages()
const skills = useSkillsSettings()
const { groups, loading, uploading, uploadFailure, selected, detailOpen } = skills
const deleteOpen = ref(false)
const trustOpen = ref(false)
/** The folder near the document the person is asked to trust; kept while the dialog closes. */
const trusting = ref<SkillSourceGroup | null>(null)
const removing = ref(false)

useSettingsFormGuard(
  {
    dirty: computed(() => false),
    busy: removing,
    cancel: skills.close,
    crumb: { parent: () => settings.value.skills, title: () => selected.value?.skill.name ?? '' }
  },
  detailOpen
)

const fileDialog = useFileDialog({
  accept: '.zip,.md,application/zip,text/markdown',
  multiple: false,
  reset: true
})
fileDialog.onChange((files) => {
  const file = files?.[0]
  if (file) void skills.upload(file)
})

function sourceTitle(group: SkillSourceGroup): string {
  if (group.source === 'project') return ai.value.skillsProjectSource
  if (group.source === 'agents') return ai.value.skillsAgentsSource
  if (group.source === 'claude') return ai.value.skillsClaudeSource
  return ai.value.skillsUploadedSource
}

function sourceDescription(group: SkillSourceGroup): string {
  const folder = group.folder ?? ''
  if (group.source === 'project') {
    return group.enabled
      ? ai.value.skillsProjectSourceTrusted({ folder })
      : ai.value.skillsProjectSourceDescription({ folder })
  }
  if (group.source === 'agents') return ai.value.skillsAgentsSourceDescription({ folder })
  if (group.source === 'claude') return ai.value.skillsClaudeSourceDescription({ folder })
  return ai.value.skillsUploadedSourceDescription
}

const trustDescription = computed(() =>
  ai.value.skillsTrustDescription({ folder: trusting.value?.folder ?? '' })
)

function askTrust(group: SkillSourceGroup) {
  trusting.value = group
  trustOpen.value = true
}

function trust() {
  if (trusting.value?.trustPath) skills.setFolderTrusted(trusting.value.trustPath, true)
  trustOpen.value = false
}

const deleteDescription = computed(() =>
  ai.value.skillsDeleteDescription({ name: selected.value?.skill.name ?? '' })
)

async function remove() {
  const skill = selected.value?.skill
  removing.value = true
  try {
    if (skill) await skills.remove(skill)
  } finally {
    removing.value = false
    deleteOpen.value = false
  }
}
</script>

<template>
  <PanelDrillIn :open="detailOpen" data-test-id="settings-skills-panel" @closed="skills.closed">
    <template #detail>
      <SkillDetails
        v-if="selected"
        :entry="selected"
        @done="skills.close"
        @remove="deleteOpen = true"
        @set-enabled="skills.setSkillEnabled(selected.skill, $event)"
      />
    </template>
    <SettingsPage>
      <div class="flex flex-col gap-6" :aria-busy="loading">
        <SettingsSection v-for="group in groups" :key="group.key" :data-skill-source="group.source">
          <template #title>{{ sourceTitle(group) }}</template>
          <template #description>{{ sourceDescription(group) }}</template>
          <template #actions>
            <AppButton
              v-if="group.source === 'openpencil'"
              variant="outline"
              :loading="uploading"
              @click="fileDialog.open()"
            >
              <template #leading><icon-lucide-upload class="size-3.5" /></template>
              {{ ai.skillsUpload }}
            </AppButton>
            <AppButton
              v-else-if="group.trustPath && group.enabled"
              variant="outline"
              @click="skills.setFolderTrusted(group.trustPath, false)"
            >
              {{ ai.skillsStopTrusting }}
            </AppButton>
            <AppButton v-else-if="group.trustPath" variant="outline" @click="askTrust(group)">
              <template #leading><icon-lucide-shield-check class="size-3.5" /></template>
              {{ ai.skillsTrustFolder }}
            </AppButton>
            <AppButton v-else variant="outline" :loading="loading" @click="skills.reload">
              <template #leading><icon-lucide-refresh-cw class="size-3.5" /></template>
              {{ common.refresh }}
            </AppButton>
          </template>
          <AppAlert
            v-if="group.source === 'openpencil' && uploadFailure"
            tone="error"
            :heading="ai.skillsUploadFailed"
            :description="messages.uploadFailure(uploadFailure)"
          />
          <SettingsGroup v-if="group.folder && !group.trustPath">
            <SettingsRow as="label" :label="ai.skillsUseSource">
              <AppSwitch
                :model-value="group.enabled"
                :label="ai.skillsUseSource"
                @update:model-value="skills.setSourceEnabled(group.source, $event)"
              />
            </SettingsRow>
          </SettingsGroup>
          <SkillList v-if="group.skills.length" :entries="group.skills" @open="skills.open" />
          <AppPlaceholder
            v-else
            size="compact"
            :fill="false"
            :label="group.folder ? ai.skillsNoneInFolder : ai.skillsNoUploads"
          />
          <AppAlert v-if="group.problems.length" tone="warning" :heading="ai.skillsProblems">
            <ul class="flex flex-col gap-0.5">
              <li v-for="problem in group.problems" :key="problem.location">
                <code>{{ problem.location }}</code
                >: {{ messages.error(problem.error) }}
              </li>
            </ul>
          </AppAlert>
        </SettingsSection>
      </div>
    </SettingsPage>
  </PanelDrillIn>
  <AppAlertDialogRoot v-model:open="trustOpen">
    <AppDialogHeader
      :heading="ai.skillsTrustTitle"
      :description="trustDescription"
      :show-close="false"
    />
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <AppButton>{{ common.cancel }}</AppButton>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <AppButton color="primary" variant="solid" @click="trust">
          {{ ai.skillsTrustFolder }}
        </AppButton>
      </AlertDialogAction>
    </AppDialogFooter>
  </AppAlertDialogRoot>
  <AppAlertDialogRoot v-model:open="deleteOpen">
    <AppDialogHeader
      :heading="ai.skillsDelete"
      :description="deleteDescription"
      :show-close="false"
    />
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <AppButton>{{ common.cancel }}</AppButton>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <AppButton color="error" variant="solid" :loading="removing" @click="remove">
          {{ ai.skillsDelete }}
        </AppButton>
      </AlertDialogAction>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
