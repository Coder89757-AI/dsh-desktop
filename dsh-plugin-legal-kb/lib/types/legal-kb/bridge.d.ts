/** Legal-KB Host bridge: license activation, settings persistence, and the
 * dynamic dsh-mcp-client mount that exposes the knowledge-base MCP tools. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Stable Cordis plugin name. */
export declare const name = "legal-kb-bridge";
/** Services required before the bridge can register routes and settings. */
export declare const inject: string[];
/** Settings namespace owned by the Legal-KB bridge. */
export declare const LEGAL_KB_SETTINGS_NAMESPACE = "legal-kb";
/** Default lexford API base used for license activation. */
export declare const LEGAL_KB_DEFAULT_API_URL = "http://127.0.0.1:8310";
/** Default lexford MCP HTTP endpoint bridged into the tool registry. */
export declare const LEGAL_KB_DEFAULT_MCP_URL = "http://127.0.0.1:8300/mcp";
/** Stable MCP server namespace for the bridged tool names. */
export declare const LEGAL_KB_SERVER_NAME = "legal-kb";
/** Persisted Legal-KB bridge configuration. */
export interface LegalKbSettings {
    /** Knowledge-base API base used for license activation. */
    apiUrl: string;
    /** Knowledge-base MCP HTTP endpoint bridged into `ctx.tools`. */
    mcpUrl: string;
    /** License code persisted after a successful activation. */
    licenseCode: string;
}
/** Schema registered with the standard settings service. */
export declare const LegalKbSettingsSchema: z<LegalKbSettings>;
/**
 * Register the Legal-KB bridge: private same-origin activation routes, the
 * persisted settings namespace, and one `dsh-mcp-client` generation whose
 * Authorization header follows the persisted license code.
 * @param ctx - Host context carrying the web server, settings, and connection services.
 */
export declare function apply(ctx: Context): void;
