import { pickBy } from 'es-toolkit/object'
import { isNotNil } from 'es-toolkit/predicate'
import * as v from 'valibot'

import { CLOUD_FEATURE_KEYS } from './keys'

const positiveInteger = v.pipe(v.number(), v.integer(), v.minValue(1))
const nonNegativeInteger = v.pipe(v.number(), v.integer(), v.minValue(0))

export const staticEntitlementsSchema = v.object({
  documents: v.optional(
    v.object({
      maximumFileBytes: v.optional(positiveInteger),
      revisionHistory: v.optional(v.boolean())
    }),
    {}
  ),
  storage: v.optional(v.object({ maximumBytes: v.optional(positiveInteger) }), {}),
  sharing: v.optional(
    v.object({
      capabilityLinks: v.optional(v.boolean()),
      anonymousView: v.optional(v.boolean()),
      anonymousEdit: v.optional(v.boolean()),
      guestPresence: v.optional(v.boolean())
    }),
    {}
  ),
  collaboration: v.optional(
    v.object({
      enabled: v.optional(v.boolean()),
      maximumParticipants: v.optional(positiveInteger)
    }),
    {}
  ),
  ai: v.optional(
    v.object({
      enabled: v.optional(v.boolean()),
      monthlyCreditAllowance: v.optional(nonNegativeInteger)
    }),
    {}
  )
})

export type StaticEntitlements = v.InferOutput<typeof staticEntitlementsSchema>
/** Entitlements as a writer sends them, with any group left out. */
export type StaticEntitlementsInput = v.InferInput<typeof staticEntitlementsSchema>

export const staticEntitlementsTOMLSchema = v.object({
  documents: v.optional(
    v.object({
      maximum_file_bytes: v.optional(positiveInteger),
      revision_history: v.optional(v.boolean())
    })
  ),
  storage: v.optional(v.object({ maximum_bytes: v.optional(positiveInteger) })),
  sharing: v.optional(
    v.object({
      capability_links: v.optional(v.boolean()),
      anonymous_view: v.optional(v.boolean()),
      anonymous_edit: v.optional(v.boolean()),
      guest_presence: v.optional(v.boolean())
    })
  ),
  collaboration: v.optional(
    v.object({
      enabled: v.optional(v.boolean()),
      maximum_participants: v.optional(positiveInteger)
    })
  ),
  ai: v.optional(
    v.object({
      enabled: v.optional(v.boolean()),
      monthly_credit_allowance: v.optional(nonNegativeInteger)
    })
  )
})

/** Entitlements as the deployment TOML spells them, renamed to their structured form. */
export function staticEntitlementsFromTOML(
  value: v.InferOutput<typeof staticEntitlementsTOMLSchema>
): StaticEntitlements {
  return v.parse(staticEntitlementsSchema, {
    documents: {
      maximumFileBytes: value.documents?.maximum_file_bytes,
      revisionHistory: value.documents?.revision_history
    },
    storage: { maximumBytes: value.storage?.maximum_bytes },
    sharing: {
      capabilityLinks: value.sharing?.capability_links,
      anonymousView: value.sharing?.anonymous_view,
      anonymousEdit: value.sharing?.anonymous_edit,
      guestPresence: value.sharing?.guest_presence
    },
    collaboration: {
      enabled: value.collaboration?.enabled,
      maximumParticipants: value.collaboration?.maximum_participants
    },
    ai: {
      enabled: value.ai?.enabled,
      monthlyCreditAllowance: value.ai?.monthly_credit_allowance
    }
  })
}

export function parseStaticEntitlementsTOML(input: unknown): StaticEntitlements {
  return staticEntitlementsFromTOML(v.parse(staticEntitlementsTOMLSchema, input))
}

export function staticEntitlementValues(input: unknown): Record<string, boolean | number> {
  const entitlements = v.parse(staticEntitlementsSchema, input)
  const values: Record<string, boolean | number | undefined> = {
    [CLOUD_FEATURE_KEYS.maximumFileBytes]: entitlements.documents.maximumFileBytes,
    [CLOUD_FEATURE_KEYS.revisionHistory]: entitlements.documents.revisionHistory,
    [CLOUD_FEATURE_KEYS.maximumStorageBytes]: entitlements.storage.maximumBytes,
    [CLOUD_FEATURE_KEYS.capabilityLinks]: entitlements.sharing.capabilityLinks,
    [CLOUD_FEATURE_KEYS.anonymousView]: entitlements.sharing.anonymousView,
    [CLOUD_FEATURE_KEYS.anonymousEdit]: entitlements.sharing.anonymousEdit,
    [CLOUD_FEATURE_KEYS.guestPresence]: entitlements.sharing.guestPresence,
    [CLOUD_FEATURE_KEYS.collaboration]: entitlements.collaboration.enabled,
    [CLOUD_FEATURE_KEYS.maximumParticipants]: entitlements.collaboration.maximumParticipants,
    [CLOUD_FEATURE_KEYS.cloudAI]: entitlements.ai.enabled,
    [CLOUD_FEATURE_KEYS.monthlyCreditAllowance]: entitlements.ai.monthlyCreditAllowance
  }
  return pickBy(values, isNotNil) as Record<string, boolean | number>
}
