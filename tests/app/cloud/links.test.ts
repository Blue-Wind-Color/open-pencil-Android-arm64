import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import { cloudDesktopLinkURL } from '@open-pencil/cloud/contract'

import { readCloudLink } from '@/app/cloud/links'

const SERVER = 'https://cloud.example.com'

describe('Cloud links', () => {
  test('a web link names its kind, id, server, and secret', () => {
    expect(
      readCloudLink(new URL(`https://app.example.com/cloud/invitations/abc?server=${SERVER}#token`))
    ).toEqual({ kind: 'invitations', id: 'abc', server: SERVER, secret: 'token' })
    expect(
      readCloudLink(new URL(`https://app.example.com/cloud/share/s%201?server=${SERVER}#secret`))
    ).toEqual({ kind: 'share', id: 's 1', server: SERVER, secret: 'secret' })
  })

  test('other addresses and links missing a part are not Cloud links', () => {
    for (const address of [
      'https://app.example.com/',
      `https://app.example.com/cloud/documents/abc?server=${SERVER}#secret`,
      `https://app.example.com/cloud/share/abc/more?server=${SERVER}#secret`,
      'https://app.example.com/cloud/share/abc#secret',
      `https://app.example.com/cloud/share/abc?server=${SERVER}`,
      `https://app.example.com/cloud/share/%E0%A4?server=${SERVER}#secret`
    ]) {
      expect(readCloudLink(new URL(address))).toBeNull()
    }
  })

  test('the desktop form of a web link reads back as the same link', () => {
    const web = readCloudLink(
      new URL(`https://app.example.com/cloud/share/abc?server=${SERVER}#secret`)
    )
    if (!web) throw new Error('Expected a Cloud link')
    const desktop = new URL(cloudDesktopLinkURL(web.kind, web.id, web.server, web.secret))
    expect([desktop.protocol, desktop.host, desktop.pathname]).toEqual([
      'openpencil:',
      'cloud',
      '/share/abc'
    ])
    expect(desktop.searchParams.get('server')).toBe(SERVER)
    expect(desktop.hash).toBe('#secret')
  })
})
