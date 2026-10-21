import * as v from 'valibot'

/**
 * The contract between editors, Cloud, and an AI service. Cloud only advertises the service and
 * signs short-lived tokens for it; the service, official or self-hosted, proxies models and keeps
 * the credit wallet. It is versioned apart from the Cloud protocol so a service can change without
 * a Cloud release.
 */
export const CLOUD_AI_CONTRACT_VERSION = '1' as const
/** The `aud` of every token Cloud signs for an AI service. */
export const CLOUD_AI_TOKEN_AUDIENCE = 'openpencil-ai' as const
/** Where Cloud publishes the public keys an AI service verifies its tokens with. */
export const CLOUD_AI_JWKS_PATH = '/.well-known/jwks.json' as const

const url = v.pipe(v.string(), v.url())
const credits = v.pipe(v.number(), v.integer(), v.minValue(0))

export const cloudAIDiscoverySchema = v.object({
  endpoint: url,
  contractVersion: v.literal(CLOUD_AI_CONTRACT_VERSION)
})
export type CloudAIDiscovery = v.InferOutput<typeof cloudAIDiscoverySchema>

export const cloudBillingDiscoverySchema = v.object({ portalURL: url })
export type CloudBillingDiscovery = v.InferOutput<typeof cloudBillingDiscoverySchema>

export const createAITokenSchema = v.object({ workspaceId: v.pipe(v.string(), v.uuid()) })
export type CreateAITokenInput = v.InferOutput<typeof createAITokenSchema>

export function parseCreateAIToken(input: unknown): CreateAITokenInput {
  return v.parse(createAITokenSchema, input)
}

export const aiTokenSchema = v.object({
  token: v.pipe(v.string(), v.minLength(1)),
  expiresAt: v.pipe(v.string(), v.isoTimestamp())
})
export type AIToken = v.InferOutput<typeof aiTokenSchema>

/** What an AI service may rely on once a token's signature, issuer, audience, and expiry check. */
export const aiTokenClaimsSchema = v.object({
  iss: url,
  aud: v.literal(CLOUD_AI_TOKEN_AUDIENCE),
  sub: v.pipe(v.string(), v.minLength(1)),
  workspaceId: v.pipe(v.string(), v.uuid()),
  /** Credits the workspace's plan grants each month; `null` when Cloud sets no allowance. */
  monthlyCreditAllowance: v.nullable(credits),
  iat: v.pipe(v.number(), v.integer()),
  exp: v.pipe(v.number(), v.integer())
})
export type AITokenClaims = v.InferOutput<typeof aiTokenClaimsSchema>

export const aiModelSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  /** Credits per million input and output tokens. */
  creditsPerMillionInputTokens: credits,
  creditsPerMillionOutputTokens: credits,
  contextTokens: v.pipe(v.number(), v.integer(), v.minValue(1)),
  capabilities: v.object({ reasoning: v.boolean(), vision: v.boolean(), tools: v.boolean() })
})
export type AIModel = v.InferOutput<typeof aiModelSchema>

export const aiCatalogSchema = v.object({
  models: v.array(aiModelSchema),
  defaultModelID: v.pipe(v.string(), v.minLength(1))
})
export type AICatalog = v.InferOutput<typeof aiCatalogSchema>

export const aiCreditBucketSchema = v.object({
  kind: v.picklist(['allowance', 'purchased', 'grant']),
  remaining: credits,
  expiresAt: v.nullable(v.pipe(v.string(), v.isoTimestamp()))
})
export type AICreditBucket = v.InferOutput<typeof aiCreditBucketSchema>

export const aiWalletSchema = v.object({
  balance: credits,
  /** Spent first to last. */
  buckets: v.array(aiCreditBucketSchema)
})
export type AIWallet = v.InferOutput<typeof aiWalletSchema>

export const aiUsageEntrySchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  kind: v.picklist(['model', 'image', 'search']),
  modelID: v.nullable(v.string()),
  userId: v.pipe(v.string(), v.minLength(1)),
  credits
})
export type AIUsageEntry = v.InferOutput<typeof aiUsageEntrySchema>

export const aiUsagePageSchema = v.object({
  entries: v.array(aiUsageEntrySchema),
  next: v.nullable(v.string())
})
export type AIUsagePage = v.InferOutput<typeof aiUsagePageSchema>

/** Errors an AI service answers with, beside the upstream model's own. */
export const aiErrorCodeSchema = v.picklist([
  'unauthorized',
  'insufficient_credits',
  'model_not_allowed',
  'rate_limited'
])
export type AIErrorCode = v.InferOutput<typeof aiErrorCodeSchema>

export const aiErrorSchema = v.object({
  error: v.object({ code: aiErrorCodeSchema, message: v.optional(v.string()) })
})
export type AIError = v.InferOutput<typeof aiErrorSchema>

export const AI_ERROR_STATUS = {
  unauthorized: 401,
  insufficient_credits: 402,
  model_not_allowed: 403,
  rate_limited: 429
} as const satisfies Record<AIErrorCode, number>
