import { deflateSync, Inflate } from 'fflate'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as Y from 'yjs'

/** Where the relay accepts WebSocket upgrades, under the Cloud API origin. */
export const RELAY_PATH = '/api/collaboration/relay'

/**
 * The room messages collaboration sends. The relay reads the document ones to keep its copy,
 * persist it, and drop writes from viewers; it forwards the rest unread.
 */
export const COLLAB_ACTIONS = {
  yjsUpdate: 'yjs-update',
  syncStep1: 'sync-step1',
  syncReply: 'sync-reply',
  awareness: 'awareness',
  agentPreview: 'agent-preview',
  upload: 'upload',
  /** From the server only: the document's version history changed, so open lists load it again. */
  versions: 'versions'
} as const

/**
 * The most a room message may decode to, compressed or not. A peer's update past it is dropped
 * before it is decoded, so a small compressed reply cannot expand without bound.
 */
export const MAX_COLLAB_MESSAGE_BYTES = 256 * 1024 * 1024

/**
 * What a peer joining needs is the whole document, which repeats the same field names across
 * every layer, so the reply to its state vector travels compressed; Yjs's V2 encoding already
 * groups that repetition, and together they make a room's first sync about a twelfth the size.
 * Edits travel as V2 updates uncompressed: they are small, and arrive in a stream.
 */
export function encodeSyncReply(document: Y.Doc, stateVector: Uint8Array): Uint8Array {
  return deflateSync(Y.encodeStateAsUpdateV2(document, stateVector))
}

/**
 * Compressed input is inflated this much at a time, so a reply stops within a step of passing
 * the limit: deflate expands at most about 1,032 times, so a step can overshoot by about 16 MB.
 */
const INFLATE_STEP = 16 * 1024

/**
 * The V2 update a peer sent, inflated first when `compressed`, as a sync reply is; null once it
 * would decode past `limit` bytes. Throws on data that does not inflate.
 */
export function decodeRoomUpdate(
  data: Uint8Array,
  { limit, compressed = false }: { limit: number; compressed?: boolean }
): Uint8Array | null {
  if (!compressed) return data.length <= limit ? data : null
  const chunks: Uint8Array[] = []
  let size = 0
  const inflate = new Inflate((chunk) => {
    size += chunk.length
    if (size <= limit) chunks.push(chunk)
  })
  for (let offset = 0; offset < data.length; offset += INFLATE_STEP) {
    inflate.push(data.subarray(offset, offset + INFLATE_STEP), offset + INFLATE_STEP >= data.length)
    if (size > limit) return null
  }
  const inflated = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    inflated.set(chunk, at)
    at += chunk.length
  }
  return inflated
}

/** The peer ID the relay itself uses: it holds the room's document and answers sync requests. */
export const RELAY_SERVER_PEER = 'server'

/** The longest name a peer's presence may carry; peers drop presence with a longer one. */
export const MAX_PRESENCE_NAME_LENGTH = 40

/** A name as presence carries it: trimmed and cut to what every peer accepts. */
export function presenceName(name: string): string {
  return name.trim().slice(0, MAX_PRESENCE_NAME_LENGTH)
}

/**
 * Close codes in the WebSocket application range. A client reconnects with a fresh ticket after
 * `expired`, and gives up on the others.
 */
export const RELAY_CLOSE = {
  unauthorized: 4401,
  expired: 4403,
  roomFull: 4409,
  messageTooLarge: 4413,
  protocol: 4400,
  /** The document was restored to a version, so its room started over under a new ID. */
  restored: 4410
} as const

const CLIENT_AUTH = 0
const CLIENT_MESSAGE = 1
const SERVER_WELCOME = 0
const SERVER_JOIN = 1
const SERVER_LEAVE = 2
const SERVER_MESSAGE = 3

/** Frames a client sends: its ticket first, again to refresh it, then room messages. */
export type RelayClientFrame =
  | { type: 'auth'; token: string }
  | { type: 'message'; namespace: string; target: string | null; payload: Uint8Array }

/** Frames the relay sends: who is in the room, arrivals and departures, and forwarded messages. */
export type RelayServerFrame =
  | { type: 'welcome'; peerId: string; peers: string[] }
  | { type: 'join'; peerId: string }
  | { type: 'leave'; peerId: string }
  | { type: 'message'; namespace: string; from: string; payload: Uint8Array }

