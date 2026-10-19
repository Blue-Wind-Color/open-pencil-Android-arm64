import { expect, test } from 'bun:test'

import {
  cloudDesktopLinkURL,
  cloudDocumentURL,
  cloudRedirectPath,
  cloudShareURL
} from '#cloud/client'
import type { CloudDiscovery } from '#cloud/contract'

const discovery: CloudDiscovery = {
  protocolVersion: '1',
  deployment: 'self-hosted',
  apiURL: 'https://company.example/api',
  authURL: 'https://company.example/api/auth',
  appURL: 'https://editor.company.example',
  authentication: { socialProviders: [], enterpriseSSO: false, enrollmentMode: 'open' },
  capabilities: { documents: true, workspaces: true, collaboration: true }
}

test('sharing uses the owning public editor without requiring browser globals', () => {
  const url = new URL(cloudShareURL(discovery, 'https://company.example', 'share-id', 'secret'))
  expect(url.origin).toBe('https://editor.company.example')
  expect(url.pathname).toBe('/cloud/share/share-id')
  expect(url.searchParams.get('server')).toBe('https://company.example')
  expect(url.hash).toBe('#secret')
  expect(url.search).not.toContain('secret')
})

test('sharing rejects absent or non-web editor URLs', () => {
  expect(() =>
    cloudShareURL({ ...discovery, appURL: undefined }, discovery.apiURL, 'id', 'secret')
  ).toThrow()
  expect(() =>
    cloudShareURL({ ...discovery, appURL: 'tauri://localhost' }, discovery.apiURL, 'id', 'secret')
  ).toThrow()
})

test('a document or version address names its server and carries no secret', () => {
  const document = new URL(cloudDocumentURL(discovery, 'https://company.example', 'doc-id'))
  expect(document.origin).toBe('https://editor.company.example')
  expect(document.pathname).toBe('/cloud/documents/doc-id')
  expect(document.searchParams.get('server')).toBe('https://company.example')
  expect(document.searchParams.has('version')).toBe(false)
  expect(document.hash).toBe('')

  const version = new URL(
    cloudDocumentURL(discovery, 'https://company.example', 'doc-id', 'version-id')
  )
  expect(version.searchParams.get('version')).toBe('version-id')

  const anchored = { ...discovery, appURL: 'https://editor.company.example/#welcome' }
  expect(new URL(cloudDocumentURL(anchored, 'https://company.example', 'doc-id')).hash).toBe('')
})

test('authentication continuation stays on the issuing origin', () => {
  expect(cloudRedirectPath('/cloud/device?user_code=ABCD')).toBe('/cloud/device?user_code=ABCD')
  for (const input of [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    // eslint-disable-next-line no-script-url -- Reject script URLs at the untrusted navigation boundary.
    'javascript:alert(1)',
    undefined
  ]) {
    expect(cloudRedirectPath(input)).toBe('/app')
  }
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
