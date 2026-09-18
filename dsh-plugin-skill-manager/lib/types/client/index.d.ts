/** Skill-manager client plugin: settings page section. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
export { applySkillManager } from './skill-manager.ts';
/** Services required by the skill-manager settings section. */
export declare const inject: string[];
/** Register the skill-manager client surfaces. @param ctx - browser Cordis context. */
export declare function apply(ctx: ClientContext): void;
