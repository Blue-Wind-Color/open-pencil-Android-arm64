import { CLOUD_PICTURE_MAX_BYTES } from '#cloud/contract'
import type { CloudDatabase, UserPictureFormat } from '#cloud/server/db'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { imageSize } from 'image-size'
import type { Kysely } from 'kysely'
import * as v from 'valibot'

/** Where pictures are served; a picture's address ends in its checksum, so a new one is new. */
export const PICTURE_PATH = '/api/pictures'
/** The longest side a stored picture may have; pages send 256 pixels. */
const PICTURE_MAX_SIDE = 1024
/** How many hex digits of the checksum name a picture in its address. */
const PICTURE_VERSION_LENGTH = 16
/** How long a linked account's picture may take to fetch before sign-in goes on without it. */
const PROVIDER_PICTURE_TIMEOUT_MS = 5000
/** The hosts linked accounts serve pictures from; Google is the only provider that sends one. */
const PROVIDER_PICTURE_HOSTS = ['googleusercontent.com']
const PICTURE_FORMATS: Readonly<Record<string, UserPictureFormat>> = { png: 'png', jpg: 'jpeg' }
const userIdSchema = v.pipe(v.string(), v.uuid())

/** The bytes are not a PNG or JPEG picture the server keeps. */
export class PictureInvalidError extends Error {
  constructor() {
    super('The picture must be a PNG or JPEG image of at most 1024 by 1024 pixels')
    this.name = 'PictureInvalidError'
  }
}

/** The format of a picture the server keeps, read from its bytes; anything else is null. */
export function pictureFormat(bytes: Uint8Array): UserPictureFormat | null {
  if (bytes.byteLength === 0 || bytes.byteLength > CLOUD_PICTURE_MAX_BYTES) return null
  try {
    const size = imageSize(bytes)
    const format = size.type ? PICTURE_FORMATS[size.type] : undefined
    if (!format || size.width < 1 || size.height < 1) return null
    if (size.width > PICTURE_MAX_SIDE || size.height > PICTURE_MAX_SIDE) return null
    return format
  } catch {
    return null
  }
}

/** Whether `url` is an HTTPS address on a host a linked account's picture comes from. */
function providerPicture(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    PROVIDER_PICTURE_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    )
  )
}

/** Reads at most `limit` bytes of a response body, or null when it holds more. */
async function boundedBody(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export type UserPictureOptions = {
  publicURL: string
  /** Fetches a linked account's picture; tests pass their own. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

/**
 * The picture each account shows. The server keeps the bytes and serves them itself, so a page
 * that shows a person never asks another service for them; `user.image` holds their address.
 */
export function createUserPictures(database: Kysely<CloudDatabase>, options: UserPictureOptions) {
  const fetchPicture = options.fetch ?? ((url, init) => fetch(url, init))
  const origin = new URL(options.publicURL).origin

  function address(userId: string, checksum: string): string {
    return `${origin}${PICTURE_PATH}/${userId}/${checksum.slice(0, PICTURE_VERSION_LENGTH)}`
  }

  /** Whether `image` is a picture this server serves, rather than another service's. */
  function served(image: string): boolean {
    return image.startsWith(`${origin}${PICTURE_PATH}/`)
  }

  async function save(
    userId: string,
    bytes: Uint8Array,
    source: 'upload' | 'provider'
  ): Promise<string> {
    const format = pictureFormat(bytes)
    if (!format) throw new PictureInvalidError()
    const checksum = bytesToHex(sha256(bytes))
    const image = address(userId, checksum)
    const createdAt = new Date()
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('userPicture')
        .values({ userId, bytes, format, checksum, source, createdAt })
        .onConflict((conflict) =>
          conflict.column('userId').doUpdateSet({ bytes, format, checksum, source, createdAt })
        )
        .execute()
      await transaction
        .updateTable('user')
        .set({ image, updatedAt: createdAt })
        .where('id', '=', userId)
        .execute()
    })
    return image
  }

  async function remove(userId: string): Promise<void> {
    await database.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('userPicture').where('userId', '=', userId).execute()
      await transaction
        .updateTable('user')
        .set({ image: null, updatedAt: new Date() })
        .where('id', '=', userId)
        .execute()
    })
  }

  return {
    served,

    /** Keeps a picture the account's owner uploaded and shows it from now on. */
    upload(userId: string, bytes: Uint8Array): Promise<string> {
      return save(userId, bytes, 'upload')
    },

    /** Goes back to initials. */
    remove,

    /** The picture at `/api/pictures/:userId/:version`, or null for any other address. */
    async read(userId: string, version: string) {
      if (!v.is(userIdSchema, userId) || version.length !== PICTURE_VERSION_LENGTH) return null
      const picture = await database
        .selectFrom('userPicture')
        .select(['bytes', 'format', 'checksum'])
        .where('userId', '=', userId)
        .executeTakeFirst()
      return picture?.checksum.startsWith(version) ? picture : null
    },

    /**
     * Keeps the picture a linked account named in `image` and shows it instead, so pages never
     * load it from that service. A picture that cannot be fetched or is not one the server keeps
     * leaves initials in its place. An uploaded picture stays.
     */
    async copyFromProvider(userId: string, image: string): Promise<void> {
      if (served(image)) return
      try {
        if (!providerPicture(new URL(image))) throw new PictureInvalidError()
        const response = await fetchPicture(image, {
          redirect: 'error',
          signal: AbortSignal.timeout(PROVIDER_PICTURE_TIMEOUT_MS)
        })
        const bytes = response.ok ? await boundedBody(response, CLOUD_PICTURE_MAX_BYTES) : null
        if (!bytes) throw new PictureInvalidError()
        await save(userId, bytes, 'provider')
      } catch (error) {
        console.warn('Keeping a linked account picture failed', error)
        await database
          .updateTable('user')
          .set({ image: null, updatedAt: new Date() })
          .where('id', '=', userId)
          .where('image', '=', image)
          .execute()
      }
    }
  }
}

export type UserPictureService = ReturnType<typeof createUserPictures>
