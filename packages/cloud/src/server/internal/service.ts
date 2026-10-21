import type { CloudDatabase } from '#cloud/server/db'
import {
  createWorkspaceEntitlementRepository,
  staticEntitlementsSchema
} from '#cloud/server/policy'
import type { Kysely } from 'kysely'
import * as v from 'valibot'

export const setWorkspaceEntitlementsSchema = v.object({
  values: staticEntitlementsSchema,
  /** Who decided these values, such as `billing`; stored as the row's source. */
  source: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
  /** Increases with every decision the writer makes, such as a billing event's timestamp. */
  externalVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(0))
})
export type SetWorkspaceEntitlementsInput = v.InferInput<typeof setWorkspaceEntitlementsSchema>

export function parseSetWorkspaceEntitlements(input: unknown) {
  return v.parse(setWorkspaceEntitlementsSchema, input)
}

/**
 * What services beside Cloud, such as billing, may change. Runtimes expose it to them through
 * their own transport: an authenticated HTTP route on Node, a service binding on Workers.
 */
export function createInternalService(database: Kysely<CloudDatabase>) {
  const entitlements = createWorkspaceEntitlementRepository(database)
  return {
    /** `found` is false for an unknown workspace; `applied` is false for an outdated version. */
    async setWorkspaceEntitlements(
      workspaceId: string,
      input: SetWorkspaceEntitlementsInput
    ): Promise<{ found: boolean; applied: boolean }> {
      const { values, source, externalVersion } = parseSetWorkspaceEntitlements(input)
      const workspace = await database
        .selectFrom('workspace')
        .select('id')
        .where('id', '=', workspaceId)
        .executeTakeFirst()
      if (!workspace) return { found: false, applied: false }
      const { applied } = await entitlements.setVersioned(
        workspaceId,
        values,
        source,
        externalVersion
      )
      return { found: true, applied }
    }
  }
}

export type InternalService = ReturnType<typeof createInternalService>
