/** Strict same-origin HTTP handlers for the private Legal-KB bridge API. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  LegalKbActivateRequest,
  LegalKbErrorResponse,
  LegalKbStatusResponse,
} from './contract.ts'

const MAX_BODY_BYTES = 16 * 1024

class BodyTooLargeError extends Error {}

class InvalidBodyError extends Error {}

function finishJson(
  res: ServerResponse,
  statusCode: number,
  value: object,
  allow?: 'GET' | 'POST',
): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

function error(message: string): LegalKbErrorResponse {
  return { error: message }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1' || address === '127.0.0.1') return true
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length)
    return mapped.startsWith('127.')
  }
  return address.startsWith('127.')
}

function expectedLoopbackOrigin(expectedOrigin: string): URL | undefined {
  try {
    const url = new URL(expectedOrigin)
    if (url.origin !== expectedOrigin || url.protocol !== 'http:'
      || url.username !== '' || url.password !== ''
      || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')) return undefined
    return url
  } catch {
    return undefined
  }
}

function exactHeaderOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.origin === value ? value : undefined
  } catch {
    return undefined
  }
}

function referrerOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/**
 * Same guard as the Desktop settings routes: the actual socket and Host stay
 * on the configured loopback origin. A mutating request must carry the exact
 * Origin header; a read-only GET may fall back to same-site fetch metadata
 * plus its same-origin referrer, because browsers commonly omit Origin on
 * same-origin GET requests.
 */
function isSameOriginLoopbackRequest(
  req: IncomingMessage,
  expectedOrigin: string,
  mutating: boolean,
): boolean {
  const expected = expectedLoopbackOrigin(expectedOrigin)
  if (expected === undefined || !isLoopbackAddress(req.socket.remoteAddress)) return false
  if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (exactHeaderOrigin(req.headers.origin) === expected.origin) {
    return req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin'
  }
  if (mutating) return false
  return req.headers['sec-fetch-site'] === 'same-origin'
    && referrerOrigin(req.headers.referer) === expected.origin
}

async function readJsonPost(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    finishJson(res, 415, error('expected application/json'))
    throw new InvalidBodyError()
  }
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined && !/^\d+$/.test(declaredLength)) {
    finishJson(res, 400, error('invalid content length'))
    throw new InvalidBodyError()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      finishJson(res, 413, error('request body too large'))
      throw new BodyTooLargeError()
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    finishJson(res, 400, error('invalid JSON body'))
    throw new InvalidBodyError()
  }
}

function optionalEndpoint(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, 2048)
}

function parseActivateRequest(value: unknown): LegalKbActivateRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const code = (value as { code?: unknown }).code
  if (typeof code !== 'string' || code.trim().length === 0 || code.length > 128) return undefined
  const parsed: { code: string; apiUrl?: string; mcpUrl?: string } = { code: code.trim() }
  const apiUrl = optionalEndpoint((value as { apiUrl?: unknown }).apiUrl)
  if (apiUrl !== undefined) parsed.apiUrl = apiUrl
  const mcpUrl = optionalEndpoint((value as { mcpUrl?: unknown }).mcpUrl)
  if (mcpUrl !== undefined) parsed.mcpUrl = mcpUrl
  return parsed
}

export interface LegalKbRouteDeps {
  readonly expectedOrigin: string
  readonly status: () => LegalKbStatusResponse
  readonly activate: (
    code: string,
    endpoints: { apiUrl?: string; mcpUrl?: string },
  ) => Promise<LegalKbStatusResponse | { error: string }>
  readonly disconnect: () => Promise<void>
}

/** Validate a license code and persist it when the service accepts it. */
export async function handleLegalKbActivateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LegalKbRouteDeps,
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  let value: unknown
  try {
    value = await readJsonPost(req, res)
  } catch {
    return
  }
  const request = parseActivateRequest(value)
  if (request === undefined) return finishJson(res, 400, error('invalid activation request'))
  try {
    const endpoints: { apiUrl?: string; mcpUrl?: string } = {}
    if (request.apiUrl !== undefined) endpoints.apiUrl = request.apiUrl
    if (request.mcpUrl !== undefined) endpoints.mcpUrl = request.mcpUrl
    const outcome = await deps.activate(request.code, endpoints)
    if ('error' in outcome) return finishJson(res, 403, error(outcome.error))
    return finishJson(res, 200, outcome)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return finishJson(res, 502, error(`knowledge-base service unreachable: ${message.slice(0, 200)}`))
  }
}

/** Read the current bridge state for the renderer. */
export async function handleLegalKbStatusRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LegalKbRouteDeps,
): Promise<void> {
  if (req.method !== 'GET') return finishJson(res, 405, error('method not allowed'), 'GET')
  if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, false)) {
    return finishJson(res, 403, error('forbidden'))
  }
  return finishJson(res, 200, deps.status())
}

/** Remove the persisted license code and unload the bridged tools. */
export async function handleLegalKbDisconnectRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LegalKbRouteDeps,
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  try {
    await deps.disconnect()
  } catch {
    return finishJson(res, 409, error('disconnect failed'))
  }
  return finishJson(res, 200, { accepted: true })
}
