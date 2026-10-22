import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nodePortalFiles } from '#cloud/runtime/node/portal'

let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openpencil-portal-'))
  await mkdir(join(directory, 'assets'))
  await writeFile(join(directory, 'assets', 'cloud-abc.js'), 'export {}')
  await writeFile(join(tmpdir(), 'openpencil-portal-outside.txt'), 'secret')
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
  await rm(join(tmpdir(), 'openpencil-portal-outside.txt'), { force: true })
})

const request = new Request('https://cloud.example/')

describe('Node portal files', () => {
  test('reads a file with its media type', async () => {
    const file = await nodePortalFiles(directory)('/assets/cloud-abc.js', request)
    expect(file?.type).toContain('javascript')
    expect(new TextDecoder().decode(file?.body instanceof Uint8Array ? file.body : undefined)).toBe(
      'export {}'
    )
  })

  test('never reads outside its directory or answers missing files', async () => {
    const files = nodePortalFiles(directory)
    expect(await files('/..%2Fopenpencil-portal-outside.txt', request)).toBeNull()
    expect(await files('/assets/missing.js', request)).toBeNull()
  })
})
