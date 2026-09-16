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
 * declarations appear during the shells' own render-time assembly, so these
 * contributions register through retry polling plus a slow keepalive rather
 * than the registry's declaration subscription. The locale runtime and slot
 * registry are addressed through structural types on purpose: pulling the
 * official client type graphs into this package would drag in nearly the
 * whole client surface for three string keys. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { BRAND_COPY } from './brand-map.ts'
import { HeroBrandMark, SidebarBrandMark, SidebarBrandName } from './brand-mark.tsx'

/** Services required before the interceptor can find the runtime singletons. */
export const inject = ['slots', 'locale']

type Lookup = (ns: string, key: string, chain: readonly string[]) => string | undefined

/** Install the lookup interceptor once per client boot. */
export function apply(ctx: ClientContext): void {
  console.info('[dsh-branding] client apply: installing brand copy interceptor')
  const runtime = ctx as unknown as {
    locale: {
      constructor: { prototype: { lookup?: Lookup } }
      translate?: (ns: string, key: string) => string
    }
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
  const branded: Lookup = function (this: unknown, ns, key, chain) {
    // Walk the whole fallback chain: the active locale id may be `zh-CN` while
    // brand copy is keyed under `zh` (or either), so the first entry alone is
    // not a reliable lookup key.
    for (const localeId of chain) {
      const override = BRAND_COPY.get(`${localeId}:${ns}.${key}`)
      if (override !== undefined) return override
    }
    return original.call(this, ns, key, chain)
  }
  ;(branded as { __branding?: boolean }).__branding = true
  prototype.lookup = branded
  // One-shot self check: the sidebar brand title should resolve to brand copy
  // immediately after the interceptor is installed.
  const sample = runtime.locale.translate?.('sidebar', 'brand.localBuild')
  console.info(`[dsh-branding] locale interceptor installed; sidebar brand.localBuild resolves to: ${JSON.stringify(sample)}`)

  const slots = runtime.slots
  /** Register into slots whose declarations appear during the shells' own
   * render-time assembly. The registry throws while a slot is undeclared and
   * when another entry already occupies the cell at the same priority; both
   * are retryable states, so poll instead of relying on declaration
   * subscription timing.
   *
   * After the first successful registration a slow keepalive keeps polling:
   * if the shells ever tear their slot declarations down and rebuild them
   * (layout-mode switches), the rebuilt record drops our entry and the keep
   * alive re-registers it. "Already occupied" is the healthy steady state and
   * is swallowed silently. */
  const FAST_INTERVAL_MS = 100
  const FAST_WINDOW_MS = 10_000
  const KEEPALIVE_INTERVAL_MS = 2_000
  const registerWithKeepalive = (slotName: string, component: unknown): void => {
    let attemptCount = 0
    let logged = false
    const attempt = (): void => {
      attemptCount += 1
      try {
        slots.register({ name: slotName }, component)
        if (!logged) {
          logged = true
          const count = (slots as { entriesOfSlot?: (k: string) => unknown[] }).entriesOfSlot?.(slotName)?.length
          console.info(`[dsh-branding] slot ${slotName} registered after ${attemptCount} attempt(s); entries now: ${count}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('already has a registration')) {
          if (!logged) {
            logged = true
            console.info(`[dsh-branding] slot ${slotName} already occupied after ${attemptCount} attempt(s)`)
          }
          return
        }
        if (attemptCount === 40) {
          console.warn(`[dsh-branding] slot ${slotName} still undeclared after 40 attempts; last error:`, error)
        }
      }
    }
    attempt()
    const fastTimer = setInterval(attempt, FAST_INTERVAL_MS)
    setTimeout(() => { clearInterval(fastTimer) }, FAST_WINDOW_MS)
    setInterval(attempt, KEEPALIVE_INTERVAL_MS)
  }
  registerWithKeepalive('sidebar.brand.mark', SidebarBrandMark)
  registerWithKeepalive('sidebar.brand.name', SidebarBrandName)
  registerWithKeepalive('conversation.hero.brand.mark', HeroBrandMark)
}
