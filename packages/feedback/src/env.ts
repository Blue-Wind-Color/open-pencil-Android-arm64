import type { D1Database, RateLimit, SendEmail } from '@cloudflare/workers-types/index'

/**
 * The Worker's bindings, from `wrangler.jsonc` and its secrets. They are declared here with
 * importable Workers types rather than taken from the generated global `Env`, so the app can
 * typecheck `FeedbackAPI` for its client without the Workers runtime globals; `src/index.ts`
 * checks that the two agree.
 */
export interface FeedbackBindings {
  DB: D1Database
  EMAIL: SendEmail
  PING_LIMITER: RateLimit
  INGEST_LIMITER: RateLimit
  WAITLIST_LIMITER: RateLimit
  POSTHOG_HOST: string
  POSTHOG_KEY: string
  EMAIL_FROM: string
  /** The sites whose Turnstile passes a sign-up accepts, separated by commas. */
  TURNSTILE_HOSTNAMES: string
  TURNSTILE_SECRET: string
  /** `owner/name` of the repository whose stars, downloads, and traffic are recorded. */
  GITHUB_REPOSITORY: string
  /** A fine-grained token that can read the repository's traffic (Administration: read). */
  GITHUB_TOKEN: string
  /** The Cloudflare zone holding `SITE_HOSTS`, for its visit analytics. */
  SITE_ZONE_ID: string
  /** The hostnames whose visits are recorded, separated by commas; the first is the website. */
  SITE_HOSTS: string
  /** A Cloudflare API token that can read the zone's analytics. */
  CLOUDFLARE_ANALYTICS_TOKEN: string
}

export type FeedbackEnv = { Bindings: FeedbackBindings }

/** What the service reaches outside its bindings, injectable for tests. */
export interface FeedbackServices {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now: () => Date
}
