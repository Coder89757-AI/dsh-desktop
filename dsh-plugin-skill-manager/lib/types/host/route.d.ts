/** Strict same-origin HTTP handlers for the skill-manager management API. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpStore } from './mcp-store.ts';
import { SkillsStore } from './skills-store.ts';
export type SkillManagerRouteDeps = {
    readonly expectedOrigin: string;
    readonly mcpStore: McpStore;
    readonly skillsStore: SkillsStore;
};
/** Handle `GET /_dsh/skill-manager/state`. */
export declare function handleStateRequest(req: IncomingMessage, res: ServerResponse, deps: SkillManagerRouteDeps): void;
/** Handle `GET /_dsh/skill-manager/skills/read?name=...&scope=...`. */
export declare function handleSkillReadRequest(req: IncomingMessage, res: ServerResponse, deps: SkillManagerRouteDeps): void;
type RouteHandler = (req: IncomingMessage, res: ServerResponse, deps: SkillManagerRouteDeps) => void;
/** Handle `POST /_dsh/skill-manager/mcp/save`. */
export declare const handleMcpSaveRequest: RouteHandler;
export declare const handleMcpRemoveRequest: RouteHandler;
export declare const handleMcpToggleRequest: RouteHandler;
/** Handle `POST /_dsh/skill-manager/mcp/test` (long-running probe). */
export declare const handleMcpTestRequest: RouteHandler;
/** Handle `POST /_dsh/skill-manager/mcp/tools` (long-running probe). */
export declare const handleMcpToolsRequest: RouteHandler;
export declare const handleSkillToggleRequest: RouteHandler;
export declare const handleSkillSaveRequest: RouteHandler;
export declare const handleSkillDeleteRequest: RouteHandler;
export declare const handleSkillImportRequest: RouteHandler;
export {};
