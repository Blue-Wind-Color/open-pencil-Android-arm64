import { describe, expect, test } from 'bun:test'

import type { CloudAccountStatus } from '@open-pencil/cloud/contract'

import {
  isCloudLink,
  leaveAfterSignOut,
  openLocalEditor,
  siteDestination,
  type SiteAccount
} from '@/app/cloud-portal/site'

function account(state: CloudAccountStatus['state']): CloudAccountStatus {
  return {
    state,
    user: { userId: 'user-1', email: 'ada@example.com', name: 'Ada', deploymentRole: 'user' }
  }
}

const visit = (
  path: string,
  who: SiteAccount,
  options: { localEditor?: boolean; choseLocalEditor?: boolean } = {}
) =>
  siteDestination({
    path,
    account: who,
    localEditor: options.localEditor ?? true,
    choseLocalEditor: options.choseLocalEditor ?? false
  })

describe('Cloud server editor pages', () => {
  test('open the editor for an account that may use the server', () => {
    expect(visit('/', account('active'))).toBeNull()
    expect(visit('/', account('active'), { localEditor: false })).toBeNull()
  })

  test('welcome visitors at the root who are not signed in or not let in yet', () => {
    expect(visit('/', null)).toBe('/welcome')
    expect(visit('/', account('pending'))).toBe('/welcome')
    expect(visit('/', account('revoked'))).toBe('/welcome')
  })

  test('open the local editor once this browser chose it, and other pages without asking', () => {
    expect(visit('/', null, { choseLocalEditor: true })).toBeNull()
    expect(visit('/demo', null)).toBeNull()
  })

  test('welcome everyone without an account where the server turns the local editor off', () => {
    expect(visit('/', null, { localEditor: false, choseLocalEditor: true })).toBe('/welcome')
    expect(visit('/demo', null, { localEditor: false })).toBe('/welcome')
    expect(visit('/share/room', account('pending'), { localEditor: false })).toBe('/welcome')
  })

  test('tell links, which sign in on their own, from look-alike addresses', () => {
    const link = (address: string) => isCloudLink(new URL(address, 'https://cloud.example'))
    expect(link('/cloud/documents/a?server=https://cloud.example')).toBe(true)
    expect(link('/cloud/share/b?server=https://cloud.example#secret')).toBe(true)
    expect(link('/cloud/invitations/c?server=https://cloud.example#token')).toBe(true)
    expect(link('/cloud/share/b?server=https://cloud.example')).toBe(false)
    expect(link('/cloud/documents/a')).toBe(false)
    expect(link('/cloud/share/b/c?server=x#secret')).toBe(false)
  })

  test('open the editor when the server cannot say, since the editor works without it', () => {
    expect(visit('/', 'unreachable', { localEditor: false })).toBeNull()
  })
})

describe('signing out of the server that serves the editor', () => {
  function leave(serverAllowsLocalEditor: boolean): string[] {
    const assigned: string[] = []
    leaveAfterSignOut(serverAllowsLocalEditor, { assign: (url) => assigned.push(String(url)) })
    return assigned
  }

  // One test, since the browser's choice of the local editor is kept for the module's lifetime.
  test('leaves for the welcome page unless this browser chose the local editor the server allows', () => {
    expect(leave(false)).toEqual(['/welcome'])
    expect(leave(true)).toEqual(['/welcome'])
    openLocalEditor({ assign: () => undefined })
    expect(leave(true)).toEqual([])
    expect(leave(false)).toEqual(['/welcome'])
  })
})
