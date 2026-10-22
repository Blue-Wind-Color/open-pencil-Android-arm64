/** @jsxImportSource @open-pencil/design-jsx */
/**
 * The tour's callout: one card per page with a step number, what to try, and the shortcut.
 * It is a component with text properties, so its instances are the first thing a visitor who
 * clicks one sees in the panel.
 */
import { Component, Frame, Instance, Text, type TreeNode } from '@open-pencil/design-jsx'
import type { ComponentPropertyDefinition, SceneGraph } from '@open-pencil/scene-graph'
import { createComponentPropertyId } from '@open-pencil/scene-graph/components'
import { createSlotProperty, updateSlotProperty } from '@open-pencil/scene-graph/slots'

import { previewButton } from './chrome'
import { renderTree } from './icons'
import type { Theme } from './theme'

export const TIP_PROPERTIES = {
  step: { id: 'tip-step', name: 'Step', type: 'TEXT', defaultValue: '1' },
  title: { id: 'tip-title', name: 'Title', type: 'TEXT', defaultValue: 'Try this' },
  body: {
    id: 'tip-body',
    name: 'Body',
    type: 'TEXT',
    defaultValue: 'Select something on the canvas and look at the panel on the right.'
  },
  keys: { id: 'tip-keys', name: 'Shortcut', type: 'TEXT', defaultValue: '⌥ ⌘ ↩' },
  showKeys: { id: 'tip-show-keys', name: 'Show shortcut', type: 'BOOLEAN', defaultValue: 'true' }
} satisfies Record<string, ComponentPropertyDefinition>

export const TIP_WIDTH = 320
/** The slot a tip shows where to click in: a piece of the app's chrome with the target ringed. */
export const WHERE_SLOT_NAME = 'Where'

/** The Tip main component on the page, with its Where slot defined. */
export async function createTipComponent(
  graph: SceneGraph,
  theme: Theme,
  pageId: string
): Promise<{ id: string; whereSlotId: string }> {
  const { id } = await renderTree(graph, tipComponent(theme), { parentId: pageId, x: 0, y: 0 })
  const where = graph.getChildren(id).find((child) => child.name === WHERE_SLOT_NAME)
  const whereSlotId = createComponentPropertyId()
  if (!where || !createSlotProperty(graph, where.id, whereSlotId)) {
    throw new Error('The tip has no Where frame to make a slot of')
  }
  updateSlotProperty(graph, id, whereSlotId, {
    description: 'Where to click: a piece of the app with the target ringed.',
    slotSettings: { maxChildren: 1 }
  })
  return { id, whereSlotId }
}

function tipComponent(theme: Theme): TreeNode {
  const { vars } = theme
  return (
    <Component
      name="Tip"
      properties={Object.values(TIP_PROPERTIES)}
      flex="col"
      w={TIP_WIDTH}
      h="hug"
      p={20}
      gap={12}
      rounded={16}
      bg={vars.surface}
      stroke={vars.line}
    >
      <Frame name="Heading" flex="row" w="fill" h="hug" gap={12} items="center">
        <Frame
          name="Step"
          flex="row"
          w={28}
          h={28}
          rounded={14}
          justify="center"
          items="center"
          bg={vars.accent}
        >
          <Text
            name="Number"
            font="Inter"
            size={13}
            weight={700}
            color={vars.onAccent}
            propertyRefs={[{ propertyId: TIP_PROPERTIES.step.id, field: 'TEXT' }]}
          >
            {TIP_PROPERTIES.step.defaultValue}
          </Text>
        </Frame>
        <Text
          name="Title"
          font="Inter"
          size={15}
          weight={600}
          color={vars.text}
          propertyRefs={[{ propertyId: TIP_PROPERTIES.title.id, field: 'TEXT' }]}
        >
          {TIP_PROPERTIES.title.defaultValue}
        </Text>
      </Frame>
      <Text
        name="Body"
        font="Inter"
        size={13}
        lineHeight={20}
        w="fill"
        color={vars.muted}
        propertyRefs={[{ propertyId: TIP_PROPERTIES.body.id, field: 'TEXT' }]}
      >
        {TIP_PROPERTIES.body.defaultValue}
      </Text>
      <Frame name={WHERE_SLOT_NAME} flex="col" w="fill" h="hug" items="start">
        {previewButton(theme)}
      </Frame>
      <Frame
        name="Shortcut"
        flex="row"
        w="hug"
        h="hug"
        px={10}
        py={6}
        rounded={8}
        bg={vars.raised}
        propertyRefs={[{ propertyId: TIP_PROPERTIES.showKeys.id, field: 'VISIBLE' }]}
      >
        <Text
          name="Keys"
          font="Inter"
          size={12}
          weight={600}
          color={vars.text}
          propertyRefs={[{ propertyId: TIP_PROPERTIES.keys.id, field: 'TEXT' }]}
        >
          {TIP_PROPERTIES.keys.defaultValue}
        </Text>
      </Frame>
    </Component>
  )
}

export interface Tip {
  step: number
  title: string
  body: string
  /** The shortcut to show, if the step has one. */
  keys?: string
  /** The piece of the app to show in the Where slot, with its target ringed. */
  where?: TreeNode
}

export function tipInstance(componentId: string, tip: Tip): TreeNode {
  return (
    <Instance
      of={componentId}
      name={`Tip ${tip.step}`}
      properties={{
        [TIP_PROPERTIES.step.id]: String(tip.step),
        [TIP_PROPERTIES.title.id]: tip.title,
        [TIP_PROPERTIES.body.id]: tip.body,
        [TIP_PROPERTIES.keys.id]: tip.keys ?? '',
        [TIP_PROPERTIES.showKeys.id]: tip.keys ? 'true' : 'false'
      }}
    />
  )
}
