/** Legal-KB client plugin: sidebar entry and connection panel. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { applyLegalKb } from './legal-kb.ts'

export { applyLegalKb } from './legal-kb.ts'

/** Services required by the Legal-KB sidebar entry. */
export const inject = ['slots', 'locale']

/** Register the Legal-KB client surfaces. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  applyLegalKb(ctx)
}
