/** Shared contract between the offline-plugins Host routes and client panel. */

/** Same-origin route listing installed Profile plugins. */
export const OFFLINE_PLUGINS_LIST_PATH = '/_dsh/offline-plugins/list'

/** Same-origin route exporting one Profile plugin and its dependency closure. */
export const OFFLINE_PLUGINS_EXPORT_PATH = '/_dsh/offline-plugins/export'

/** Same-origin route importing one export directory into the active Profile. */
export const OFFLINE_PLUGINS_IMPORT_PATH = '/_dsh/offline-plugins/import'

/** Launcher-owned directory chooser used by both flows. */
export const DIRECTORY_PICKER_PATH = '/_dsh/desktop/pick-directory'

/** Current export manifest format. */
export const EXPORT_FORMAT_VERSION = 1

/** Marker written into every export manifest. */
export const EXPORT_MANIFEST_KIND = 'dsh-offline-plugins-export'

/** One Profile plugin as shown by the management panel. */
export interface OfflinePluginEntry {
  readonly name: string
  readonly version: string
  readonly immutable: boolean
  readonly disabled: boolean
}

export interface OfflinePluginsListResponse {
  readonly plugins: readonly OfflinePluginEntry[]
}

export interface OfflinePluginsExportRequest {
  readonly packageName: string
  readonly destinationDir: string
}

export interface OfflinePluginsExportResponse {
  readonly exportPath: string
  readonly packages: readonly string[]
  readonly unresolved: readonly string[]
  readonly totalBytes: number
}

export interface OfflinePluginsImportRequest {
  readonly sourceDir: string
}

export interface OfflinePluginsImportResponse {
  readonly plugin: { readonly name: string, readonly version: string }
  readonly imported: readonly string[]
  readonly skipped: readonly string[]
  readonly unresolved: readonly string[]
  readonly registered: boolean
  readonly needsRestart: true
}

export interface OfflinePluginsErrorResponse {
  readonly error: string
}
