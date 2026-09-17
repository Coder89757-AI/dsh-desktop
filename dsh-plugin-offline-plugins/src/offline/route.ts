/** Strict same-origin HTTP handlers for the offline-plugins management API. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  OfflinePluginsErrorResponse,
  OfflinePluginsExportResponse,
  OfflinePluginsImportResponse,
  OfflinePluginsListResponse,
} from './contract.ts'
import { finishJson, isSameOriginLoopbackRequest, readJsonPost } from './http.ts'

export type OfflinePluginsRouteDeps = {
  readonly expectedOrigin: string
  readonly list: () => OfflinePluginsListResponse
  readonly exportPlugin: (packageName: unknown, destinationDir: unknown) => OfflinePluginsExportResponse
  readonly importFrom: (sourceDir: unknown) => Promise<OfflinePluginsImportResponse>
}

function error(message: string): OfflinePluginsErrorResponse {
  return { error: message }
}

/** Handle `GET /_dsh/offline-plugins/list`. */
export function handleListRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: OfflinePluginsRouteDeps,
): void {
  if (req.method !== 'GET') {
    finishJson(res, 405, error('GET only'), 'GET')
    return
  }
  if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, false)) {
    finishJson(res, 403, error('same-origin request required'))
    return
  }
  try {
    finishJson(res, 200, deps.list())
  } catch (cause) {
    finishJson(res, 500, error(cause instanceof Error ? cause.message : String(cause)))
  }
}

/** Handle `POST /_dsh/offline-plugins/export`. */
export function handleExportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: OfflinePluginsRouteDeps,
): void {
  void (async () => {
    if (req.method !== 'POST') {
      finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) {
      finishJson(res, 403, error('same-origin request required'))
      return
    }
    let body: { packageName?: unknown, destinationDir?: unknown }
    try {
      body = await readJsonPost(req, res) as { packageName?: unknown, destinationDir?: unknown }
    } catch {
      return
    }
    try {
      finishJson(res, 200, deps.exportPlugin(body.packageName, body.destinationDir))
    } catch (cause) {
      finishJson(res, 400, error(cause instanceof Error ? cause.message : String(cause)))
    }
  })().catch(() => { /* Response already finished. */ })
}

/** Handle `POST /_dsh/offline-plugins/import`. */
export function handleImportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: OfflinePluginsRouteDeps,
): void {
  void (async () => {
    if (req.method !== 'POST') {
      finishJson(res, 405, error('POST only'), 'POST')
      return
    }
    if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) {
      finishJson(res, 403, error('same-origin request required'))
      return
    }
    let body: { sourceDir?: unknown }
    try {
      body = await readJsonPost(req, res) as { sourceDir?: unknown }
    } catch {
      return
    }
    try {
      finishJson(res, 200, await deps.importFrom(body.sourceDir))
    } catch (cause) {
      finishJson(res, 400, error(cause instanceof Error ? cause.message : String(cause)))
    }
  })().catch(() => { /* Response already finished. */ })
}
