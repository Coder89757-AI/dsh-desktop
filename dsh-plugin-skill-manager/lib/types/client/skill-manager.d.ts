/** Skill-manager client registration: the settings page section. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type SkillManagerLocaleKey } from './skill-manager-locales.ts';
/** Locale namespace owned by the skill-manager entry. */
export declare const SKILL_MANAGER_LOCALE_NAMESPACE = "skill-manager";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Skill-manager settings section copy. */
        'skill-manager': SkillManagerLocaleKey;
    }
}
/** Register the skill-manager section in the settings page. */
export declare function applySkillManager(ctx: ClientContext): void;
