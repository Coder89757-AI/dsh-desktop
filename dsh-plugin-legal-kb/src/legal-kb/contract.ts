/** Private same-origin Legal-KB API shared with the bundled renderer. */

/** Validate one license code against the configured knowledge-base service. */
export const LEGAL_KB_ACTIVATE_PATH = '/api/desktop/legal-kb/activate'

/** Read the current Legal-KB bridge state. */
export const LEGAL_KB_STATUS_PATH = '/api/desktop/legal-kb/status'

/** Remove the persisted license code and unload the bridged tools. */
export const LEGAL_KB_DISCONNECT_PATH = '/api/desktop/legal-kb/disconnect'

/** Body accepted by the activate endpoint. */
export interface LegalKbActivateRequest {
  readonly code: string
  /** Optional service endpoints edited in the panel; persisted before activation. */
  readonly apiUrl?: string
  readonly mcpUrl?: string
}

/** Identity returned by a successful license activation. */
export interface LegalKbActivationIdentity {
  readonly licenseId: string
  readonly name: string
  readonly org: string
  readonly role: string
  readonly credits: number | null
  readonly expiresAt: number | null
}

/** Successful activation response. */
export interface LegalKbActivateResponse {
  readonly accepted: true
  readonly identity: LegalKbActivationIdentity
}

/** Renderer-safe Legal-KB bridge state. */
export interface LegalKbStatusResponse {
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly connected: boolean
  readonly identity: LegalKbActivationIdentity | null
  readonly lastError: string | null
}

/** Exact empty body accepted by the disconnect endpoint. */
export type LegalKbDisconnectRequest = Readonly<Record<string, never>>

/** Successful disconnect handoff. */
export interface LegalKbDisconnectResponse {
  readonly accepted: true
}

/** Stable API failure shape that never contains raw causes. */
export interface LegalKbErrorResponse {
  readonly error: string
}

/**
 * Join one API path onto the configured service base while preserving the
 * base's own path prefix (e.g. `http://host:10000/lexford/`), which the
 * standard `new URL(path, base)` would discard for rooted paths.
 */
export function joinLegalKbEndpoint(base: string, apiPath: string): URL {
  const url = new URL(base)
  const basePath = url.pathname.replace(/\/+$/u, '')
  url.pathname = `${basePath}/${apiPath.replace(/^\/+|\/+$/u, '')}`
  return url
}