/** Encodes into a buffer of its own, which `WebSocket.send` accepts. */
function toSendable(write: (encoder: encoding.Encoder) => void): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoding.encode(write))
}

export function encodeRelayClientFrame(frame: RelayClientFrame): Uint8Array<ArrayBuffer> {
  return toSendable((encoder) => {
    if (frame.type === 'auth') {
      encoding.writeVarUint(encoder, CLIENT_AUTH)
      encoding.writeVarString(encoder, frame.token)
      return
    }
    encoding.writeVarUint(encoder, CLIENT_MESSAGE)
    encoding.writeVarString(encoder, frame.namespace)
    encoding.writeVarString(encoder, frame.target ?? '')
    encoding.writeVarUint8Array(encoder, frame.payload)
  })
}

export function encodeRelayServerFrame(frame: RelayServerFrame): Uint8Array<ArrayBuffer> {
  return toSendable((encoder) => {
    switch (frame.type) {
      case 'welcome':
        encoding.writeVarUint(encoder, SERVER_WELCOME)
        encoding.writeVarString(encoder, frame.peerId)
        encoding.writeVarUint(encoder, frame.peers.length)
        for (const peer of frame.peers) encoding.writeVarString(encoder, peer)
        return
      case 'join':
      case 'leave':
        encoding.writeVarUint(encoder, frame.type === 'join' ? SERVER_JOIN : SERVER_LEAVE)
        encoding.writeVarString(encoder, frame.peerId)
        return
      case 'message':
        encoding.writeVarUint(encoder, SERVER_MESSAGE)
        encoding.writeVarString(encoder, frame.namespace)
        encoding.writeVarString(encoder, frame.from)
        encoding.writeVarUint8Array(encoder, frame.payload)
    }
  })
}

/**
 * lib0 reads byte arrays as views of the underlying buffer, which can run past the end of the
 * frame's own view, as with pooled socket buffers. A frame is valid only when decoding consumed
 * exactly its bytes, and payloads are copied out of the shared buffer.
 */
function complete<T>(decoder: decoding.Decoder, data: Uint8Array, frame: T): T | null {
  return decoder.pos === data.byteLength ? frame : null
}

function readPayload(decoder: decoding.Decoder): Uint8Array {
  return decoding.readVarUint8Array(decoder).slice()
}

/** Returns null for a frame that is malformed or of an unknown type. */
export function decodeRelayClientFrame(data: Uint8Array): RelayClientFrame | null {
  try {
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    if (type === CLIENT_AUTH) {
      return complete(decoder, data, { type: 'auth', token: decoding.readVarString(decoder) })
    }
    if (type !== CLIENT_MESSAGE) return null
    const namespace = decoding.readVarString(decoder)
    const target = decoding.readVarString(decoder)
    const payload = readPayload(decoder)
    return complete(decoder, data, { type: 'message', namespace, target: target || null, payload })
  } catch {
    return null
  }
}

/** Returns null for a frame that is malformed or of an unknown type. */
export function decodeRelayServerFrame(data: Uint8Array): RelayServerFrame | null {
  try {
    const decoder = decoding.createDecoder(data)
    switch (decoding.readVarUint(decoder)) {
      case SERVER_WELCOME: {
        const peerId = decoding.readVarString(decoder)
        const count = decoding.readVarUint(decoder)
        const peers: string[] = []
        for (let index = 0; index < count; index++) peers.push(decoding.readVarString(decoder))
        return complete(decoder, data, { type: 'welcome', peerId, peers })
      }
      case SERVER_JOIN:
        return complete(decoder, data, { type: 'join', peerId: decoding.readVarString(decoder) })
      case SERVER_LEAVE:
        return complete(decoder, data, { type: 'leave', peerId: decoding.readVarString(decoder) })
      case SERVER_MESSAGE: {
        const namespace = decoding.readVarString(decoder)
        const from = decoding.readVarString(decoder)
        const payload = readPayload(decoder)
        return complete(decoder, data, { type: 'message', namespace, from, payload })
      }
      default:
        return null
    }
  } catch {
    return null
  }
}
