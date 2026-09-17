/** Export and import of Profile plugins as self-contained directories.
 *
 * An export directory carries the plugin package plus its whole transitive
 * dependency closure (dereferenced real directories, deduplicated by package
 * name) and a manifest. Import validates the manifest, copies packages into
 * the active Profile's node_modules, and registers the plugin in
 * `dsh.profile.bundles` atomically. No registry or network is involved. */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  dependencyClosure,
  IMMUTABLE_BUNDLE_NAMES,
  installedPackageDir,
  isValidPackageName,
  readProfileManifest,
} from './inventory.ts'
import {
  EXPORT_FORMAT_VERSION,
  EXPORT_MANIFEST_KIND,
  type OfflinePluginsExportResponse,
  type OfflinePluginsImportResponse,
} from './contract.ts'

const MAX_PATH_BYTES = 32 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_EXPORT_PACKAGES = 1024
const MAX_PACKAGE_FILES = 100_000

export class OfflinePluginTransferError extends Error {
  constructor(
    readonly code: 'invalid-path' | 'immutable' | 'not-installed' | 'conflict' | 'invalid-manifest' | 'io',
    message: string,
  ) {
    super(message)
    this.name = 'OfflinePluginTransferError'
  }
}

interface ExportManifest {
  readonly kind: typeof EXPORT_MANIFEST_KIND
  readonly formatVersion: number
  readonly exportedAt: string
  readonly plugin: { readonly name: string, readonly version: string }
  readonly packages: readonly { readonly name: string, readonly version: string }[]
  readonly unresolved: readonly string[]
}

function assertTransferPath(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || !isAbsolute(value) || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) {
    throw new OfflinePluginTransferError('invalid-path', `${label} must be a bounded absolute path`)
  }
  return resolve(value)
}

function assertRealDirectory(label: string, path: string): void {
  let info
  try {
    info = lstatSync(path)
  } catch {
    throw new OfflinePluginTransferError('invalid-path', `${label} does not exist: ${path}`)
  }
  if (!info.isDirectory()) {
    throw new OfflinePluginTransferError('invalid-path', `${label} must be a directory: ${path}`)
  }
}

function sanitizedComponent(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9._-]/gu, '__')
  return sanitized.length > 0 && sanitized.length <= 128 ? sanitized : 'unnamed'
}

function packageVersionOf(packageDir: string): string {
  try {
    const document = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof document.version === 'string' ? document.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function directoryBytes(root: string): number {
  let total = 0
  let visited = 0
  const walk = (current: string): void => {
    if (visited > MAX_PACKAGE_FILES) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      visited += 1
      const child = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(child)
      } else if (entry.isFile()) {
        try {
          total += statSync(child).size
        } catch {
          // A file disappearing mid-walk never fails the export.
        }
      }
    }
  }
  walk(root)
  return total
}

