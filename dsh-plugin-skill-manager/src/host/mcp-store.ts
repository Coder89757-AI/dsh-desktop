/** MCP server configuration store and runtime loader.
 *
 * Server entries live in a manager-owned JSON file inside the desktop
 * profile (the profile's cordis.yml is rewritten by the launcher on every
 * boot, so it cannot carry user MCP entries). Enabled entries are loaded at
 * runtime as `@deepseek-ai/dsh-mcp-client` plugin instances through
 * `ctx.plugin()`, which makes add/remove/toggle take effect immediately —
 * no restart required. */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-tools'
import type {
  McpServerEntry,
  McpTestResponse,
  McpToolInfo,
  McpToolsResponse,
} from './contract.ts'

const STORE_VERSION = 1
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export class McpStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpStoreError'
  }
}

interface StoreDocument {
  readonly version: number
  readonly servers: McpServerEntry[]
}

/** Runtime handle for one loaded mcp-client instance. */
type PluginFiber = { readonly dispose: () => Promise<void> }

export function validateServerEntry(entry: unknown): McpServerEntry {
  if (entry === null || typeof entry !== 'object') throw new McpStoreError('server entry must be an object')
  const value = entry as Record<string, unknown>
  const serverName = value.serverName
  if (typeof serverName !== 'string' || !SERVER_NAME_PATTERN.test(serverName)) {
    throw new McpStoreError('serverName must match [A-Za-z0-9_-]{1,32}')
  }
  const enabled = value.enabled === true
  const stringRecord = (input: unknown, label: string): Record<string, string> => {
    if (input === undefined) return {}
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new McpStoreError(`${label} must be an object of strings`)
    }
    const result: Record<string, string> = {}
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (typeof item !== 'string') throw new McpStoreError(`${label} values must be strings`)
      result[key] = item
    }
    return result
  }
  if (value.transport === 'stdio') {
    const command = value.command
    if (typeof command !== 'string' || command.length === 0) throw new McpStoreError('stdio transport requires a command')
    const args = value.args
    if (args !== undefined && (!Array.isArray(args) || !args.every(arg => typeof arg === 'string'))) {
      throw new McpStoreError('args must be an array of strings')
    }
    const cwd = value.cwd
    if (cwd !== undefined && typeof cwd !== 'string') throw new McpStoreError('cwd must be a string')
    return {
      serverName,
      transport: 'stdio',
      enabled,
      command,
      ...(args !== undefined ? { args: args as string[] } : {}),
      env: stringRecord(value.env, 'env'),
      ...(cwd !== undefined && cwd.length > 0 ? { cwd } : {}),
    }
  }
  if (value.transport === 'streamable-http') {
    const url = value.url
    if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) {
      throw new McpStoreError('streamable-http transport requires an http(s) url')
    }
    return { serverName, transport: 'streamable-http', enabled, url, headers: stringRecord(value.headers, 'headers') }
  }
  throw new McpStoreError('transport must be "stdio" or "streamable-http"')
}

/**
 * Read one server's tools off the shared registry.
 *
 * Public names are derived as `mcp__<serverName>__<rawName>`, so the namespace
 * prefix is stripped back off for display. A name that lossy normalization
 * rewrote keeps its hash suffix: the raw name is not recoverable from the
 * public one, and inventing one would be worse than showing the hash.
 */
