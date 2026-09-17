/** Offline-plugins client plugin: sidebar entry and management panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
export { applyOfflinePlugins } from './offline-plugins.ts';
/** Services required by the offline-plugins sidebar entry. */
export declare const inject: string[];
/** Register the offline-plugins client surfaces. @param ctx - browser Cordis context. */
export declare function apply(ctx: ClientContext): void;
