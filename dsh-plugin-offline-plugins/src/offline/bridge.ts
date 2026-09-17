/** Offline-plugins Host bridge: profile plugin inventory, offline export of
 * dependency closures, and offline import that registers Profile bundles. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { listInstalledPlugins, IMMUTABLE_BUNDLE_NAMES } from './inventory.ts'
import { startExportJob, exportJobProgress, importProfilePlugin } from './transfer.ts'
import {
  OFFLINE_PLUGINS_EXPORT_PATH,
  OFFLINE_PLUGINS_EXPORT_PROGRESS_PATH,
  OFFLINE_PLUGINS_IMPORT_PATH,
  OFFLINE_PLUGINS_LIST_PATH,
  type OfflinePluginsListResponse,
} from './contract.ts'
import {
  handleExportProgressRequest,
  handleExportStartRequest,
  handleImportRequest,
  handleListRequest,
  type OfflinePluginsRouteDeps,
} from './route.ts'

/** Stable Cordis plugin name. */
export const name = 'offline-plugins-bridge'

/** Services resolved before routes register. */
export const inject = ['webServer', 'connection', 'desktopPnpmBootstrap', 'desktopPlugins']

/** Narrow structural faces of the Desktop-owned services this bridge consumes. */
interface DesktopServices {
  readonly desktopPnpmBootstrap: {
    readonly activeProfileDir: string
  }
  readonly desktopPlugins: {
    readonly list: () => readonly {
      readonly packageName: string
      readonly mutable: boolean
      readonly status: 'active' | 'disabled'
    }[]
    readonly disabledPackageNames: () => readonly string[]
  }
}

/** Register the bridge: three private same-origin routes over the shared web server. */
export function apply(ctx: Context): void {
  const desktop = ctx as unknown as Context & DesktopServices
  const profileDir = desktop.desktopPnpmBootstrap.activeProfileDir
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`

  const mutableNames = (): ReadonlySet<string> => {
    const names = new Set<string>()
    for (const bundle of desktop.desktopPlugins.list()) {
      if (bundle.mutable) names.add(bundle.packageName)
    }
    for (const immutableName of IMMUTABLE_BUNDLE_NAMES) names.delete(immutableName)
    return names
  }

  const deps: OfflinePluginsRouteDeps = {
    expectedOrigin: rendererOrigin,
    list: (): OfflinePluginsListResponse => ({
      plugins: listInstalledPlugins(
        profileDir,
        mutableNames(),
        new Set(desktop.desktopPlugins.disabledPackageNames()),
      ),
    }),
    startExport: (packageName, destinationDir) => startExportJob(profileDir, packageName, destinationDir),
    exportProgress: jobId => exportJobProgress(jobId),
    importFrom: sourceDir => importProfilePlugin(profileDir, sourceDir),
  }

  const routes = [
    [OFFLINE_PLUGINS_LIST_PATH, handleListRequest],
    [OFFLINE_PLUGINS_EXPORT_PATH, handleExportStartRequest],
    [OFFLINE_PLUGINS_EXPORT_PROGRESS_PATH, handleExportProgressRequest],
    [OFFLINE_PLUGINS_IMPORT_PATH, handleImportRequest],
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
      `offline-plugins: private route ${path}`,
    )
  }
}
