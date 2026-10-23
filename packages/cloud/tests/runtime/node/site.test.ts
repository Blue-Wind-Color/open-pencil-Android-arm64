import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nodeSiteFiles } from '#cloud/runtime/node/site'

let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openpencil-site-'))
  await mkdir(join(directory, 'assets'))
  await writeFile(join(directory, 'assets', 'cloud-abc.js'), 'export {}')
  await writeFile(join(directory, 'demo.fig'), 'fig-kiwi')
  await writeFile(join(tmpdir(), 'openpencil-site-outside.txt'), 'secret')
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
  await rm(join(tmpdir(), 'openpencil-site-outside.txt'), { force: true })
})

const request = new Request('https://cloud.example/')

describe('Node site files', () => {
  test('reads a file with its media type', async () => {
    const file = await nodeSiteFiles(directory)('/assets/cloud-abc.js', request)
    expect(file?.type).toContain('javascript')
    expect(new TextDecoder().decode(file?.body instanceof Uint8Array ? file.body : undefined)).toBe(
      'export {}'
    )
  })

  test('never reads outside its directory or answers missing files', async () => {
    const files = nodeSiteFiles(directory)
    expect(await files('/..%2Fopenpencil-site-outside.txt', request)).toBeNull()
    expect(await files('/assets/missing.js', request)).toBeNull()
  })

  test('reads files without a registered media type as bytes', async () => {
    const file = await nodeSiteFiles(directory)('/demo.fig', request)
    expect(file?.type).toBe('application/octet-stream')
  })
})
