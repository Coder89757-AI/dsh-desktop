/** Offline-plugins sidebar entry registration for the Desktop client bundle. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { OfflinePluginsSection } from './OfflinePluginsPanel.tsx'
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

/** Register the offline-plugins section in the settings page. */
export function applyOfflinePlugins(ctx: ClientContext): void {
  const api = createOfflinePluginsApi()
  const t = ctx.locale.bind(OFFLINE_PLUGINS_LOCALE_NAMESPACE)
  ctx.effect(
    () => ctx.locale.register(OFFLINE_PLUGINS_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-offline-plugins: dictionaries',
  )
  ctx.effect(
    () => installOfflinePluginsStyles(),
    'dsh-plugin-offline-plugins: styles',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'offline-plugins',
    order: 40,
    label: () => t('title'),
    locale: OFFLINE_PLUGINS_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, OfflinePluginsSection))
}
