/** Shared branding projections for the packaging and verification scripts.
 *
 * `apply-branding.mjs` writes `build/branding.json` from the gitignored
 * `branding/` directory before packaging runs. When it carries a
 * `productName`, the installer file name, the install directory, the exe
 * name, and the Start Menu / desktop shortcuts all follow the brand instead
 * of the shipped identity; keep that name ASCII/file-system-safe (e.g.
 * "LexFord") because it becomes file and shortcut names. `displayName` and
 * `windowTitle` drive the runtime-visible surfaces instead. Without a brand
 * every helper here falls back to the shipped names and packaging behaves
 * exactly as before.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Shipped product identity used when no local brand is configured. */
export const DEFAULT_PRODUCT_NAME = 'DSH Desktop Beta'

/** Shipped artifact stem used when no local brand is configured. */
export const DEFAULT_ARTIFACT_STEM = 'DSH-Desktop-Beta'

/** Characters Windows forbids in file names, stripped from artifact names. */
const FORBIDDEN_NAME_CHARACTERS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'] as const

/** Strip Windows-forbidden file name characters from one artifact stem. */
export function sanitizeArtifactStem(productName: string): string {
  let stem = productName
  for (const character of FORBIDDEN_NAME_CHARACTERS) {
    stem = stem.split(character).join('')
  }
  return stem
}

/** Read the locally configured brand name, or null when unbranded. */
export function brandedProductName(desktopRoot: string): string | null {
  const path = join(desktopRoot, 'build', 'branding.json')
  if (!existsSync(path)) return null
  let document: unknown
  try {
    document = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  const productName = document !== null && typeof document === 'object'
    && typeof (document as { productName?: unknown }).productName === 'string'
    ? (document as { productName: string }).productName.trim()
    : ''
  return productName.length > 0 ? productName : null
}

/** The product name the packaged build must display. */
export function expectedProductName(desktopRoot: string): string {
  return brandedProductName(desktopRoot) ?? DEFAULT_PRODUCT_NAME
}

/** The artifact stem the packaged build must use in generated file names. */
export function expectedArtifactStem(desktopRoot: string): string {
  const brand = brandedProductName(desktopRoot)
  return brand === null ? DEFAULT_ARTIFACT_STEM : sanitizeArtifactStem(brand)
}

/** Build the electron-builder config overrides for one branded build. */
export function brandingConfigArgs(desktopRoot: string): readonly string[] {
  const brand = brandedProductName(desktopRoot)
  if (brand === null) return []
  const stem = sanitizeArtifactStem(brand)
  return [
    '--config.productName=' + brand,
    '--config.nsis.shortcutName=' + brand,
    '--config.nsis.artifactName=' + stem + '-${version}-${arch}-Setup.${ext}',
    '--config.win.artifactName=' + stem + '-${version}-${arch}-Portable.${ext}',
  ]
}
