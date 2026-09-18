/** Local brand projection written by scripts/apply-branding.mjs.
 *
 * `branding/` is gitignored and machine-local; `build/branding.json` is its
 * projection and ships inside the packaged app. Without a brand every helper
 * here yields the shipped identity, so an unbranded build behaves exactly as it
 * did before branding existed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DesktopProductIdentity } from './product-identity.ts'

/** Fields `apply-branding.mjs` projects from `branding/brand.json`. */
export type BrandField = 'windowTitle' | 'productName' | 'displayName'

/** Raw brand value for one field, or `undefined` when this build is unbranded. */
export function brandField(field: BrandField): string | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL('../build/branding.json', import.meta.url)), 'utf8'),
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
