/** Fetch wrapper for the skill-manager host routes. */
import { type McpServerEntry, type McpTestResponse, type McpToolsResponse, type SkillManagerStateResponse } from '../host/contract.ts';
/** Renderer-facing skill manager API. */
export interface SkillManagerApi {
    state(): Promise<SkillManagerStateResponse>;
    saveServer(server: McpServerEntry): Promise<McpServerEntry>;
    removeServer(serverName: string): Promise<void>;
    toggleServer(serverName: string, enabled: boolean): Promise<void>;
    testServer(server: McpServerEntry): Promise<McpTestResponse>;
    /**
     * List the tools one server publishes. A running server answers from its live
     * registration; `probe` forces a temporary connection instead, which is how a
     * caller asks about the entry in hand rather than the one already running.
     */
    listTools(server: McpServerEntry, probe?: boolean): Promise<McpToolsResponse>;
    toggleSkill(name: string, scope: 'system' | 'user', enabled: boolean): Promise<void>;
    saveSkill(name: string, content: string): Promise<void>;
    deleteSkill(name: string): Promise<void>;
    importSkills(sourceDir: string): Promise<readonly string[]>;
    readSkill(name: string, scope: 'system' | 'user'): Promise<{
        content: string;
        readOnly: boolean;
    }>;
    pickDirectory(): Promise<string | null>;
}
export declare function createSkillManagerApi(): SkillManagerApi;
