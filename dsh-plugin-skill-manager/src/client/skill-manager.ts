/** Skill-manager client registration: the settings page section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SkillManagerSection } from './SkillManagerPanel.tsx'
import { createSkillManagerApi } from './skill-manager-api.ts'
import { en, zh, type SkillManagerLocaleKey } from './skill-manager-locales.ts'
import { installSkillManagerStyles } from './skill-manager-styles.ts'

/** Locale namespace owned by the skill-manager entry. */
export const SKILL_MANAGER_LOCALE_NAMESPACE = 'skill-manager'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skill-manager settings section copy. */
    'skill-manager': SkillManagerLocaleKey
  }
}

/** Register the skill-manager section in the settings page. */
export function applySkillManager(ctx: ClientContext): void {
  const api = createSkillManagerApi()
  const t = ctx.locale.bind(SKILL_MANAGER_LOCALE_NAMESPACE)
  ctx.effect(
    () => ctx.locale.register(SKILL_MANAGER_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-skill-manager: dictionaries',
  )
  ctx.effect(
    () => installSkillManagerStyles(),
    'dsh-plugin-skill-manager: styles',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skill-manager',
    order: 45,
    label: () => t('title'),
    locale: SKILL_MANAGER_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, SkillManagerSection))
}
