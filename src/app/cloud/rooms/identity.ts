import { shallowRef } from 'vue'

import type { RoomIdentity } from '@/app/collab/session'
import { PEER_COLORS } from '@/constants'

import type { CloudAccount } from '../servers/store'

/** The same index for the same id on every device, so a person keeps one color. */
function colorIndex(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return hash % PEER_COLORS.length
}

/**
 * Who a signed-in member is in their documents' rooms: their account's name, as the relay shows
 * them to everyone else, on one color for every tab they have open.
 */
export function accountRoomIdentity(account: Pick<CloudAccount, 'id' | 'name'>): RoomIdentity {
  return {
    name: shallowRef(account.name),
    color: PEER_COLORS[colorIndex(account.id)] ?? PEER_COLORS[0]
  }
}
