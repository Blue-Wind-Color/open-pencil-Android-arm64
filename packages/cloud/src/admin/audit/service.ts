import { ADMIN_LIST_MAXIMUM } from '#cloud/admin/schema'
import type { CloudDatabase } from '#cloud/server/db'
import { clamp } from 'es-toolkit'
import type { Kysely } from 'kysely'

export function createAdminAuditService(database: Kysely<CloudDatabase>) {
  return {
    async list(limit = 100) {
      return database
        .selectFrom('cloudAdminAuditEvent')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .limit(clamp(limit, 1, ADMIN_LIST_MAXIMUM))
        .execute()
    }
  }
}

export type AdminAuditService = ReturnType<typeof createAdminAuditService>
