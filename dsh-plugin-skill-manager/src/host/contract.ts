/** Shared contract between the skill-manager Host routes and client panel. */

/** Same-origin route returning the full management state. */
export const SKILL_MANAGER_STATE_PATH = '/_dsh/skill-manager/state'

/** Same-origin route persisting one MCP server entry. */
export const SKILL_MANAGER_MCP_SAVE_PATH = '/_dsh/skill-manager/mcp/save'

/** Same-origin route removing one MCP server entry. */
export const SKILL_MANAGER_MCP_REMOVE_PATH = '/_dsh/skill-manager/mcp/remove'

/** Same-origin route enabling or disabling one MCP server. */
export const SKILL_MANAGER_MCP_TOGGLE_PATH = '/_dsh/skill-manager/mcp/toggle'

/** Same-origin route probing one MCP server entry with a live connection. */
export const SKILL_MANAGER_MCP_TEST_PATH = '/_dsh/skill-manager/mcp/test'

/** Same-origin route listing the tools one MCP server entry publishes. */
export const SKILL_MANAGER_MCP_TOOLS_PATH = '/_dsh/skill-manager/mcp/tools'

/** Same-origin route enabling or disabling one skill. */
export const SKILL_MANAGER_SKILL_TOGGLE_PATH = '/_dsh/skill-manager/skills/toggle'

/** Same-origin route saving (creating or updating) a user skill. */
export const SKILL_MANAGER_SKILL_SAVE_PATH = '/_dsh/skill-manager/skills/save'

/** Same-origin route deleting a user skill. */
export const SKILL_MANAGER_SKILL_DELETE_PATH = '/_dsh/skill-manager/skills/delete'

/** Same-origin route importing skills from a picked directory. */
export const SKILL_MANAGER_SKILL_IMPORT_PATH = '/_dsh/skill-manager/skills/import'

/** Same-origin route reading one skill's full SKILL.md content. */
export const SKILL_MANAGER_SKILL_READ_PATH = '/_dsh/skill-manager/skills/read'

/** Launcher-owned directory chooser used by the import flow. */
export const DIRECTORY_PICKER_PATH = '/_dsh/desktop/pick-directory'

/** One configured MCP server. Mirrors the upstream mcp-client config shape. */
export interface McpServerEntry {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly enabled: boolean
  /** stdio transport: executable to spawn. */
  readonly command?: string
  /** stdio transport: arguments passed without shell interpolation. */
  readonly args?: readonly string[]
  /** stdio transport: extra environment variables. */
  readonly env?: Readonly<Record<string, string>>
  /** stdio transport: working directory. */
  readonly cwd?: string
  /** streamable-http transport: MCP endpoint URL. */
  readonly url?: string
  /** streamable-http transport: additional request headers. */
  readonly headers?: Readonly<Record<string, string>>
}

/** One skill as shown by the management panel. */
export interface SkillEntry {
  readonly name: string
  readonly description: string
  /** Where the skill is installed. System skills ship with the application. */
  readonly scope: 'system' | 'user'
  readonly enabled: boolean
  readonly kind: 'directory' | 'flat'
  /** Whether this entry was authored through the manager (import or save). */
  readonly path: string
}

export interface SkillManagerStateResponse {
  readonly mcpServers: readonly McpServerEntry[]
  readonly skills: readonly SkillEntry[]
}

export interface McpSaveRequest {
  readonly server: McpServerEntry
}

export interface McpRemoveRequest {
  readonly serverName: string
}

export interface McpToggleRequest {
  readonly serverName: string
  readonly enabled: boolean
}

export interface McpTestRequest {
  readonly server: McpServerEntry
}

export interface McpTestResponse {
  readonly ok: boolean
  readonly detail: string
}

/** One tool an MCP server publishes, as the model-facing registry knows it. */
export interface McpToolInfo {
  /** The server's own tool name, without the `mcp__<server>__` namespace. */
  readonly name: string
  readonly description: string
}

/** Where a tool catalog came from: the live instance or a temporary probe. */
export type McpToolSource = 'running' | 'probe'

/** Result of listing one server's tools; `tools` is empty whenever `ok` is false. */
export interface McpToolsResponse {
  readonly ok: boolean
  readonly detail: string
  readonly source?: McpToolSource
  readonly tools: readonly McpToolInfo[]
}

export interface McpToolsRequest {
  readonly server: McpServerEntry
  /** Force a temporary probe even when a live instance is already running. */
  readonly probe?: boolean
}

export interface SkillToggleRequest {
  readonly name: string
  readonly scope: 'system' | 'user'
  readonly enabled: boolean
}

export interface SkillSaveRequest {
  readonly name: string
  readonly content: string
}

export interface SkillDeleteRequest {
  readonly name: string
}

export interface SkillImportRequest {
  readonly sourceDir: string
}

export interface SkillReadResponse {
  readonly content: string
  readonly readOnly: boolean
}

export interface SkillManagerErrorResponse {
  readonly error: string
}
