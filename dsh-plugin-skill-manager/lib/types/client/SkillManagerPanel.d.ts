/**
 * Skill-manager settings section: MCP servers and skills in two tabs.
 *
 * The layout follows the shipped Plugins settings page: a titled section, an
 * underline tab strip, and one card per configured thing — every row expands in
 * place into its own editor instead of replacing the list, so which entry is
 * being worked on stays visible while the form is open.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SkillManagerApi } from './skill-manager-api.ts';
export interface SkillManagerInjected {
    readonly api: SkillManagerApi;
}
export type SkillManagerSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'skill-manager'> & InjectFace<SkillManagerInjected>;
export declare function SkillManagerSection(props: SkillManagerSectionProps): import("react").JSX.Element;
