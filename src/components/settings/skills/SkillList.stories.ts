import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import { ref } from 'vue'

import type { SkillListEntry } from '@/app/ai/skills/settings/use'
import type { Skill } from '@/app/ai/skills/types'

import SkillList from './SkillList.vue'

function skill(name: string, description: string): Skill {
  return {
    name,
    description,
    instructions: '',
    modelInvocable: true,
    userInvocable: true,
    source: 'agents',
    location: `~/.agents/skills/${name}`,
    files: [],
    readFile: () => Promise.resolve(''),
    warnings: []
  }
}

const entries: SkillListEntry[] = [
  {
    skill: skill(
      'brand-review',
      'Check a layout against the brand guide: colors, type scale, spacing, and logo clear space. Use when reviewing or polishing marketing pages before they ship.'
    ),
    enabled: true,
    shadowed: false,
    untrusted: false
  },
  {
    skill: skill('grid', 'Lay out pages on an eight-point grid.'),
    enabled: true,
    shadowed: true,
    untrusted: false
  },
  {
    skill: skill('pr-review', 'Review GitHub pull requests.'),
    enabled: false,
    shadowed: false,
    untrusted: false
  }
]

const meta = {
  title: 'App/Settings/Skills/List',
  render: () => ({
    components: { SkillList },
    setup: () => ({ entries, opened: ref('') }),
    template: `
      <div class="max-w-lg bg-panel p-3 text-surface">
        <SkillList :entries="entries" @open="(skill) => (opened = skill.name)" />
        <p class="mt-3 text-xs text-muted" data-opened>{{ opened }}</p>
      </div>`
  })
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^brand-review / })).toHaveTextContent(
      'Enabled'
    )
    await expect(canvas.getByRole('button', { name: /^grid / })).toHaveTextContent('Not used')
    await expect(canvas.getByRole('button', { name: /^pr-review / })).toHaveTextContent('Disabled')
    await userEvent.click(canvas.getByRole('button', { name: /^grid / }))
    await expect(canvasElement.querySelector('[data-opened]')).toHaveTextContent('grid')
  }
}
