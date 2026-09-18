/** MCP server configuration store and runtime loader.
 *
 * Server entries live in a manager-owned JSON file inside the desktop
 * profile (the profile's cordis.yml is rewritten by the launcher on every
 * boot, so it cannot carry user MCP entries). Enabled entries are loaded at
 * runtime as `@deepseek-ai/dsh-mcp-client` plugin instances through
 * `ctx.plugin()`, which makes add/remove/toggle take effect immediately —
 * no restart required. */
import type { Context } from '@deepseek-ai/cordis';
import type { McpServerEntry, McpTestResponse, McpToolsResponse } from './contract.ts';
export declare class McpStoreError extends Error {
    constructor(message: string);
}
export declare function validateServerEntry(entry: unknown): McpServerEntry;
/** Persistent MCP server list plus live mcp-client instances. */
export declare class McpStore {
    private readonly ctx;
    private readonly path;
    private readonly fibers;
    private servers;
    constructor(ctx: Context, profileDir: string);
    initialize(): Promise<void>;
    dispose(): Promise<void>;
    list(): readonly McpServerEntry[];
    save(entryInput: unknown): Promise<McpServerEntry>;
    remove(serverName: string): Promise<void>;
    toggle(serverName: string, enabled: boolean): Promise<void>;
    /** Probe one entry with a real MCP handshake: a temporary mcp-client
     * instance configured with `failOnStartupError: true`, awaited with a
     * timeout, then disposed. The probe uses a derived serverName so it never
     * collides with a live instance of the same server. */
    test(entryInput: unknown, timeoutMs?: number): Promise<McpTestResponse>;
    /**
     * List the tools one entry publishes.
     *
     * A server that is already running answers from the shared registry — those
     * are the tools the model can call right now — while anything else (saved but
     * disabled, or still being edited) gets a temporary probe. `forceProbe` skips
     * the running instance so a caller can ask what the entry in hand would
     * publish, rather than what the live one currently does.
     */
    listTools(entryInput: unknown, forceProbe?: boolean, timeoutMs?: number): Promise<McpToolsResponse>;
    /**
     * Load one temporary mcp-client instance for `entry`, run `read` against it
     * while it is live, then tear it down.
     *
     * A timed-out probe may never settle, so its disposal is scheduled without
     * blocking the response on the fiber promise.
     */
    private withProbe;
    /** Tools a running instance publishes, or `undefined` when none is live. */
    private runningTools;
    private read;
    private persist;
    private startOne;
    private stopOne;
}
