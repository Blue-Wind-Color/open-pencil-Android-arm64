import * as v from 'valibot'

const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const nonNegativeIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(0))

export const staticEntitlementsSchema = v.object({
  documents: v.optional(
    v.object({
      maximumFileBytes: v.optional(positiveIntegerSchema),
      revisionHistory: v.optional(v.boolean())
    }),
    {}
  ),
  storage: v.optional(v.object({ maximumBytes: v.optional(positiveIntegerSchema) }), {}),
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
      maximumParticipants: v.optional(positiveIntegerSchema)
    }),
    {}
  ),
  ai: v.optional(
    v.object({
      enabled: v.optional(v.boolean()),
      monthlyCreditAllowance: v.optional(nonNegativeIntegerSchema)
    }),
    {}
  )
})
export type StaticEntitlements = v.InferOutput<typeof staticEntitlementsSchema>

export const staticEntitlementsTOMLSchema = v.object({
  documents: v.optional(
    v.object({
      maximum_file_bytes: v.optional(positiveIntegerSchema),
      revision_history: v.optional(v.boolean())
    })
  ),
  storage: v.optional(v.object({ maximum_bytes: v.optional(positiveIntegerSchema) })),
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
      maximum_participants: v.optional(positiveIntegerSchema)
    })
  ),
  ai: v.optional(
    v.object({
      enabled: v.optional(v.boolean()),
      monthly_credit_allowance: v.optional(nonNegativeIntegerSchema)
    })
  )
})
