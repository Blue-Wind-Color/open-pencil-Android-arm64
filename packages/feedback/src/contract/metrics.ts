import { type CalendarDate, parseDate } from '@internationalized/date'
import * as v from 'valibot'

/** The longest range one request covers; a year and a bit leaves room for "all time" for now. */
export const MAX_METRICS_RANGE_DAYS = 400

/** The day a `YYYY-MM-DD` string names, or `undefined` for one that does not exist (`2026-02-30`). */
function calendarDay(day: string): CalendarDate | undefined {
  try {
    return parseDate(day)
  } catch {
    return undefined
  }
}

// `isoDate` checks only the shape, so `2026-02-30` would pass without the calendar check.
const IsoDay = v.pipe(
  v.string(),
  v.isoDate(),
  v.check((day) => calendarDay(day) !== undefined, 'Not a calendar day.')
)

/**
 * Days from `start` to `end`. Valibot runs the range checks even when a day failed its own
 * check, so an impossible day counts as no span and only its own issue is reported.
 */
function span({ start, end }: { start: string; end: string }): number {
  const from = calendarDay(start)
  const to = calendarDay(end)
  return from && to ? to.compare(from) : 0
}

/** The UTC days the dashboard asks about, both included. */
export const MetricsQuerySchema = v.pipe(
  v.object({ start: IsoDay, end: IsoDay }),
  v.check((range) => span(range) >= 0, 'The range ends before it starts.'),
  v.check((range) => span(range) < MAX_METRICS_RANGE_DAYS, 'The range is too long.')
)

export type MetricsQuery = v.InferOutput<typeof MetricsQuerySchema>

// The answer is described once, as schemas: the Worker builds values of their types, and the
// dashboard parses the network answer with them before using it.
const Count = v.pipe(v.number(), v.minValue(0))

const RankedCountSchema = v.object({ name: v.string(), value: Count })
export type RankedCount = v.InferOutput<typeof RankedCountSchema>

const DailyGrowthSchema = v.object({ day: IsoDay, added: v.number() })
export type DailyGrowth = v.InferOutput<typeof DailyGrowthSchema>

/**
 * A day of issues or pull requests, split between the team (the repository's owners, members,
 * and collaborators) and the community: how many were open at the end of the day, and how many
 * were opened and closed that day.
 */
const IssueDaySchema = v.object({
  day: IsoDay,
  openTeam: Count,
  openCommunity: Count,
  openedTeam: Count,
  openedCommunity: Count,
  closedTeam: Count,
  closedCommunity: Count
})

/** What PostHog knows about the installs that share usage stats; `null` when it could not be asked. */
const MetricsUsageSchema = v.object({
  /** Different installs that opened the app in the range. */
  installs: Count,
  daily: v.array(v.object({ day: IsoDay, installs: Count })),
  /** Per first day: index 0 is how many installs started then, index n how many came back n days later. */
  retention: v.array(v.object({ cohort: IsoDay, values: v.array(Count) })),
  documents: v.array(RankedCountSchema),
  exports: v.array(RankedCountSchema),
  aiProviders: v.array(RankedCountSchema)
})
export type MetricsUsage = v.InferOutput<typeof MetricsUsageSchema>

/**
 * Everything the metrics dashboard shows for a range of UTC days. Days are ISO dates; `today`
 * is still being counted, and snapshot-based numbers only reach the last finished day.
 */
export const MetricsSnapshotSchema = v.object({
  asOf: v.pipe(v.string(), v.isoTimestamp()),
  today: IsoDay,
  /** The first day anything was recorded (pings or visits), or `null` before the first one. */
  earliest: v.nullable(IsoDay),
  start: IsoDay,
  end: IsoDay,
  /** Installs that pinged each day, by desktop and web. */
  dailyActive: v.array(v.object({ day: IsoDay, desktop: Count, web: Count })),
  /** Pings in the range by OS, desktop and web. */
  platforms: v.array(v.object({ os: v.string(), desktop: Count, web: Count })),
  /** Pings each day on the newest stable version and on everything else. */
  versions: v.object({
    latest: v.nullable(v.string()),
    daily: v.array(v.object({ day: IsoDay, latest: Count, other: Count }))
  }),
  /** The first day each stable version sent a ping, within the range. */
  releases: v.array(v.object({ day: IsoDay, version: v.string() })),
  /** Cloudflare visits each finished day to the website and to the web app; today is not recorded yet. */
  visits: v.array(v.object({ day: IsoDay, site: Count, app: Count })),
  website: v.object({ pages: v.array(RankedCountSchema), countries: v.array(RankedCountSchema) }),
  github: v.object({
    stars: v.object({ total: v.nullable(Count), daily: v.array(DailyGrowthSchema) }),
    /** Installer downloads across every release, and update checks from running desktop apps. */
    downloads: v.object({
      total: v.nullable(Count),
      latestTag: v.nullable(v.string()),
      latestTotal: v.nullable(Count),
      daily: v.array(DailyGrowthSchema),
      updateChecks: v.array(DailyGrowthSchema)
    }),
    traffic: v.array(v.object({ day: IsoDay, views: Count, uniqueViews: Count, clones: Count })),
    referrers: v.array(RankedCountSchema),
    /** Issues and pull requests per finished day, by the team and by everyone else; empty until the first sync. */
    activity: v.object({
      issues: v.array(IssueDaySchema),
      pulls: v.array(
        v.object({ ...IssueDaySchema.entries, mergedTeam: Count, mergedCommunity: Count })
      )
    })
  }),
  waitlist: v.object({
    total: Count,
    confirmed: Count,
    added: Count,
    /** Newest first, by email domain only. */
    recent: v.array(
      v.object({
        domain: v.string(),
        signedUpAt: v.pipe(v.string(), v.isoTimestamp()),
        confirmed: v.boolean()
      })
    )
  }),
  usage: v.nullable(MetricsUsageSchema)
})
export type MetricsSnapshot = v.InferOutput<typeof MetricsSnapshotSchema>
