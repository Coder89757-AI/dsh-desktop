/** Legal-KB Host bridge: license activation, settings persistence, and the
 * dynamic dsh-mcp-client mount that exposes the knowledge-base MCP tools. */

import type { Fiber } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session'
import {
  joinLegalKbEndpoint,
  LEGAL_KB_ACTIVATE_PATH,
  LEGAL_KB_DISCONNECT_PATH,
  LEGAL_KB_STATUS_PATH,
  type LegalKbActivationIdentity,
  type LegalKbStatusResponse,
} from './contract.ts'
import {
  captureFeedbackEvent,
  flushFeedbackQueue,
  retryDelayMs,
  type FeedbackRelayDeps,
  type FeedbackRelayItem,
} from './feedback.ts'
import {
  handleLegalKbActivateRequest,
  handleLegalKbDisconnectRequest,
  handleLegalKbStatusRequest,
  type LegalKbRouteDeps,
} from './route.ts'

/** Stable Cordis plugin name. */
export const name = 'legal-kb-bridge'

/** Services required before the bridge can register routes and settings. */
export const inject = ['webServer', 'settings', 'connection']

/** Settings namespace owned by the Legal-KB bridge. */
export const LEGAL_KB_SETTINGS_NAMESPACE = 'legal-kb'

/** Default lexford API base used for license activation. */
export const LEGAL_KB_DEFAULT_API_URL = 'http://127.0.0.1:8310'

/** Default lexford MCP HTTP endpoint bridged into the tool registry. */
export const LEGAL_KB_DEFAULT_MCP_URL = 'http://127.0.0.1:8300/mcp'

/** Stable MCP server namespace for the bridged tool names. */
export const LEGAL_KB_SERVER_NAME = 'legal-kb'

/** Persisted Legal-KB bridge configuration. */
export interface LegalKbSettings {
  /** Knowledge-base API base used for license activation. */
  apiUrl: string
  /** Knowledge-base MCP HTTP endpoint bridged into `ctx.tools`. */
  mcpUrl: string
  /** License code persisted after a successful activation. */
  licenseCode: string
  /** Whether message feedback is relayed to the knowledge-base service. */
  feedbackEnabled: boolean
}

/** Schema registered with the standard settings service. */
export const LegalKbSettingsSchema: z<LegalKbSettings> = z.object({
  apiUrl: z.string().default(LEGAL_KB_DEFAULT_API_URL),
  mcpUrl: z.string().default(LEGAL_KB_DEFAULT_MCP_URL),
  licenseCode: z.string().default('').role('secret'),
  feedbackEnabled: z.boolean().default(true),
})

