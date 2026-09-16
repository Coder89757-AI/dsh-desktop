/** Legal-KB client plugin: sidebar entry and connection panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
export { applyLegalKb } from './legal-kb.ts';
/** Services required by the Legal-KB sidebar entry. */
export declare const inject: string[];
/** Register the Legal-KB client surfaces. @param ctx - browser Cordis context. */
export declare function apply(ctx: ClientContext): void;