/** Export one Profile plugin and its dependency closure to a fresh directory. */
export function exportProfilePlugin(
  profileDir: string,
  packageName: unknown,
  destinationDir: unknown,
): OfflinePluginsExportResponse {
  if (typeof packageName !== 'string' || !isValidPackageName(packageName)) {
    throw new OfflinePluginTransferError('invalid-path', 'package name is invalid')
  }
  const destination = assertTransferPath('destination directory', destinationDir)
  assertRealDirectory('destination directory', destination)
  if (IMMUTABLE_BUNDLE_NAMES.has(packageName)) {
    throw new OfflinePluginTransferError('immutable', `${packageName} ships with the application and cannot be exported`)
  }
  const manifest = readProfileManifest(profileDir)
  if (!manifest.bundles.includes(packageName)) {
    throw new OfflinePluginTransferError('not-installed', `${packageName} is not a bundle of the active Profile`)
  }
  const pluginDir = installedPackageDir(profileDir, packageName)
  if (pluginDir === undefined) {
    throw new OfflinePluginTransferError('not-installed', `${packageName} is declared but not installed under the Profile`)
  }

  const closure = dependencyClosure(profileDir, packageName)
  const exportRoot = join(
    destination,
    `dsh-plugins__${sanitizedComponent(packageName)}__${sanitizedComponent(packageVersionOf(pluginDir))}`,
  )
  if (existsSync(exportRoot)) {
    rmSync(exportRoot, { recursive: true, force: true })
  }
  const packagesRoot = join(exportRoot, 'packages')
  mkdirSync(packagesRoot, { recursive: true })

  const exported: { name: string, version: string }[] = []
  let totalBytes = directoryBytes(pluginDir)
  const copyPackage = (name: string, sourceDir: string): void => {
    const target = join(packagesRoot, ...name.split('/'))
    if (existsSync(target)) return
    mkdirSync(dirname(target), { recursive: true })
    cpSync(sourceDir, target, { recursive: true, dereference: true })
    totalBytes += directoryBytes(target)
    exported.push({ name, version: packageVersionOf(target) })
  }
  copyPackage(packageName, pluginDir)
  if (exported.length + closure.packages.size > MAX_EXPORT_PACKAGES) {
    rmSync(exportRoot, { recursive: true, force: true })
    throw new OfflinePluginTransferError('io', 'dependency closure exceeds the supported package count')
  }
  for (const [name, sourceDir] of closure.packages) {
    copyPackage(name, sourceDir)
  }

  const exportManifest: ExportManifest = {
    kind: EXPORT_MANIFEST_KIND,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    plugin: { name: packageName, version: packageVersionOf(pluginDir) },
    packages: exported,
    unresolved: closure.unresolved,
  }
  try {
    writeFileSync(join(exportRoot, 'manifest.json'), `${JSON.stringify(exportManifest, undefined, 2)}\n`, { flag: 'wx' })
  } catch (cause) {
    rmSync(exportRoot, { recursive: true, force: true })
    throw new OfflinePluginTransferError('io', `could not write the export manifest: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  return {
    exportPath: exportRoot,
    packages: exported.map(entry => entry.name),
    unresolved: closure.unresolved,
    totalBytes,
  }
}

/** Register one bundle name in the Profile manifest under a file lock. */
async function registerBundle(profileDir: string, packageName: string): Promise<boolean> {
  const manifestPath = join(profileDir, 'package.json')
  let registered = false
  await withFileLock(manifestPath, async () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const document = raw as Record<string, unknown>
    const dsh = (document.dsh ?? {}) as Record<string, unknown>
    const profile = (dsh.profile ?? {}) as Record<string, unknown>
    const current = Array.isArray(profile.bundles) && profile.bundles.every(entry => typeof entry === 'string')
      ? profile.bundles as string[]
      : []
    if (current.includes(packageName)) return
    const next = {
      ...document,
      dsh: { ...dsh, profile: { ...profile, bundles: [...current, packageName] } },
    }
    await writeFileAtomic(manifestPath, `${JSON.stringify(next, undefined, 2)}\n`, { mode: 0o600 })
    registered = true
  })
  return registered
}

/** Import one export directory into the active Profile. */
export async function importProfilePlugin(
  profileDir: string,
  sourceDir: unknown,
): Promise<OfflinePluginsImportResponse> {
  const source = assertTransferPath('export directory', sourceDir)
  assertRealDirectory('export directory', source)
  const manifestPath = join(source, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new OfflinePluginTransferError('invalid-manifest', `manifest.json is missing under ${source}`)
  }
  let manifest: ExportManifest
  try {
    const content = readFileSync(manifestPath, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new OfflinePluginTransferError('invalid-manifest', 'manifest is too large')
    }
    manifest = JSON.parse(content) as ExportManifest
  } catch (cause) {
    if (cause instanceof OfflinePluginTransferError) throw cause
    throw new OfflinePluginTransferError('invalid-manifest', `manifest.json is not readable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (manifest.kind !== EXPORT_MANIFEST_KIND || manifest.formatVersion !== EXPORT_FORMAT_VERSION
    || manifest.plugin === null || typeof manifest.plugin !== 'object'
    || typeof manifest.plugin.name !== 'string' || !isValidPackageName(manifest.plugin.name)
    || !Array.isArray(manifest.packages)) {
    throw new OfflinePluginTransferError('invalid-manifest', 'manifest is not a supported offline-plugins export')
  }
  const packageName = manifest.plugin.name
  const packagesRoot = realpathSync(join(source, 'packages'))
  for (const entry of manifest.packages) {
    if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || !isValidPackageName(entry.name)) {
      throw new OfflinePluginTransferError('invalid-manifest', 'manifest package entry is invalid')
    }
    assertRealDirectory(`package ${entry.name}`, join(packagesRoot, ...entry.name.split('/')))
  }

  const nodeModules = join(profileDir, 'node_modules')
  if (!existsSync(nodeModules)) {
    mkdirSync(nodeModules, { recursive: true })
  }
  const imported: string[] = []
  const skipped: string[] = []
  for (const entry of manifest.packages) {
    const name = entry.name
    const sourcePackage = join(packagesRoot, ...name.split('/'))
    const target = join(nodeModules, ...name.split('/'))
    if (existsSync(target)) {
      const existingVersion = packageVersionOf(target)
      if (existingVersion === packageVersionOf(sourcePackage)) {
        skipped.push(name)
        continue
      }
      throw new OfflinePluginTransferError(
        'conflict',
        `${name} already exists at version ${existingVersion}; remove it first to import ${packageVersionOf(sourcePackage)}`,
      )
    }
    mkdirSync(dirname(target), { recursive: true })
    cpSync(sourcePackage, target, { recursive: true, dereference: true })
    imported.push(name)
  }

  const registered = await registerBundle(profileDir, packageName)
  return {
    plugin: { name: packageName, version: manifest.plugin.version ?? packageVersionOf(join(nodeModules, ...packageName.split('/'))) },
    imported,
    skipped,
    unresolved: Array.isArray(manifest.unresolved) ? manifest.unresolved.filter(entry => typeof entry === 'string') : [],
    registered,
    needsRestart: true,
  }
}
