/** Offline-plugins Host bridge: profile plugin inventory, offline export of
 * dependency closures, and offline import that registers Profile bundles. */
import type { Context } from '@deepseek-ai/cordis';
/** Stable Cordis plugin name. */
export declare const name = "offline-plugins-bridge";
/** Services resolved before routes register. */
export declare const inject: string[];
/** Register the bridge: three private same-origin routes over the shared web server. */
export declare function apply(ctx: Context): void;
