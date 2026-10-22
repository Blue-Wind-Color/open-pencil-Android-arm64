import type { SceneGraph } from '@open-pencil/scene-graph'

import { computeContentBounds } from '#core/io/formats/raster'
import { renderNodesToSVG, type SVGExportOptions, type SVGTextLayout } from '#core/io/formats/svg'

import {
  embeddedFontAlias,
  planFontEmbedding,
  registerEmbeddedFonts,
  type PDFFontFace,
  type PDFFontReport
} from './fonts'
import type { PDFPageSpec } from './plan'

export interface PDFExportOptions {
  title?: string
  /** The faces the text uses, to embed their files; without them text uses standard PDF fonts. */
  fonts?: readonly PDFFontFace[]
  /** Line breaks of text nodes as the editor laid them out, so paragraphs stay wrapped. */
  textLayout?: SVGTextLayout
}

export interface PDFExportResult {
  data: Uint8Array
  /** The pages written, in order. Pages with nothing visible are skipped. */
  pages: Array<{ label?: string; width: number; height: number }>
  /** Embedded and fallback faces, when `fonts` was given. */
  fonts?: PDFFontReport
}

interface PreparedPage {
  spec: PDFPageSpec
  svgElement: Element
  width: number
  height: number
}

type PageSVGOptions = Pick<SVGExportOptions, 'textLayout' | 'fontAlias'>

function preparePage(
  graph: SceneGraph,
  spec: PDFPageSpec,
  svgOptions: PageSVGOptions
): PreparedPage | null {
  const svg = renderNodesToSVG(graph, spec.pageId, spec.nodeIds, {
    xmlDeclaration: false,
    ...svgOptions
  })
  if (!svg) return null

  const bounds = computeContentBounds(graph, spec.nodeIds)
  if (!bounds) return null

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width <= 0 || height <= 0) return null

  const svgDoc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (svgDoc.querySelector('parsererror')) return null

  return { spec, svgElement: svgDoc.documentElement, width, height }
}

const orientationOf = (page: PreparedPage) => (page.width > page.height ? 'landscape' : 'portrait')

/**
 * A PDF with one page per spec, each sized to its content. Null when no page has anything visible.
 */
export async function renderPagesToPDFDetailed(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[],
  options: PDFExportOptions = {}
): Promise<PDFExportResult | null> {
  const embedding = options.fonts ? planFontEmbedding(options.fonts) : null
  const svgOptions: PageSVGOptions = {
    textLayout: options.textLayout,
    fontAlias: embedding ? embeddedFontAlias(embedding) : undefined
  }
  const preparePages = () =>
    specs
      .map((spec) => preparePage(graph, spec, svgOptions))
      .filter((page): page is PreparedPage => page !== null)
  let prepared = preparePages()
  if (prepared.length === 0) return null
  const first = prepared[0]

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])

  const doc = new jsPDF({
    orientation: orientationOf(first),
    unit: 'pt',
    format: [first.width, first.height],
    compress: true
  })

  if (options.title) {
    doc.setProperties({ title: options.title })
  }

  // jsPDF reads a font file when it is registered, so a face it refuses is only known now: the
  // pages are written again without that face's name.
  if (embedding && !registerEmbeddedFonts(doc, embedding)) prepared = preparePages()

  for (const [index, page] of prepared.entries()) {
    if (index > 0) doc.addPage([page.width, page.height], orientationOf(page))
    await svg2pdf(page.svgElement, doc, { x: 0, y: 0, width: page.width, height: page.height })
  }

  return {
    data: new Uint8Array(doc.output('arraybuffer')),
    pages: prepared.map((page) => ({
      label: page.spec.label,
      width: page.width,
      height: page.height
    })),
    ...(embedding ? { fonts: embedding.report } : {})
  }
}

/** One PDF page holding all `nodeIds`. */
export async function renderNodesToPDF(
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[],
  options: PDFExportOptions = {}
): Promise<Uint8Array | null> {
  const result = await renderPagesToPDFDetailed(graph, [{ pageId, nodeIds }], options)
  return result?.data ?? null
}
