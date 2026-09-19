/** Local brand projection written by scripts/apply-branding.mjs.
 *
 * `branding/` is gitignored and machine-local; `build/branding.json` is its
 * projection and ships inside the packaged app. Without a brand every helper
 * here yields the shipped identity, so an unbranded build behaves exactly as it
 * did before branding existed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DESKTOP_RELEASE_IDENTITIES, type DesktopProductIdentity } from './product-identity.ts'

/** Fields `apply-branding.mjs` projects from `branding/brand.json`. */
export type BrandField = 'windowTitle' | 'productName' | 'displayName'

/**
 * Path of the packaged brand projection.
 *
 * `DSH_DESKTOP_BRANDING_PATH` pins the projection for a test run, the same way
 * `brandedUserDataDirectoryName` takes its brand as a parameter: a locally
 * branded checkout must not change what an assertion reads.
 */
function projectionPath(): string {
  return process.env.DSH_DESKTOP_BRANDING_PATH
    ?? fileURLToPath(new URL('../build/branding.json', import.meta.url))
}

/** Raw brand value for one field, or `undefined` when this build is unbranded. */
export function brandField(field: BrandField): string | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(projectionPath(), 'utf8'),
    ) as Record<string, unknown>
    const value = raw[field]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  } catch {
    return undefined
  }
}

/** Display-name projection for the visible surfaces, falling back to the shipped identity. */
export function brandingDisplay(field: BrandField, fallback: string): string {
  return brandField(field) ?? fallback
}

/**
 * Visible product name for user-facing copy on either side of the process
 * boundary.
 *
 * `displayName` is what a brand shows in its interface; `productName` stays
 * file-system and shortcut safe, so it is the middle fallback. The last resort
 * is the upstream product name rather than this edition's `productName`: both
 * editions present the same interface, and the Beta suffix belongs to the
 * installation identity, not to the copy.
 */
export function brandedDisplayName(
  fallback: string = DESKTOP_RELEASE_IDENTITIES.stable.productName,
): string {
  return brandingDisplay('displayName', brandingDisplay('productName', fallback))
}

/**
 * Electron user-data directory name for one edition.
 *
 * A brand names the packaged product, and both editions ship the same
 * `productName`, so the beta edition keeps its suffix: two installed editions
 * must never resolve to one data directory. `brand` is injectable so the path
 * helpers stay deterministic under test on a branded machine.
 */
export function brandedUserDataDirectoryName(
  identity: DesktopProductIdentity,
  brand: string | undefined = brandField('productName'),
): string {
  if (brand === undefined) return identity.productName
  return identity.releaseChannel === 'beta' ? `${brand} Beta` : brand
}
