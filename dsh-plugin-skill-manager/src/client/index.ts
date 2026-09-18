/** Skill-manager client plugin: settings page section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { applySkillManager } from './skill-manager.ts'

export { applySkillManager } from './skill-manager.ts'

/** Services required by the skill-manager settings section. */
export const inject = ['slots', 'locale']

/** Register the skill-manager client surfaces. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  applySkillManager(ctx)
}
