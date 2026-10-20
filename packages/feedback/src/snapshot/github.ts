import { utcDayOfTimestamp } from '#feedback/days'
import type { FeedbackServices } from '#feedback/env'
import type { CalendarDate } from '@internationalized/date'
import { groupBy, sumBy } from 'es-toolkit'
import * as v from 'valibot'

import { releaseFileKind } from './assets'

const API = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 15_000
// GitHub's maximum page size; a repository with more releases takes several pages.
const RELEASES_PER_PAGE = 100

const RepositorySchema = v.object({ stargazers_count: v.number(), forks_count: v.number() })
const ReleasesSchema = v.array(
  v.object({
    tag_name: v.string(),
    assets: v.array(v.object({ name: v.string(), download_count: v.number() }))
  })
)
const TrafficDaySchema = v.object({ timestamp: v.string(), count: v.number(), uniques: v.number() })
const ViewsSchema = v.object({ views: v.array(TrafficDaySchema) })
const ClonesSchema = v.object({ clones: v.array(TrafficDaySchema) })
const ReferrersSchema = v.array(
  v.object({ referrer: v.string(), count: v.number(), uniques: v.number() })
)

export interface GithubTotals {
  stars: number
  forks: number
  /** Running download totals per release and kind of file. */
  downloads: { tag: string; kind: string; downloads: number }[]
}

export interface GithubTraffic {
  days: {
    day: CalendarDate
    views: number
    uniqueViews: number
    clones: number
    uniqueClones: number
  }[]
  referrers: { referrer: string; views: number; uniqueViews: number }[]
}

/** Reads the repository's GitHub API with the snapshot's token; a failed or unexpected answer throws. */
export function githubClient(
  fetcher: FeedbackServices['fetch'],
  repository: string,
  token: string
) {
  async function get<T extends v.GenericSchema>(
    path: string,
    schema: T
  ): Promise<v.InferOutput<T>> {
    const response = await fetcher(`${API}/repos/${repository}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'openpencil-feedback',
        'X-GitHub-Api-Version': '2026-03-10'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok)
      throw new Error(`GitHub /repos/${repository}${path} answered ${response.status}`)
    const result = v.safeParse(v.pipe(v.string(), v.parseJson(), schema), await response.text())
    if (!result.success)
      throw new Error(`GitHub /repos/${repository}${path} sent an unexpected answer`)
    return result.output
  }

  async function releases() {
    const all: v.InferOutput<typeof ReleasesSchema> = []
    for (let page = 1; ; page++) {
      const batch = await get(
        `/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
        ReleasesSchema
      )
      all.push(...batch)
      if (batch.length < RELEASES_PER_PAGE) return all
    }
  }

  return {
    async totals(): Promise<GithubTotals> {
      const [repository, published] = await Promise.all([get('', RepositorySchema), releases()])
      const files = published.flatMap((release) =>
        release.assets.flatMap((asset) => {
          const kind = releaseFileKind(asset.name)
          return kind ? [{ tag: release.tag_name, kind, downloads: asset.download_count }] : []
        })
      )
      const downloads = Object.values(
        groupBy(files, (file) => `${file.tag}\n${file.kind}`)
      ).flatMap((group) =>
        group[0]
          ? [
              {
                tag: group[0].tag,
                kind: group[0].kind,
                downloads: sumBy(group, (file) => file.downloads)
              }
            ]
          : []
      )
      return { stars: repository.stargazers_count, forks: repository.forks_count, downloads }
    },

    /** The last 14 days of views and clones, and the referrers over that window. */
    async traffic(): Promise<GithubTraffic> {
      const [views, clones, referrers] = await Promise.all([
        get('/traffic/views?per=day', ViewsSchema),
        get('/traffic/clones?per=day', ClonesSchema),
        get('/traffic/popular/referrers', ReferrersSchema)
      ])
      // GitHub stamps each day with its UTC midnight; days are matched by their date.
      const dayOf = (entry: { timestamp: string }) => utcDayOfTimestamp(entry.timestamp)
      const clonesByDay = new Map(clones.clones.map((entry) => [dayOf(entry).toString(), entry]))
      return {
        days: views.views.map((entry) => {
          const day = dayOf(entry)
          const cloned = clonesByDay.get(day.toString())
          return {
            day,
            views: entry.count,
            uniqueViews: entry.uniques,
            clones: cloned?.count ?? 0,
            uniqueClones: cloned?.uniques ?? 0
          }
        }),
        referrers: referrers.map((referrer) => ({
          referrer: referrer.referrer,
          views: referrer.count,
          uniqueViews: referrer.uniques
        }))
      }
    }
  }
}
