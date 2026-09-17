/** Offline-plugins client plugin: settings page section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { applyOfflinePlugins } from './offline-plugins.ts'

export { applyOfflinePlugins } from './offline-plugins.ts'

/** Services required by the offline-plugins settings section. */
export const inject = ['slots', 'locale']

/** Register the offline-plugins client surfaces. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  applyOfflinePlugins(ctx)
}
