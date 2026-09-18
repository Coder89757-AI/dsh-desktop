/** Skill-manager Host bridge: MCP server configuration plus skill inventory
 * and lifecycle, exposed over private same-origin routes. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { McpStore } from './mcp-store.ts'
import { SkillsStore } from './skills-store.ts'
import {
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
} from './contract.ts'
import {
  handleMcpRemoveRequest,
  handleMcpSaveRequest,
  handleMcpTestRequest,
  handleMcpToggleRequest,
  handleMcpToolsRequest,
  handleSkillDeleteRequest,
  handleSkillImportRequest,
  handleSkillReadRequest,
  handleSkillSaveRequest,
  handleSkillToggleRequest,
  handleStateRequest,
  type SkillManagerRouteDeps,
} from './route.ts'

/** Stable Cordis plugin name. */
export const name = 'skill-manager-bridge'

/** Services resolved before routes register. */
export const inject = ['webServer', 'connection', 'desktopPnpmBootstrap']

/** Narrow structural face of the Desktop-owned bootstrap service. */
interface DesktopServices {
  readonly desktopPnpmBootstrap: {
    readonly activeProfileDir: string
  }
}

/** Register the bridge: management routes over the shared web server. */
export function apply(ctx: Context): void {
  const desktop = ctx as unknown as Context & DesktopServices
  const profileDir = desktop.desktopPnpmBootstrap.activeProfileDir
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`

  const mcpStore = new McpStore(ctx, profileDir)
  const skillsStore = new SkillsStore()
  const deps: SkillManagerRouteDeps = { expectedOrigin: rendererOrigin, mcpStore, skillsStore }

  const routes = [
    [SKILL_MANAGER_STATE_PATH, handleStateRequest],
    [SKILL_MANAGER_MCP_SAVE_PATH, handleMcpSaveRequest],
    [SKILL_MANAGER_MCP_REMOVE_PATH, handleMcpRemoveRequest],
    [SKILL_MANAGER_MCP_TOGGLE_PATH, handleMcpToggleRequest],
    [SKILL_MANAGER_MCP_TEST_PATH, handleMcpTestRequest],
    [SKILL_MANAGER_MCP_TOOLS_PATH, handleMcpToolsRequest],
    [SKILL_MANAGER_SKILL_TOGGLE_PATH, handleSkillToggleRequest],
    [SKILL_MANAGER_SKILL_SAVE_PATH, handleSkillSaveRequest],
    [SKILL_MANAGER_SKILL_DELETE_PATH, handleSkillDeleteRequest],
    [SKILL_MANAGER_SKILL_IMPORT_PATH, handleSkillImportRequest],
    [SKILL_MANAGER_SKILL_READ_PATH, handleSkillReadRequest],
  ] as const
  for (const [path, handler] of routes) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          return handler(req, res, deps)
        },
      }),
      `skill-manager: private route ${path}`,
    )
  }
  ctx.effect(function* () {
    yield async () => { await mcpStore.dispose() }
  }, 'skill-manager: mcp runtime disposal')
  void mcpStore.initialize()
}
