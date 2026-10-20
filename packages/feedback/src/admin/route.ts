import { MetricsQuerySchema } from '#feedback/contract'
import type { FeedbackEnv, FeedbackServices } from '#feedback/env'
import { validatedQuery } from '#feedback/http/request'
import { Hono } from 'hono'

import { requireAccess } from './access'
import { buildSnapshot } from './snapshot'

/**
 * The metrics dashboard's API, behind Cloudflare Access. Answers are for one signed-in person,
 * so nothing between here and the browser may keep a copy.
 */
export function adminRoutes(services: FeedbackServices) {
  return new Hono<FeedbackEnv>()
    .use('/admin/*', requireAccess(services))
    .get('/admin/api/snapshot', validatedQuery(MetricsQuerySchema), async (c) => {
      c.header('Cache-Control', 'private, no-store')
      return c.json(await buildSnapshot(c.env, services, c.req.valid('query')), 200)
    })
}
