/** Fetch wrapper for the skill-manager host routes. */

import {
  DIRECTORY_PICKER_PATH,
  SKILL_MANAGER_MCP_REMOVE_PATH,
  SKILL_MANAGER_MCP_SAVE_PATH,
  SKILL_MANAGER_MCP_TEST_PATH,
  SKILL_MANAGER_MCP_TOGGLE_PATH,
  SKILL_MANAGER_MCP_TOOLS_PATH,
  SKILL_MANAGER_SKILL_DELETE_PATH,
  SKILL_MANAGER_SKILL_IMPORT_PATH,
  SKILL_MANAGER_SKILL_READ_PATH,
  SKILL_MANAGER_SKILL_SAVE_PATH,
  SKILL_MANAGER_SKILL_TOGGLE_PATH,
  SKILL_MANAGER_STATE_PATH,
  type McpServerEntry,
  type McpTestResponse,
  type McpToolsResponse,
  type SkillManagerErrorResponse,
  type SkillManagerStateResponse,
} from '../host/contract.ts'

/** Renderer-facing skill manager API. */
export interface SkillManagerApi {
  state(): Promise<SkillManagerStateResponse>
  saveServer(server: McpServerEntry): Promise<McpServerEntry>
  removeServer(serverName: string): Promise<void>
  toggleServer(serverName: string, enabled: boolean): Promise<void>
  testServer(server: McpServerEntry): Promise<McpTestResponse>
  /**
   * List the tools one server publishes. A running server answers from its live
   * registration; `probe` forces a temporary connection instead, which is how a
   * caller asks about the entry in hand rather than the one already running.
   */
  listTools(server: McpServerEntry, probe?: boolean): Promise<McpToolsResponse>
  toggleSkill(name: string, scope: 'system' | 'user', enabled: boolean): Promise<void>
  saveSkill(name: string, content: string): Promise<void>
  deleteSkill(name: string): Promise<void>
  importSkills(sourceDir: string): Promise<readonly string[]>
  readSkill(name: string, scope: 'system' | 'user'): Promise<{ content: string, readOnly: boolean }>
  pickDirectory(): Promise<string | null>
}

async function postJson<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = (value as Partial<SkillManagerErrorResponse> | undefined)?.error
    throw new Error(typeof detail === 'string' && detail.length > 0 ? detail : `HTTP ${String(response.status)}`)
  }
  return value as T
}

async function pickDirectory(): Promise<string | null> {
  const response = await fetch(DIRECTORY_PICKER_PATH, {
    method: 'POST',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null || !('path' in value)) return null
  const path = (value as { path?: unknown }).path
  return typeof path === 'string' ? path : null
}

export function createSkillManagerApi(): SkillManagerApi {
  return {
    async state(): Promise<SkillManagerStateResponse> {
      const response = await fetch(SKILL_MANAGER_STATE_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      return await response.json() as SkillManagerStateResponse
    },
    saveServer: server => postJson<McpServerEntry>(SKILL_MANAGER_MCP_SAVE_PATH, { server }),
    removeServer: async serverName => { await postJson(SKILL_MANAGER_MCP_REMOVE_PATH, { serverName }) },
    toggleServer: async (serverName, enabled) => { await postJson(SKILL_MANAGER_MCP_TOGGLE_PATH, { serverName, enabled }) },
    testServer: server => postJson<McpTestResponse>(SKILL_MANAGER_MCP_TEST_PATH, { server }),
    listTools: (server, probe) => postJson<McpToolsResponse>(
      SKILL_MANAGER_MCP_TOOLS_PATH,
      probe === true ? { server, probe: true } : { server },
    ),
    toggleSkill: async (name, scope, enabled) => { await postJson(SKILL_MANAGER_SKILL_TOGGLE_PATH, { name, scope, enabled }) },
    saveSkill: async (name, content) => { await postJson(SKILL_MANAGER_SKILL_SAVE_PATH, { name, content }) },
    deleteSkill: async name => { await postJson(SKILL_MANAGER_SKILL_DELETE_PATH, { name }) },
    importSkills: async sourceDir => {
      const value = await postJson<{ imported?: unknown }>(SKILL_MANAGER_SKILL_IMPORT_PATH, { sourceDir })
      return Array.isArray(value.imported) ? value.imported.filter((item): item is string => typeof item === 'string') : []
    },
    readSkill: (name, scope) => {
      const query = `name=${encodeURIComponent(name)}&scope=${scope}`
      return fetch(`${SKILL_MANAGER_SKILL_READ_PATH}?${query}`, { headers: { accept: 'application/json' } })
        .then(async response => {
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          return await response.json() as { content: string, readOnly: boolean }
        })
    },
    pickDirectory,
  }
}
