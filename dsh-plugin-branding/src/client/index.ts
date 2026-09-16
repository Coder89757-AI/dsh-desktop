/** Branding client plugin: intercepts the locale runtime's dictionary lookup
 * so brand copy replaces the shipped dictionaries without owning their
 * namespaces (official register throws on duplicate owners). The interceptor
 * is installed on the LocaleRuntime prototype — every translate call funnels
 * through `lookup`, so one wrapper covers all mounted surfaces and stays
 * independent of plugin boot order.
 *
 * It also fills the brand-mark slots the official sidebar and conversation
 * shells declare but leave unregistered (their whale artwork is only the
 * renderSlot fallback). Slot keys are addressed as strings and the
 * declarations appear during the official shells' own apply, so the registry's
 * declaration injection queues these contributions until each declaration is
 * live. The locale runtime and slot registry are addressed through structural
 * types on purpose: pulling the official client type graphs into this package
 * would drag in nearly the whole client surface for three string keys. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { BRAND_COPY } from './brand-map.ts'
import { HeroBrandMark, SidebarBrandMark, SidebarBrandName } from './brand-mark.tsx'

/** Services required before the interceptor can find the runtime singletons. */
export const inject = ['slots', 'locale']

type Lookup = (ns: string, key: string, chain: readonly string[]) => string | undefined

/** Install the lookup interceptor once per client boot. */
export function apply(ctx: ClientContext): void {
  const runtime = ctx as unknown as {
    locale: { constructor: { prototype: { lookup?: Lookup } } }
    slots: {
      inject: (key: string, callback: () => (() => void) | Iterable<() => void>) => () => void
      register: (options: { name: string }, component: unknown) => () => void
    }
  }
  const locale = runtime.locale
  const prototype = locale.constructor.prototype
  if (prototype.lookup === undefined || (prototype.lookup as { __branding?: boolean }).__branding === true) {
    return
  }
  const original = prototype.lookup
  const branded: Lookup = function (ns, key, chain) {
    const localeId = chain[0] ?? 'en'
    const override = BRAND_COPY.get(`${localeId}:${ns}.${key}`)
    return override ?? original.call(locale, ns, key, chain)
  }
  ;(branded as { __branding?: boolean }).__branding = true
  prototype.lookup = branded

  const slots = runtime.slots
  /** Register into slots whose declarations appear during the shells' own
   * render-time assembly. The registry throws while a slot is undeclared and
   * when another entry already occupies the cell at the same priority; both
   * are retryable states, so poll instead of relying on declaration
   * subscription timing. */
  const registerWhenDeclared = (slotName: string, component: unknown): void => {
    const maxAttempts = 40
    const attempt = (remaining: number): void => {
      try {
        slots.register({ name: slotName }, component)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('already has a registration')) return
        if (remaining <= 0) {
          console.error(`dsh-plugin-branding: slot ${slotName} stayed undeclared`, error)
          return
        }
        setTimeout(() => { attempt(remaining - 1) }, 250)
      }
    }
    attempt(maxAttempts)
  }
  registerWhenDeclared('sidebar.brand.mark', SidebarBrandMark)
  registerWhenDeclared('sidebar.brand.name', SidebarBrandName)
  registerWhenDeclared('conversation.hero.brand.mark', HeroBrandMark)
}
