import * as v from 'valibot'

export const DEFAULT_RECENT_FILES_LIMIT = 10
export const RECENT_FILES_LIMIT_MIN = 1
export const RECENT_FILES_LIMIT_MAX = 1000

export const recentFilesLimitSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(RECENT_FILES_LIMIT_MIN),
  v.maxValue(RECENT_FILES_LIMIT_MAX)
)

export function resolveRecentFilesLimit(value: unknown): number {
  const result = v.safeParse(recentFilesLimitSchema, value)
  return result.success ? result.output : DEFAULT_RECENT_FILES_LIMIT
}
