import { fromUint8Array } from 'js-base64'

import type { SVGFontAlias } from '#core/io/formats/svg'
import { hasTrueTypeOutlines, isVariableFont } from '#core/text/font/variation'

/**
 * jsPDF draws text in its standard fonts and in the files registered with it, and keeps only a
 * normal and a bold face per family. Every embedded face is therefore registered under a family
 * name of its own, and the SVG handed to svg2pdf names the face by it.
 */

/** A face the text uses, with the file the canvas draws it from, or why there is none. */
export interface PDFFontFace {
  family: string
  style: string
  data: ArrayBuffer | null
  /** Why there is no file, when `data` is null. */
  missing?: string
}

/** The jsPDF calls that register a font file. */
export interface PDFFontTarget {
  addFileToVFS(fileName: string, data: string): unknown
  addFont(fileName: string, family: string, style: string): unknown
}

export interface PDFFontReport {
  /** Faces embedded in the file, such as `Inter Bold Italic`. */
  embedded: string[]
  /** Faces drawn in a standard PDF font instead, with the reason. */
  fallback: Array<{ face: string; reason: string }>
}

interface EmbeddedFace {
  alias: string
  data: ArrayBuffer
  label: string
}

/** The faces to embed, by family and style, and what happened to each face. */
export interface PDFFontEmbedding {
  faces: Map<string, EmbeddedFace>
  report: PDFFontReport
}

const faceKey = (family: string, style: string) => `${family}\0${style}`

/** Why jsPDF cannot embed a font file, or null when it can. */
function unsupportedReason(data: ArrayBuffer): string | null {
  if (!hasTrueTypeOutlines(data)) return 'not a TrueType font file'
  // jsPDF would draw every weight of a variable font in its default instance.
  if (isVariableFont(data)) return 'variable font'
  return null
}

/** Picks the faces jsPDF can embed, each under a family name of its own. */
export function planFontEmbedding(faces: readonly PDFFontFace[]): PDFFontEmbedding {
  const embedding: PDFFontEmbedding = { faces: new Map(), report: { embedded: [], fallback: [] } }
  for (const face of faces) {
    const label = `${face.family} ${face.style}`
    if (!face.data) {
      embedding.report.fallback.push({
        face: label,
        reason: face.missing ?? 'font file not available'
      })
      continue
    }
    const reason = unsupportedReason(face.data)
    if (reason) {
      embedding.report.fallback.push({ face: label, reason })
      continue
    }
    // jsPDF reads family names as CSS: letters and digits only keep them unambiguous.
    const alias = `EmbeddedFont${embedding.faces.size}`
    embedding.faces.set(faceKey(face.family, face.style), { alias, data: face.data, label })
  }
  return embedding
}

/** The family the SVG names each embedded face by. */
export function embeddedFontAlias(embedding: PDFFontEmbedding): SVGFontAlias {
  return (family, style) => embedding.faces.get(faceKey(family, style))?.alias ?? null
}

/**
 * Registers each planned face's file with jsPDF. A face jsPDF refuses is dropped from the
 * embedding and reported as a fallback; returns false when any was.
 */
export function registerEmbeddedFonts(doc: PDFFontTarget, embedding: PDFFontEmbedding): boolean {
  let registered = true
  for (const [key, { alias, data, label }] of embedding.faces) {
    try {
      doc.addFileToVFS(`${alias}.ttf`, fromUint8Array(new Uint8Array(data)))
      doc.addFont(`${alias}.ttf`, alias, 'normal')
      embedding.report.embedded.push(label)
    } catch (error) {
      embedding.faces.delete(key)
      const reason = error instanceof Error ? error.message : String(error)
      embedding.report.fallback.push({ face: label, reason })
      registered = false
    }
  }
  return registered
}