function collectServerTools(ctx: Context, serverName: string): McpToolInfo[] {
  const tools = ctx.get('tools')
  if (tools === undefined) return []
  const prefix = `mcp__${serverName}__`
  return tools.schemas()
    .filter(schema => schema.name.startsWith(prefix))
    .map(schema => ({ name: schema.name.slice(prefix.length), description: schema.description }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function toClientConfig(entry: McpServerEntry): mcpClient.Config {
  if (entry.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: entry.serverName,
      command: entry.command ?? '',
      args: [...(entry.args ?? [])],
      env: { ...(entry.env ?? {}) },
      cwd: entry.cwd ?? '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
  }
  return {
    transport: 'streamable-http',
    serverName: entry.serverName,
    url: entry.url ?? '',
    headers: { ...(entry.headers ?? {}) },
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

/** Persistent MCP server list plus live mcp-client instances. */
export class McpStore {
  private readonly path: string
  private readonly fibers = new Map<string, PluginFiber>()
  private servers: McpServerEntry[] = []

  constructor(
    private readonly ctx: Context,
    profileDir: string,
  ) {
    this.path = join(profileDir, 'mcp-servers.json')
  }

  async initialize(): Promise<void> {
    this.servers = this.read()
    for (const entry of this.servers) {
      if (entry.enabled) await this.startOne(entry)
    }
  }

  async dispose(): Promise<void> {
    for (const fiber of this.fibers.values()) {
      await fiber.dispose().catch(() => { /* Shutdown races are logged by cordis. */ })
    }
    this.fibers.clear()
  }

  list(): readonly McpServerEntry[] {
    return this.servers.map(entry => ({ ...entry }))
  }

  async save(entryInput: unknown): Promise<McpServerEntry> {
    const entry = validateServerEntry(entryInput)
    if (this.servers.some(existing => existing.serverName === entry.serverName && existing.transport !== entry.transport)) {
      await this.stopOne(entry.serverName)
    }
    const next = this.servers.filter(existing => existing.serverName !== entry.serverName)
    next.push(entry)
    await this.persist(next)
    await this.stopOne(entry.serverName)
    if (entry.enabled) await this.startOne(entry)
    return { ...entry }
  }

  async remove(serverName: string): Promise<void> {
    const next = this.servers.filter(existing => existing.serverName !== serverName)
    if (next.length === this.servers.length) throw new McpStoreError(`${serverName} is not configured`)
    await this.persist(next)
    await this.stopOne(serverName)
  }

  async toggle(serverName: string, enabled: boolean): Promise<void> {
    const entry = this.servers.find(existing => existing.serverName === serverName)
    if (entry === undefined) throw new McpStoreError(`${serverName} is not configured`)
    const next = this.servers.map(existing =>
      existing.serverName === serverName ? { ...existing, enabled } : existing)
    await this.persist(next)
    await this.stopOne(serverName)
    if (enabled) await this.startOne(entry)
  }

  /** Probe one entry with a real MCP handshake: a temporary mcp-client
   * instance configured with `failOnStartupError: true`, awaited with a
   * timeout, then disposed. The probe uses a derived serverName so it never
   * collides with a live instance of the same server. */
  async test(entryInput: unknown, timeoutMs = 20_000): Promise<McpTestResponse> {
    try {
      const entry = validateServerEntry(entryInput)
      const outcome = await this.withProbe(entry, timeoutMs, () => undefined)
      return outcome.ok
        ? { ok: true, detail: 'connected: MCP handshake and tool synchronization succeeded' }
        : { ok: false, detail: outcome.detail }
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  /**
   * List the tools one entry publishes.
   *
   * A server that is already running answers from the shared registry — those
   * are the tools the model can call right now — while anything else (saved but
   * disabled, or still being edited) gets a temporary probe. `forceProbe` skips
   * the running instance so a caller can ask what the entry in hand would
   * publish, rather than what the live one currently does.
   */
  async listTools(entryInput: unknown, forceProbe = false, timeoutMs = 20_000): Promise<McpToolsResponse> {
    try {
      const entry = validateServerEntry(entryInput)
      if (!forceProbe) {
        const running = this.runningTools(entry.serverName)
        if (running !== undefined) {
          return { ok: true, detail: 'read from the running server', source: 'running', tools: running }
        }
      }
      const outcome = await this.withProbe(entry, timeoutMs, probeName => collectServerTools(this.ctx, probeName))
      return outcome.ok
        ? { ok: true, detail: 'read from a temporary probe', source: 'probe', tools: outcome.value }
        : { ok: false, detail: outcome.detail, tools: [] }
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause), tools: [] }
    }
  }

  /**
   * Load one temporary mcp-client instance for `entry`, run `read` against it
   * while it is live, then tear it down.
   *
   * A timed-out probe may never settle, so its disposal is scheduled without
   * blocking the response on the fiber promise.
   */
  private async withProbe<T>(
    entry: McpServerEntry,
    timeoutMs: number,
    read: (probeName: string) => T,
  ): Promise<{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly detail: string }> {
    let fiber: PluginFiber | undefined
    const probeName = `${entry.serverName.slice(0, 24)}_t${Math.random().toString(36).slice(2, 6)}`
    try {
      const probe = {
        ...toClientConfig(entry),
        serverName: probeName,
        failOnStartupError: true,
      } as mcpClient.Config
      const loaded = Promise.resolve(this.ctx.plugin(mcpClient, probe))
      const winner = await Promise.race([
        loaded.then(() => 'loaded' as const),
        new Promise<'timeout'>(resolve => { setTimeout(() => { resolve('timeout') }, timeoutMs) }),
      ])
      if (winner === 'timeout') {
        fiber = {
          dispose: async () => {
            void loaded.then(
              instance => { void Promise.resolve(instance).then(f => f.dispose()).catch(() => {}) },
              () => { /* Startup failed after the timeout; nothing to dispose. */ },
            )
          },
        }
        return { ok: false, detail: `connection did not complete within ${String(Math.round(timeoutMs / 1000))}s` }
      }
      fiber = { dispose: async () => { await (await loaded).dispose() } }
      return { ok: true, value: read(probeName) }
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      await fiber?.dispose().catch(() => { /* The probe may already be down. */ })
    }
  }

  /** Tools a running instance publishes, or `undefined` when none is live. */
  private runningTools(serverName: string): McpToolInfo[] | undefined {
    if (!this.fibers.has(serverName)) return undefined
    return collectServerTools(this.ctx, serverName)
  }

  private read(): McpServerEntry[] {
    if (!existsSync(this.path)) return []
    let document: unknown
    try {
      document = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
    } catch {
      this.ctx.logger.warn('skill-manager: mcp-servers.json is unreadable; starting with no servers')
      return []
    }
    const servers = (document as Partial<StoreDocument> | null)?.servers
    if (!Array.isArray(servers)) return []
    const result: McpServerEntry[] = []
    for (const entry of servers) {
      try {
        result.push(validateServerEntry(entry))
      } catch (cause) {
        this.ctx.logger.warn(`skill-manager: dropping invalid MCP entry: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    return result
  }

  private async persist(next: McpServerEntry[]): Promise<void> {
    const document: StoreDocument = { version: STORE_VERSION, servers: next.map(entry => ({ ...entry })) }
    await writeFileAtomic(this.path, `${JSON.stringify(document, undefined, 2)}\n`, { mode: 0o600 })
    this.servers = next
  }

  private async startOne(entry: McpServerEntry): Promise<void> {
    if (this.fibers.has(entry.serverName)) return
    try {
      const fiber = this.ctx.plugin(mcpClient, toClientConfig(entry))
      await Promise.resolve(fiber)
      this.fibers.set(entry.serverName, fiber)
    } catch (cause) {
      this.ctx.logger.warn(
        `skill-manager: MCP server ${entry.serverName} failed to start: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }

  private async stopOne(serverName: string): Promise<void> {
    const fiber = this.fibers.get(serverName)
    if (fiber === undefined) return
    this.fibers.delete(serverName)
    await fiber.dispose().catch(() => { /* The instance may already be down. */ })
  }
}
