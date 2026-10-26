import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { FIXTURES } from '#core-tests/helpers/paths'

import { FontManager } from '@open-pencil/core/text'

/** A font manager that asks no web provider, so a family's faces come from its catalog. */
function offlineManager() {
  const manager = new FontManager()
  manager.setOnlineFontProviders({})
  return manager
}

test('a face lookup that outlives a new catalog does not overwrite what the catalog says', async () => {
  const manager = offlineManager()
  const before = manager.familyFaces('Oswald')
  manager.setHostFontCatalog([{ family: 'Oswald', styles: ['Regular', 'Bold'] }])
  expect(await before).toBeNull()
  expect(manager.loadedFamilyFaces('Oswald')).toBeUndefined()
  expect(await manager.familyFaces('Oswald')).toEqual([
    { weight: 400, italic: false },
    { weight: 700, italic: false }
  ])
})

test('a new catalog tells listeners to ask for their families again', () => {
  const manager = offlineManager()
  let resets = 0
  const stop = manager.onFamilyFacesReset(() => resets++)
  manager.setHostFontCatalog([{ family: 'Oswald', styles: ['Regular'] }])
  stop()
  manager.setHostFontCatalog([])
  expect(resets).toBe(1)
})

test('draws every weight its variable font covers from the one file, in the same slant', async () => {
  const manager = offlineManager()
  const variable = await Bun.file(join(FIXTURES, 'fonts', 'InterVariable-Latin.ttf')).arrayBuffer()
  await manager.markLoaded('Fonts Test Variable', 'Regular', variable)
  expect(await manager.loadFont('Fonts Test Variable', 'Bold')).toBe(variable)
  expect(manager.isStyleLoaded('Fonts Test Variable', 'Bold')).toBe(true)
  // The file is upright, so it does not stand in for an italic.
  expect(await manager.loadFont('Fonts Test Variable', 'Bold Italic')).toBeNull()
})

test('an installed face of the style comes before a variable file loaded for another style', async () => {
  const manager = offlineManager()
  const family = 'Fonts Test Installed First'
  const variable = await Bun.file(join(FIXTURES, 'fonts', 'InterVariable-Latin.ttf')).arrayBuffer()
  const installed = await Bun.file(join(FIXTURES, 'fonts', 'InterRegular-Faces.ttf')).arrayBuffer()
  manager.setHostFontLoader(async (name, style) =>
    name === family && style === 'Regular' ? installed : null
  )
  await manager.markLoaded(family, 'Light', variable)
  expect(await manager.loadFont(family, 'Regular')).toBe(installed)
  // A weight nothing installs draws from the variable file.
  expect(await manager.loadFont(family, 'Bold')).toBe(variable)
})

test('a variable font shared with another weight still fetches the characters it lacks', async () => {
  const manager = new FontManager()
  manager.setOnlineFontProviders({ google: true })
  const family = 'Fonts Test Shared Coverage'
  const fontURL = 'https://fonts.gstatic.com/s/test/shared.ttf'
  const variable = await Bun.file(join(FIXTURES, 'fonts', 'InterVariable-Latin.ttf')).arrayBuffer()
  const asked: string[] = []
  manager.setWebFontFetch(async (url) => {
    if (url.startsWith('https://fonts.google.com/metadata/fonts'))
      return Response.json({
        familyMetadataList: [
          { family, fonts: { '400': {}, '700': {} }, axes: [{ tag: 'wght', min: 100, max: 900 }] }
        ]
      })
    if (url.startsWith('https://fonts.googleapis.com/css2')) {
      asked.push(new URL(url).searchParams.get('text') ?? '')
      return new Response(
        `@font-face { font-family: '${family}'; font-style: normal; font-weight: 100 900; src: url(${fontURL}) format('truetype'); }`
      )
    }
    if (url === fontURL) return new Response(variable.slice(0))
    return new Response(null, { status: 404 })
  })

  await manager.loadFont(family, 'Regular', 'abc')
  await manager.loadFont(family, 'Bold', 'xyz')
  expect(asked.at(-1)).toContain('xyz')
})
