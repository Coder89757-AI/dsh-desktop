/** Fetch wrapper for the offline-plugins host routes. */

import {
  DIRECTORY_PICKER_PATH,
  OFFLINE_PLUGINS_EXPORT_PATH,
  OFFLINE_PLUGINS_IMPORT_PATH,
  OFFLINE_PLUGINS_LIST_PATH,
  type OfflinePluginsErrorResponse,
  type OfflinePluginsExportResponse,
  type OfflinePluginsImportResponse,
  type OfflinePluginsListResponse,
} from '../offline/contract.ts'

/** Renderer-facing offline plugin manager API. */
export interface OfflinePluginsApi {
  list(): Promise<OfflinePluginsListResponse>
  exportPlugin(packageName: string, destinationDir: string): Promise<OfflinePluginsExportResponse>
  importFrom(sourceDir: string): Promise<OfflinePluginsImportResponse>
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
    const detail = (value as Partial<OfflinePluginsErrorResponse> | undefined)?.error
    throw new Error(typeof detail === 'string' && detail.length > 0 ? detail : `HTTP ${String(response.status)}`)
  }
  return value as T
}

async function list(): Promise<OfflinePluginsListResponse> {
  const response = await fetch(OFFLINE_PLUGINS_LIST_PATH, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as OfflinePluginsListResponse
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

export function createOfflinePluginsApi(): OfflinePluginsApi {
  return {
    list,
    exportPlugin: (packageName, destinationDir) =>
      postJson<OfflinePluginsExportResponse>(OFFLINE_PLUGINS_EXPORT_PATH, { packageName, destinationDir }),
    importFrom: sourceDir =>
      postJson<OfflinePluginsImportResponse>(OFFLINE_PLUGINS_IMPORT_PATH, { sourceDir }),
    pickDirectory,
  }
}
