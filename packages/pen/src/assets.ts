import type { PenDocument, PenNode, PenOverride, PenPaint, PenPaints } from './schema'
import { possibleValues } from './variables'

/**
 * Where pen.dev's icon libraries come from. Lucide, Feather, and Phosphor are drawn from their
 * Iconify sets, which pen.dev draws at one weight; Material Symbols are glyphs of Google's variable
 * fonts, drawn at the icon's weight, as pen.dev draws them.
 */
const ICON_LIBRARIES: Partial<Record<string, { iconify: string } | { font: string }>> = {
  lucide: { iconify: 'lucide' },
  feather: { iconify: 'feather' },
  phosphor: { iconify: 'ph' },
  'Material Symbols Outlined': { font: 'Material Symbols Outlined' },
  'Material Symbols Rounded': { font: 'Material Symbols Rounded' },
  'Material Symbols Sharp': { font: 'Material Symbols Sharp' }
}

/** The Iconify name of an icon from a library drawn from Iconify. */
export function iconName(library: string, icon: string): string | null {
  const source = ICON_LIBRARIES[library]
  return source && 'iconify' in source ? `${source.iconify}:${icon}` : null
}

/** The font family of a library whose icons are font glyphs. */
export function iconFontFamily(library: string): string | null {
  const source = ICON_LIBRARIES[library]
  return source && 'font' in source ? source.font : null
}

/**
 * Whether an image URL names a file in the document's folder: no scheme, no absolute path, and no
 * `..` step out of it.
 */
export function isDocumentAssetPath(url: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('\\')) return false
  return !url.split(/[/\\]/).includes('..')
}

/** Whether an image URL carries the image itself, for the host to decode as a URL. */
export function isDataURL(url: string): boolean {
  return /^data:/i.test(url)
}

/** What a document draws from outside itself. */
export interface PenAssets {
  /** Iconify names of every icon drawn from Iconify. */
  icons: string[]
  /** Images to load: files relative to the document, and data URLs. */
  images: string[]
}

function paintList(paints: PenPaints | undefined): PenPaint[] {
  if (paints === undefined) return []
  return Array.isArray(paints) ? paints : [paints]
}

function paintImages(paints: PenPaints | undefined, images: Set<string>) {
  for (const paint of paintList(paints)) {
    if (typeof paint === 'object' && paint.type === 'image' && typeof paint.url === 'string') {
      if (isDocumentAssetPath(paint.url) || isDataURL(paint.url)) images.add(paint.url)
    }
  }
}

interface Found {
  doc: PenDocument
  icons: Set<string>
  images: Set<string>
  libraries: Set<string>
  /** Icons an override names without its library, which comes from the layer it overrides. */
  bareIcons: Set<string>
}

function addIcons(libraries: readonly string[], icons: readonly string[], found: Set<string>) {
  for (const library of libraries) {
    for (const icon of icons) {
      const name = iconName(library, icon)
      if (name) found.add(name)
    }
  }
}

function collect(node: PenOverride, assets: Found) {
  if (node.icon && (node.type === 'icon' || node.type === undefined)) {
    const icons = possibleValues(node.icon, assets.doc)
    if (node.library) {
      const libraries = possibleValues(node.library, assets.doc)
      for (const library of libraries) assets.libraries.add(library)
      addIcons(libraries, icons, assets.icons)
    } else {
      for (const icon of icons) assets.bareIcons.add(icon)
    }
  }
  paintImages(node.fill, assets.images)
  if (!(typeof node.stroke === 'object' && 'thickness' in node.stroke)) {
    paintImages(node.stroke, assets.images)
  }
  for (const child of node.children ?? []) collect(child, assets)
  for (const override of Object.values(node.descendants ?? {})) collect(override, assets)
}

/**
 * The Iconify icons and the image files a document draws, so a host can load them before reading
 * it. An icon or library bound to a variable counts every value the variable has.
 */
export function penAssets(doc: PenDocument): PenAssets {
  const assets: Found = {
    doc,
    icons: new Set(),
    images: new Set(),
    libraries: new Set(),
    bareIcons: new Set()
  }
  for (const node of doc.children) collect(node satisfies PenNode, assets)
  addIcons([...assets.libraries], [...assets.bareIcons], assets.icons)
  return { icons: [...assets.icons], images: [...assets.images] }
}
