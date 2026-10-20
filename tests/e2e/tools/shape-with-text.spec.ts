import type { Vector } from '@open-pencil/scene-graph/primitives'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { shapeWithTextDriver } from '#tests/helpers/canvas/shape-with-text-driver'
import { toolbarToolTestId } from '#tests/helpers/test-ids'

const editor = useEditorSetupWithClear()
const shapes = shapeWithTextDriver(() => editor.page)

test.beforeEach(async () => {
  await editor.page.keyboard.press('Escape')
  await shapes.showOrigin()
})

async function lastShape() {
  const shape = (await shapes.shapes()).at(-1)
  if (!shape) throw new Error('Missing shape with text')
  return shape
}

async function clickAt(x: number, y: number) {
  const point = shapes.point(x, y)
  await editor.canvas.click(point.x, point.y)
  await editor.canvas.waitForRender()
}

async function dragFrom(from: Vector, to: Vector) {
  const box = await editor.canvas.canvas.boundingBox()
  if (!box) throw new Error('Missing canvas')
  const start = shapes.point(from.x, from.y)
  const end = shapes.point(to.x, to.y)
  await editor.page.mouse.move(box.x + start.x, box.y + start.y)
  await editor.page.mouse.down()
  await editor.page.mouse.move(box.x + end.x, box.y + end.y, { steps: 6 })
  await editor.page.mouse.up()
  await editor.canvas.waitForRender()
}

test('the toolbar keeps the shape tool hidden', async () => {
  await expect(editor.page.getByTestId(toolbarToolTestId('SHAPE_WITH_TEXT'))).toHaveCount(0)
})

test('a picked kind is placed by a click, as FigJam places it, with its label to type into', async () => {
  await shapes.showTool()
  await shapes.pickKind('Diamond')
  expect((await shapes.focus()).tool).toBe('SHAPE_WITH_TEXT')
  await clickAt(300, 200)
  const placed = await lastShape()
  expect(placed).toMatchObject({
    kind: 'DIAMOND',
    x: 300,
    y: 200,
    width: 176,
    height: 176,
    fill: '#ffffff',
    stroke: '#757575',
    strokeWeight: 4,
    label: { text: '', fontSize: 16 }
  })
  expect(await shapes.focus()).toMatchObject({ tool: 'SELECT', selected: [placed.id] })
  expect((await shapes.focus()).editing).not.toBeNull()

  await editor.page.keyboard.type('Valid?')
  await editor.page.keyboard.press('Escape')
  await editor.canvas.waitForRender()
  expect(await lastShape()).toMatchObject({ name: 'Valid?', label: { text: 'Valid?' } })
})

test('the tool keeps the kind picked last, and a drag draws the shape as large as the drag', async () => {
  await shapes.showTool()
  await shapes.pickKind('Cylinder')
  await clickAt(100, 100)
  await editor.page.keyboard.press('Escape')
  await editor.page.keyboard.press('Escape')
  const before = (await shapes.shapes()).length

  await editor.page.getByTestId(toolbarToolTestId('SHAPE_WITH_TEXT')).click()
  const cylinder = editor.page.getByRole('option', { name: 'Cylinder', exact: true })
  await expect(cylinder).toHaveAttribute('data-selected', 'true')
  await cylinder.click()
  await dragFrom({ x: 400, y: 100 }, { x: 640, y: 260 })
  expect(await lastShape()).toMatchObject({
    kind: 'ENG_DATABASE',
    x: 400,
    y: 100,
    width: 240,
    height: 160
  })
  await editor.page.keyboard.press('Escape')
  // Drawing it was one step.
  await editor.page.keyboard.press('ControlOrMeta+z')
  await editor.canvas.waitForRender()
  expect(await shapes.shapes()).toHaveLength(before)
})

test('the properties panel switches a shape to another kind, keeping its size', async () => {
  await shapes.showTool()
  await shapes.pickKind('Square')
  await clickAt(200, 200)
  await editor.page.keyboard.press('Escape')
  await editor.page.locator('[data-property="shape-kind"]').click()
  await editor.page.getByRole('option', { name: 'Hexagon', exact: true }).click()
  await editor.canvas.waitForRender()
  expect(await lastShape()).toMatchObject({ kind: 'HEXAGON', width: 176, height: 176 })

  await editor.page.keyboard.press('ControlOrMeta+z')
  await editor.canvas.waitForRender()
  expect((await lastShape()).kind).toBe('SQUARE')
})

test("the properties panel paints a shape with FigJam's palette and sizes its text", async () => {
  await shapes.showTool()
  await shapes.pickKind('Square')
  await clickAt(200, 200)
  await editor.page.keyboard.type('Ship it')
  await editor.page.keyboard.press('Escape')

  const fill = editor.page.getByRole('radiogroup', { name: 'Fill' })
  await fill.getByRole('radio', { name: 'Violet', exact: true }).click()
  await expect(fill.getByRole('radio', { name: 'Violet', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  expect(await lastShape()).toMatchObject({ fill: '#874fff', stroke: '#5427b4' })

  const dashed = editor.page.locator('[data-property="shape-line-dashed"]')
  await dashed.click()
  await expect(dashed).toHaveAttribute('aria-pressed', 'true')
  const noFill = editor.page
    .getByRole('radiogroup', { name: 'Fill' })
    .getByRole('radio', { name: 'None', exact: true })
  await noFill.click()
  await expect(noFill).toHaveAttribute('aria-checked', 'true')
  await fill.getByRole('radio', { name: 'Violet', exact: true }).click()
  expect(await lastShape()).toMatchObject({ fill: '#874fff' })

  await editor.page.locator('[data-property="shape-text-size"]').click()
  await editor.page.getByRole('option', { name: 'Huge', exact: true }).click()
  await editor.canvas.waitForRender()
  await expect(editor.page.locator('[data-property="shape-text-size"]')).toContainText('Huge')
  const huge = await lastShape()
  expect(huge.label?.fontSize).toBe(96)
  expect(huge.height).toBeGreaterThan(176)
})
