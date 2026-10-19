import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import { readCloudDocumentLink } from '@/app/cloud/documents/link'

const SERVER = 'https://cloud.example.com'
const DOCUMENT = '1413785f-37aa-4935-8bfb-e2cd81a035cf'

describe('Cloud document links', () => {
  test('an address names the document, its server, and the version it shows', () => {
    const base = `https://openpencil.dev/cloud/documents/${DOCUMENT}?server=${SERVER}`
    expect(readCloudDocumentLink(new URL(base))).toEqual({
      documentId: DOCUMENT,
      server: SERVER,
      versionId: null
    })
    expect(readCloudDocumentLink(new URL(`${base}&version=v1`))?.versionId).toBe('v1')
  })

  test('an address without a server or with a broken escape is no link', () => {
    expect(
      readCloudDocumentLink(new URL(`https://openpencil.dev/cloud/documents/${DOCUMENT}`))
    ).toBeNull()
    expect(
      readCloudDocumentLink(new URL(`https://openpencil.dev/cloud/documents/%E0?server=${SERVER}`))
    ).toBeNull()
    expect(readCloudDocumentLink(new URL(`https://openpencil.dev/?server=${SERVER}`))).toBeNull()
  })
})
