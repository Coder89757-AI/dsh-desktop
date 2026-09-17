/** Apply optional local branding before the icon generation chain runs.
 *
 * Reads `branding/` (package-local first, then repository root; both are
 * gitignored) and, when a source exists, overwrites the tracked build sources:
 *
 *   branding/app-icon.svg  → build/app-icon.png  (1024×1024 RGBA16 + ICC, the
 *                            exact spec generate-windows-app-icon validates)
 *   branding/app-icon.svg  → build/tray-icon.svg (paths wrapped with the fixed
 *                            brand blue so loadSmallFrameArtwork keeps passing)
 *   branding/brand.json    → build/branding.json (productName, displayName,
 *                            windowTitle; see the field notes below)
 *
 * Without a branding directory this script is a no-op and the shipped assets
 * build exactly as before. Run order: this script precedes generate-*-icons.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const buildDir = join(packageRoot, 'build')

/** Locate one branding source file: package-local branding/ wins over root. */
function brandingPath(name) {
  for (const base of [join(packageRoot, 'branding'), join(repoRoot, 'branding')]) {
    const candidate = join(base, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function readBrandingJson() {
  const path = brandingPath('brand.json')
  if (path === undefined) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    console.warn(`apply-branding: ignoring invalid ${path}`)
    return undefined
  }
}

/** Render the supplied SVG as the 1024×1024 RGBA16 + ICC PNG the icon
 * generator validates against. */
async function renderAppIconPng(svgPath) {
  const svg = readFileSync(svgPath)
  return sharp(svg, { density: 300 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toColourspace('rgb16')
    .ensureAlpha()
    .png()
    .withMetadata({ icc: 'srgb' })
    .toBuffer()
}

/** Wrap the brand artwork in the fixed brand-blue tray source that the tray
 * and small-frame generators validate against. */
function renderTraySvg(svgPath) {
  const source = readFileSync(svgPath, 'utf8')
  const inner = source
    .replace(/^<\?xml[\s\S]*?\?>/, '')
    .replace(/<!DOCTYPE[\s\S]*?>/, '')
    .replace(/^<svg[^>]*>/u, '')
    .replace(/<\/svg>\s*$/u, '')
    .replace(/ fill="[^"]*"/gu, '')
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
    + `<g fill="#4D6BFE">${inner}</g>`
    + '</svg>',
  )
}

const appIconSvg = brandingPath('app-icon.svg')
const brandJson = readBrandingJson()

if (appIconSvg === undefined && brandJson === undefined) {
  console.log('apply-branding: no branding directory found; keeping shipped assets')
  process.exit(0)
}

if (appIconSvg !== undefined) {
  const png = await renderAppIconPng(appIconSvg)
  writeFileSync(join(buildDir, 'app-icon.png'), png)
  writeFileSync(join(buildDir, 'tray-icon.svg'), renderTraySvg(appIconSvg))
  console.log('apply-branding: wrote branded build/app-icon.png and build/tray-icon.svg')
}

if (brandJson !== undefined) {
  // productName is the packaging identity (exe, shortcuts, install dir,
  // artifact names) — keep it ASCII/file-system-safe, e.g. "LexFord".
  // displayName is the runtime-visible brand (tray tooltip, application
  // menu) and may carry a localized name, e.g. "法海问津"; it falls back to
  // productName when omitted. windowTitle names the shell window.
  const projection = {}
  if (typeof brandJson.windowTitle === 'string' && brandJson.windowTitle.trim() !== '') {
    projection.windowTitle = brandJson.windowTitle.trim()
  }
  if (typeof brandJson.productName === 'string' && brandJson.productName.trim() !== '') {
    projection.productName = brandJson.productName.trim()
  }
  if (typeof brandJson.displayName === 'string' && brandJson.displayName.trim() !== '') {
    projection.displayName = brandJson.displayName.trim()
  }
  writeFileSync(join(buildDir, 'branding.json'), JSON.stringify(projection, null, 2) + '\n')
  console.log(`apply-branding: wrote build/branding.json (${JSON.stringify(projection)})`)
}
