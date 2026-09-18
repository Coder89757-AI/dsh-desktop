/** Strict same-origin HTTP handlers for the skill-manager management API. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  SkillManagerErrorResponse,
  SkillManagerStateResponse,
} from './contract.ts'
import { finishJson, isSameOriginLoopbackRequest, readJsonPost } from './http.ts'
import { McpStore, McpStoreError } from './mcp-store.ts'
import { SkillsStore, SkillsStoreError } from './skills-store.ts'

/** Skill bodies can be large; ordinary mutation bodies stay small. */
const MAX_SKILL_BODY_BYTES = 512 * 1024

export type SkillManagerRouteDeps = {
  readonly expectedOrigin: string
  readonly mcpStore: McpStore
  readonly skillsStore: SkillsStore
}

function error(message: string): SkillManagerErrorResponse {
  return { error: message }
}

function guard(req: IncomingMessage, res: ServerResponse, deps: SkillManagerRouteDeps, mutating: boolean): boolean {
  if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, mutating)) {
    finishJson(res, 403, error('same-origin request required'))
    return false
  }
  return true
}

function fail(res: ServerResponse, cause: unknown, conflict: boolean): void {
  const message = cause instanceof Error ? cause.message : String(cause)
  const known = cause instanceof McpStoreError || cause instanceof SkillsStoreError
  finishJson(res, known ? (conflict ? 409 : 400) : 500, error(message))
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

function scopeField(body: Record<string, unknown>): 'system' | 'user' | undefined {
  const value = body.scope
  return value === 'system' || value === 'user' ? value : undefined
}

/** Handle `GET /_dsh/skill-manager/state`. */
export function handleStateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillManagerRouteDeps,
): void {
  if (req.method !== 'GET') {
    finishJson(res, 405, error('GET only'), 'GET')
    return
  }
  if (!guard(req, res, deps, false)) return
  try {
    const body: SkillManagerStateResponse = {
      mcpServers: deps.mcpStore.list(),
      skills: deps.skillsStore.list(),
    }
    finishJson(res, 200, body)
  } catch (cause) {
    fail(res, cause, false)
  }
}

/** Handle `GET /_dsh/skill-manager/skills/read?name=...&scope=...`. */
export function handleSkillReadRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillManagerRouteDeps,
): void {
  if (req.method !== 'GET') {
    finishJson(res, 405, error('GET only'), 'GET')
    return
  }
  if (!guard(req, res, deps, false)) return
  const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
  const name = params.get('name')
  const scope = params.get('scope')
  if (name === null || (scope !== 'system' && scope !== 'user')) {
    finishJson(res, 400, error('name and scope (system|user) query parameters are required'))
    return
  }
  try {
    finishJson(res, 200, deps.skillsStore.read(name, scope))
  } catch (cause) {
    fail(res, cause, false)
  }
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse, deps: SkillManagerRouteDeps) => void

/** Handle `POST /_dsh/skill-manager/mcp/save`. */
export const handleMcpSaveRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    if (!('server' in body)) {
      finishJson(res, 400, error('server is required'))
      return
    }
    try {
      finishJson(res, 200, { server: await deps.mcpStore.save(body.server) })
    } catch (cause) {
      fail(res, cause, false)
    }
  })().catch(() => { /* Response already finished. */ })
}

export const handleMcpRemoveRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    const serverName = stringField(body, 'serverName')
    if (serverName === undefined) {
      finishJson(res, 400, error('serverName is required'))
      return
    }
    try {
      await deps.mcpStore.remove(serverName)
      finishJson(res, 200, { removed: serverName })
    } catch (cause) {
      fail(res, cause, true)
    }
  })().catch(() => { /* Response already finished. */ })
}

export const handleMcpToggleRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    const serverName = stringField(body, 'serverName')
    if (serverName === undefined || typeof body.enabled !== 'boolean') {
      finishJson(res, 400, error('serverName and enabled are required'))
      return
    }
    try {
      await deps.mcpStore.toggle(serverName, body.enabled)
      finishJson(res, 200, { toggled: serverName })
    } catch (cause) {
      fail(res, cause, true)
    }
  })().catch(() => { /* Response already finished. */ })
}

/** Handle `POST /_dsh/skill-manager/mcp/test` (long-running probe). */
export const handleMcpTestRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res, 256 * 1024).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    if (!('server' in body)) {
      finishJson(res, 400, error('server is required'))
      return
    }
    finishJson(res, 200, await deps.mcpStore.test(body.server))
  })().catch(() => { /* Response already finished. */ })
}

/** Handle `POST /_dsh/skill-manager/mcp/tools` (long-running probe). */
export const handleMcpToolsRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res, 256 * 1024).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    if (!('server' in body)) {
      finishJson(res, 400, error('server is required'))
      return
    }
    finishJson(res, 200, await deps.mcpStore.listTools(body.server, body.probe === true))
  })().catch(() => { /* Response already finished. */ })
}

export const handleSkillToggleRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    const name = stringField(body, 'name')
    const scope = scopeField(body)
    if (name === undefined || scope === undefined || typeof body.enabled !== 'boolean') {
      finishJson(res, 400, error('name, scope, and enabled are required'))
      return
    }
    try {
      await deps.skillsStore.toggle(name, scope, body.enabled)
      finishJson(res, 200, { toggled: name })
    } catch (cause) {
      fail(res, cause, true)
    }
  })().catch(() => { /* Response already finished. */ })
}

export const handleSkillSaveRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res, MAX_SKILL_BODY_BYTES)
      .then(value => value as Record<string, unknown>)
      .catch(() => undefined)
    if (body === undefined) return
    const name = stringField(body, 'name')
    const content = stringField(body, 'content')
    if (name === undefined || content === undefined) {
      finishJson(res, 400, error('name and content are required'))
      return
    }
    try {
      await deps.skillsStore.save(name, content)
      finishJson(res, 200, { saved: name })
    } catch (cause) {
      fail(res, cause, false)
    }
  })().catch(() => { /* Response already finished. */ })
}

export const handleSkillDeleteRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    const name = stringField(body, 'name')
    if (name === undefined) {
      finishJson(res, 400, error('name is required'))
      return
    }
    try {
      await deps.skillsStore.remove(name)
      finishJson(res, 200, { deleted: name })
    } catch (cause) {
      fail(res, cause, true)
    }
  })().catch(() => { /* Response already finished. */ })
}

export const handleSkillImportRequest: RouteHandler = (req, res, deps) => {
  void (async () => {
    if (req.method !== 'POST' || !guard(req, res, deps, true)) {
      if (res.writableEnded) return
      if (req.method !== 'POST') finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    const body = await readJsonPost(req, res).then(value => value as Record<string, unknown>).catch(() => undefined)
    if (body === undefined) return
    const sourceDir = stringField(body, 'sourceDir')
    if (sourceDir === undefined) {
      finishJson(res, 400, error('sourceDir is required'))
      return
    }
    try {
      finishJson(res, 200, { imported: await deps.skillsStore.importFrom(sourceDir) })
    } catch (cause) {
      fail(res, cause, true)
    }
  })().catch(() => { /* Response already finished. */ })
}
