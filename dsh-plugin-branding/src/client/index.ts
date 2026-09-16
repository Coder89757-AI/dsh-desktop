/** Branding client plugin: intercepts the locale runtime's dictionary lookup
 * so brand copy replaces the shipped dictionaries without owning their
 * namespaces (official register throws on duplicate owners). The interceptor
 * is installed on the LocaleRuntime prototype — every translate call funnels
 * through `lookup`, so one wrapper covers all mounted surfaces and stays
 * independent of plugin boot order. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BRAND_COPY } from './brand-map.ts'

/** Services required before the interceptor can find the locale runtime. */
export const inject = ['locale']

type Lookup = (this: LocaleRuntime, ns: string, key: string, chain: readonly string[]) => string | undefined

/** Install the lookup interceptor once per client boot. */
export function apply(ctx: ClientContext): void {
  const runtime = ctx.locale as unknown as {
    constructor: { prototype: { lookup?: Lookup } }
  }
  const prototype = runtime.constructor.prototype
  if (prototype.lookup === undefined || (prototype.lookup as { __branding?: boolean }).__branding === true) {
    return
  }
  const original = prototype.lookup
  const branded: Lookup = function branded(this: LocaleRuntime, ns, key, chain) {
    const locale = chain[0] ?? 'en'
    const override = BRAND_COPY.get(`${locale}:${ns}.${key}`)
    return override ?? original.call(this, ns, key, chain)
  }
  ;(branded as { __branding?: boolean }).__branding = true
  prototype.lookup = branded
}
