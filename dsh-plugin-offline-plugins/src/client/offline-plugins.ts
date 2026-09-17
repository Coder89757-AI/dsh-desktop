/** Offline-plugins sidebar entry registration for the Desktop client bundle. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OfflinePluginsPanel } from './OfflinePluginsPanel.tsx'
import { createOfflinePluginsApi } from './offline-plugins-api.ts'
import { en, zh, type OfflinePluginsLocaleKey } from './offline-plugins-locales.ts'
import { installOfflinePluginsStyles } from './offline-plugins-styles.ts'

/** Locale namespace owned by the offline-plugins entry. */
export const OFFLINE_PLUGINS_LOCALE_NAMESPACE = 'offline-plugins'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Offline-plugins sidebar entry copy. */
    'offline-plugins': OfflinePluginsLocaleKey
  }
}

/** Register the offline-plugins entry in the sidebar footer action list slot. */
export function applyOfflinePlugins(ctx: ClientContext): void {
  const api = createOfflinePluginsApi()
  ctx.effect(
    () => ctx.locale.register(OFFLINE_PLUGINS_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-offline-plugins: dictionaries',
  )
  ctx.effect(
    () => installOfflinePluginsStyles(),
    'dsh-plugin-offline-plugins: styles',
  )
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'offline-plugins',
    order: 30,
    locale: OFFLINE_PLUGINS_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, OfflinePluginsPanel))
}