interface ActivateServiceBody {
  license_id?: unknown
  name?: unknown
  org?: unknown
  role?: unknown
  credits?: unknown
  expires_at?: unknown
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function activationIdentity(body: ActivateServiceBody): LegalKbActivationIdentity {
  return {
    licenseId: optionalString(body.license_id),
    name: optionalString(body.name),
    org: optionalString(body.org),
    role: optionalString(body.role),
    credits: typeof body.credits === 'number' ? body.credits : null,
    expiresAt: typeof body.expires_at === 'number' ? body.expires_at : null,
  }
}

/**
 * Register the Legal-KB bridge: private same-origin activation routes, the
 * persisted settings namespace, and one `dsh-mcp-client` generation whose
 * Authorization header follows the persisted license code.
 * @param ctx - Host context carrying the web server, settings, and connection services.
 */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(
    LEGAL_KB_SETTINGS_NAMESPACE,
    LegalKbSettingsSchema,
    { applies: 'live' },
  )
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`

  let fiber: Fiber | undefined
  let identity: LegalKbActivationIdentity | null = null
  let lastError: string | null = null

  const statusView = (): LegalKbStatusResponse => {
    const value = settings.get()
    return {
      apiUrl: value.apiUrl,
      mcpUrl: value.mcpUrl,
      connected: value.licenseCode.trim() !== '',
      identity,
      lastError,
    }
  }

  /** Swap the MCP bridge generation after license or endpoint changes. */
  const remount = (): void => {
    fiber?.dispose()
    fiber = undefined
    const value = settings.get()
    const code = value.licenseCode.trim()
    const url = value.mcpUrl.trim()
    if (code === '' || url === '') return
    try {
      // eslint-disable-next-line no-new
      new URL(url)
    } catch {
      lastError = 'MCP endpoint URL is invalid'
      ctx.logger.error('legal-kb: MCP endpoint URL is invalid, bridge not mounted')
      return
    }
    fiber = ctx.plugin(mcpClient, {
      transport: 'streamable-http',
      serverName: LEGAL_KB_SERVER_NAME,
      url,
      headers: { Authorization: `Bearer ${code}` },
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  }

  const activate = async (
    code: string,
    endpoints?: { apiUrl?: string; mcpUrl?: string },
  ): Promise<LegalKbStatusResponse | { error: string }> => {
    if (endpoints?.apiUrl !== undefined) {
      try {
        // eslint-disable-next-line no-new
        new URL(endpoints.apiUrl)
      } catch {
        return { error: '知识库服务地址无效' }
      }
    }
    if (endpoints?.mcpUrl !== undefined) {
      try {
        // eslint-disable-next-line no-new
        new URL(endpoints.mcpUrl)
      } catch {
        return { error: '知识库 MCP 地址无效' }
      }
    }
    const changed: Partial<LegalKbSettings> = {}
    if (endpoints?.apiUrl !== undefined && settings.get().apiUrl !== endpoints.apiUrl) {
      changed.apiUrl = endpoints.apiUrl
    }
    if (endpoints?.mcpUrl !== undefined && settings.get().mcpUrl !== endpoints.mcpUrl) {
      changed.mcpUrl = endpoints.mcpUrl
    }
    if (Object.keys(changed).length > 0) {
      await settings.update(changed)
    }
    const value = settings.get()
    let endpoint: URL
    try {
      endpoint = joinLegalKbEndpoint(value.apiUrl.trim(), '/api/auth/activate')
    } catch {
      return { error: '知识库服务地址无效' }
    }
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause)
      return { error: '知识库服务无法访问，请检查服务地址' }
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => undefined)) as { detail?: unknown } | undefined
      const message = typeof detail?.detail === 'string'
        ? detail.detail
        : `激活失败 (HTTP ${String(response.status)})`
      lastError = message
      return { error: message }
    }
    const body = (await response.json().catch(() => ({}))) as ActivateServiceBody
    identity = activationIdentity(body)
    lastError = null
    if (settings.get().licenseCode.trim() !== code) {
      await settings.update({ licenseCode: code })
    }
    return statusView()
  }

  const disconnect = async (): Promise<void> => {
    identity = null
    lastError = null
    if (settings.get().licenseCode !== '') {
      await settings.update({ licenseCode: '' })
    }
  }

  const deps: LegalKbRouteDeps = {
    expectedOrigin: rendererOrigin,
    status: statusView,
    activate,
    disconnect,
  }
  const routes = [
    [LEGAL_KB_ACTIVATE_PATH, handleLegalKbActivateRequest],
    [LEGAL_KB_STATUS_PATH, handleLegalKbStatusRequest],
    [LEGAL_KB_DISCONNECT_PATH, handleLegalKbDisconnectRequest],
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
      `legal-kb: private route ${path}`,
    )
  }

  ctx.effect(() => {
    remount()
    const stopWatching = settings.watch(() => { remount() })
    return () => {
      stopWatching()
      fiber?.dispose()
      fiber = undefined
    }
  }, 'legal-kb: MCP bridge generation')

  ctx.effect(() => {
    const queue: FeedbackRelayItem[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let flushing = false
    const relayDeps: FeedbackRelayDeps = {
      enabled: () => settings.get().feedbackEnabled && settings.get().licenseCode.trim() !== '',
      licenseCode: () => settings.get().licenseCode.trim(),
      apiUrl: () => settings.get().apiUrl,
    }
    const schedule = (): void => {
      if (timer !== undefined || flushing) return
      timer = setTimeout(() => {
        timer = undefined
        void flush()
      }, failures === 0 ? 3_000 : retryDelayMs(failures))
    }
    const flush = async (): Promise<void> => {
      if (flushing || queue.length === 0) return
      flushing = true
      try {
        const remaining = await flushFeedbackQueue(queue, relayDeps)
        queue.splice(0, queue.length, ...remaining)
        failures = 0
      } catch (cause) {
        failures += 1
        ctx.logger.warn(
          `legal-kb: feedback relay attempt ${String(failures)} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
        schedule()
      } finally {
        flushing = false
      }
    }
    const stopListening = ctx.on('session/event', (session, event) => {
      const captured = captureFeedbackEvent(session, event, relayDeps, queue)
      if (captured !== undefined) schedule()
    })
    return () => {
      stopListening()
      if (timer !== undefined) clearTimeout(timer)
      queue.length = 0
    }
  }, 'legal-kb: feedback relay')
}
