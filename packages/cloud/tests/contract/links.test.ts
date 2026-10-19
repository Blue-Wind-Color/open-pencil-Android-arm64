import { expect, test } from 'bun:test'

import {
  cloudDesktopLinkURL,
  cloudDocumentURL,
  cloudInvitationURL,
  cloudShareURL
} from '#cloud/contract'

const appURL = 'https://editor.company.example'

test('sharing uses the owning public editor without requiring browser globals', () => {
  const url = new URL(cloudShareURL(appURL, 'https://company.example', 'share-id', 'secret'))
  expect(url.origin).toBe('https://editor.company.example')
  expect(url.pathname).toBe('/cloud/share/share-id')
  expect(url.searchParams.get('server')).toBe('https://company.example')
  expect(url.hash).toBe('#secret')
  expect(url.search).not.toContain('secret')
})

test('sharing rejects absent or non-web editor URLs', () => {
  expect(() => cloudShareURL(undefined, 'https://company.example', 'id', 'secret')).toThrow()
  expect(() =>
    cloudShareURL('tauri://localhost', 'https://company.example', 'id', 'secret')
  ).toThrow()
})

test('a document or version address names its server and carries no secret', () => {
  const document = new URL(cloudDocumentURL(appURL, 'https://company.example', 'doc-id'))
  expect(document.origin).toBe('https://editor.company.example')
  expect(document.pathname).toBe('/cloud/documents/doc-id')
  expect(document.searchParams.get('server')).toBe('https://company.example')
  expect(document.searchParams.has('version')).toBe(false)
  expect(document.hash).toBe('')

  const version = new URL(
    cloudDocumentURL(appURL, 'https://company.example', 'doc-id', 'version-id')
  )
  expect(version.searchParams.get('version')).toBe('version-id')

  const anchored = 'https://editor.company.example/#welcome'
  expect(new URL(cloudDocumentURL(anchored, 'https://company.example', 'doc-id')).hash).toBe('')
})

test('an invitation names its server and carries its token in the fragment', () => {
  const url = new URL(
    cloudInvitationURL(appURL, 'https://company.example', 'invitation/id', 'token')
  )
  expect(url.origin).toBe('https://editor.company.example')
  expect(url.pathname).toBe('/cloud/invitations/invitation%2Fid')
  expect(url.searchParams.get('server')).toBe('https://company.example')
  expect(url.hash).toBe('#token')
  expect(url.search).not.toContain('token')
})

test('desktop links keep the web link path, server, and secret under the app scheme', () => {
  const url = new URL(
    cloudDesktopLinkURL('invitations', 'invitation-id', 'https://company.example', 'secret')
  )
  expect(url.protocol).toBe('openpencil:')
  expect(url.host).toBe('cloud')
  expect(url.pathname).toBe('/invitations/invitation-id')
  expect(url.searchParams.get('server')).toBe('https://company.example')
  expect(url.hash).toBe('#secret')
})
