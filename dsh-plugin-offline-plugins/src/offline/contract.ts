/** Shared contract between the offline-plugins Host routes and client panel. */

/** Same-origin route listing installed Profile plugins. */
export const OFFLINE_PLUGINS_LIST_PATH = '/_dsh/offline-plugins/list'

/** Same-origin route starting one Profile plugin export job. */
export const OFFLINE_PLUGINS_EXPORT_PATH = '/_dsh/offline-plugins/export'

/** Same-origin route polling one export job's progress. */
export const OFFLINE_PLUGINS_EXPORT_PROGRESS_PATH = '/_dsh/offline-plugins/export/progress'

/** Same-origin route importing one export directory into the active Profile. */
export const OFFLINE_PLUGINS_IMPORT_PATH = '/_dsh/offline-plugins/import'

/** Launcher-owned directory chooser used by both flows. */
export const DIRECTORY_PICKER_PATH = '/_dsh/desktop/pick-directory'

/** Current export manifest format. Version 2 adds per-package semver
 * requirements so imports can reuse compatible installed versions, and lists
 * build-time-only dependencies excluded from the closure. Version 1 exports
 * remain importable. */
export const EXPORT_FORMAT_VERSION = 2

/** Export manifest versions this build can import. */
export const IMPORTABLE_FORMAT_VERSIONS: readonly number[] = [1, 2]

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

export interface OfflinePluginsExportStartResponse {
  readonly jobId: string
  readonly packages: readonly string[]
  readonly totalBytes: number
  readonly unresolved: readonly string[]
}

export interface OfflinePluginsExportProgressResponse {
  readonly jobId: string
  readonly status: 'running' | 'done' | 'failed' | 'unknown'
  readonly error: string | null
  readonly packagesDone: number
  readonly packagesTotal: number
  readonly bytesDone: number
  readonly bytesTotal: number
  readonly currentPackage: string | null
  readonly exportPath: string | null
  readonly unresolved: readonly string[]
}

export interface OfflinePluginsImportRequest {
  readonly sourceDir: string
}

export interface OfflinePluginsImportResponse {
  readonly plugin: { readonly name: string, readonly version: string }
  readonly imported: readonly string[]
  readonly skipped: readonly string[]
  /** Dependencies whose required ranges conflicted with the shared top-level
   * node_modules and were therefore installed under the plugin's private
   * nested node_modules instead. */
  readonly scoped: readonly string[]
  readonly unresolved: readonly string[]
  readonly registered: boolean
  readonly needsRestart: true
}

export interface OfflinePluginsErrorResponse {
  readonly error: string
}
