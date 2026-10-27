import type { ELK, ElkNode } from 'elkjs/lib/elk-api'

import { IS_BROWSER } from '#core/constants'

/** A worker a runtime can stop counting as a reason to stay alive, as Bun's can. */
interface Unreffable {
  ref(): void
  unref(): void
}

function unreffable(worker: Worker): (Worker & Unreffable) | null {
  return 'ref' in worker && 'unref' in worker ? (worker as Worker & Unreffable) : null
}

interface Engine {
  elk: ELK
  /** ELK's worker, when it has one the runtime would otherwise wait for. */
  worker: () => Unreffable | null
}

let engine: Promise<Engine> | null = null
/** Layouts in flight. */
let running = 0

/**
 * Whether ELK's bundle would take this thread for a worker of its own, as it does wherever
 * `self` exists outside a page: in Bun, Deno, and Web Workers. It then answers messages instead
 * of laying out in place.
 */
function looksLikeWorker(): boolean {
  return !IS_BROWSER && 'self' in globalThis
}

async function load(): Promise<Engine> {
  if (!looksLikeWorker()) {
    const { default: BundledELK } = await import('elkjs/lib/elk.bundled.js')
    return { elk: new BundledELK(), worker: () => null }
  }
  // There, ELK's worker script runs in a real worker.
  const { default: WorkerELK } = await import('elkjs/lib/elk-api.js')
  const script = import.meta.resolve('elkjs/lib/elk-worker.min.js')
  let held: Unreffable | null = null
  const elk = new WorkerELK({
    workerFactory: () => {
      const worker = new Worker(script)
      held = unreffable(worker)
      // An idle worker must not keep a script or command from finishing.
      held?.unref()
      return worker
    }
  })
  return { elk, worker: () => held }
}

function elkEngine(): Promise<Engine> {
  engine ??= load().catch((error: unknown) => {
    engine = null
    throw error
  })
  return engine
}

/**
 * Lays `graph` out with the Eclipse Layout Kernel, loaded on first use and kept for later
 * layouts. Its worker, where it has one, keeps the process alive only while a layout runs.
 */
export async function layoutWithElk(graph: ElkNode): Promise<ElkNode> {
  const { elk, worker } = await elkEngine()
  const layout = elk.layout(graph)
  if (running++ === 0) worker()?.ref()
  try {
    return await layout
  } finally {
    if (--running === 0) worker()?.unref()
  }
}
