/** Visible product name the Host injects into every native-ui document.
 *
 * The renderer has no filesystem, so it cannot read the packaged branding
 * projection the way the Host does. The Host resolves the name once per window
 * and passes it down the document URL, and every native surface reads it from
 * there — see `copy-product-name.ts` for the substitution contract.
 */

import { DESKTOP_RELEASE_IDENTITIES } from '../product-identity.ts'

/**
 * Resolve the product name for one native-ui document URL.
 *
 * The document URL is optional because copy dictionaries resolve their name
 * while the module loads, which also happens under the node-environment test
 * runner where no `window` exists.
 */
export function injectedProductName(search?: string): string {
  const source = search ?? (typeof window === 'undefined' ? '' : window.location.search)
  const value = new URLSearchParams(source).get('brand')
  // The fallback is the upstream product name, matching `brandedDisplayName`:
  // the Beta suffix belongs to the installation identity, not to the copy.
  return value !== null && value.trim() !== ''
    ? value.trim()
    : DESKTOP_RELEASE_IDENTITIES.stable.productName
}
