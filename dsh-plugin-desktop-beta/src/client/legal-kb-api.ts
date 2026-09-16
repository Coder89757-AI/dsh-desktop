/** Same-origin browser client for the launcher-owned Legal-KB bridge. */

import type {
  LegalKbStatusResponse,
} from '../legal-kb/contract.ts'

const ACTIVATE_PATH = '/api/desktop/legal-kb/activate'
const STATUS_PATH = '/api/desktop/legal-kb/status'
const DISCONNECT_PATH = '/api/desktop/legal-kb/disconnect'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Browser operations consumed by the Legal-KB sidebar panel. */
export interface LegalKbApi {
  status(): Promise<LegalKbStatusResponse>
  activate(code: string): Promise<LegalKbStatusResponse>
  disconnect(): Promise<void>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseIdentity(value: unknown): LegalKbStatusResponse['identity'] {
  if (value === null) return null
  if (!isObject(value)
    || typeof value.licenseId !== 'string'
    || typeof value.name !== 'string'
    || typeof value.org !== 'string'
    || typeof value.role !== 'string'
    || (value.credits !== null && typeof value.credits !== 'number')
    || (value.expiresAt !== null && typeof value.expiresAt !== 'number')) {
    throw new Error('dsh-plugin-desktop: invalid Legal-KB identity response')
  }
  return {
    licenseId: value.licenseId,
    name: value.name,
    org: value.org,
    role: value.role,
    credits: value.credits as number | null,
    expiresAt: value.expiresAt as number | null,
  }
}

/** Validate the bounded status projection before it reaches React state. */
export function parseLegalKbStatus(value: unknown): LegalKbStatusResponse {
  if (!isObject(value)
    || typeof value.apiUrl !== 'string'
    || typeof value.mcpUrl !== 'string'
    || typeof value.connected !== 'boolean'
    || (value.lastError !== null && typeof value.lastError !== 'string')) {
    throw new Error('dsh-plugin-desktop: invalid Legal-KB status response')
  }
  return {
    apiUrl: value.apiUrl,
    mcpUrl: value.mcpUrl,
    connected: value.connected,
    identity: parseIdentity(value.identity),
    lastError: value.lastError as string | null,
  }
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('dsh-plugin-desktop: Legal-KB response was not JSON')
  }
}

/** Construct the default same-origin API, with a fetch seam for focused tests. */
export function createLegalKbApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): LegalKbApi {
  return Object.freeze({
    async status() {
      const response = await fetcher(STATUS_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseLegalKbStatus(await readResponse(response))
    },
    async activate(code: string) {
      const response = await fetcher(ACTIVATE_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })
      const value = await readResponse(response)
      if (!response.ok) {
        const message = isObject(value) && typeof value.error === 'string' ? value.error : undefined
        throw new Error(message ?? `dsh-plugin-desktop: Legal-KB activation failed (${String(response.status)})`)
      }
      return parseLegalKbStatus(value)
    },
    async disconnect() {
      const response = await fetcher(DISCONNECT_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        throw new Error(`dsh-plugin-desktop: Legal-KB disconnect failed (${String(response.status)})`)
      }
    },
  })
}
