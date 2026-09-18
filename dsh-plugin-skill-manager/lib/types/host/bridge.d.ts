/** Skill-manager Host bridge: MCP server configuration plus skill inventory
 * and lifecycle, exposed over private same-origin routes. */
import type { Context } from '@deepseek-ai/cordis';
/** Stable Cordis plugin name. */
export declare const name = "skill-manager-bridge";
/** Services resolved before routes register. */
export declare const inject: string[];
/** Register the bridge: management routes over the shared web server. */
export declare function apply(ctx: Context): void;
