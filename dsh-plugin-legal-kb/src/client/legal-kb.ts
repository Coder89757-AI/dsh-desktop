/** Legal-KB sidebar entry registration for the Desktop client bundle. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { LegalKbFooterAction } from './LegalKbFooterAction.tsx'
import { createLegalKbApi } from './legal-kb-api.ts'
import { en, zh, type LegalKbLocaleKey } from './legal-kb-locales.ts'
import { installLegalKbStyles } from './legal-kb-styles.ts'

/** Locale namespace owned by the Legal-KB entry. */
export const LEGAL_KB_LOCALE_NAMESPACE = 'legal-kb'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Legal-KB sidebar entry copy. */
    'legal-kb': LegalKbLocaleKey
  }
}

/** Register the Legal-KB entry in the sidebar footer action list slot. */
export function applyLegalKb(ctx: ClientContext): void {
  const api = createLegalKbApi()
  ctx.effect(
    () => ctx.locale.register(LEGAL_KB_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: legal-kb dictionaries',
  )
  ctx.effect(
    () => installLegalKbStyles(),
    'dsh-plugin-desktop: legal-kb styles',
  )
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'legal-kb',
    order: 20,
    locale: LEGAL_KB_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, LegalKbFooterAction))
}
