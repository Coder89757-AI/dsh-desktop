/** Export and import of Profile plugins as self-contained directories.
 *
 * An export directory carries the plugin package plus its whole transitive
 * dependency closure (dereferenced real directories, deduplicated by package
 * name) and a manifest that also records, per dependency, the semver ranges
 * its in-tree dependents declared. Import validates the manifest and copies
 * packages into the active Profile with layered Node resolution: an installed
 * top-level version is reused when it satisfies the export's declared ranges,
 * and only genuinely conflicting dependencies are placed under the plugin's
 * private nested node_modules so multiple major versions can coexist.
 * Finally the plugin is registered in `dsh.profile.bundles` atomically. No
 * registry or network is involved. */

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
import { randomUUID } from 'node:crypto'
import { satisfies, valid as validSemver } from 'semver'
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
  IMPORTABLE_FORMAT_VERSIONS,
  type OfflinePluginsExportProgressResponse,
  type OfflinePluginsExportStartResponse,
  type OfflinePluginsImportResponse,
} from './contract.ts'

/** Finished export jobs are pruned after this long. */
const EXPORT_JOB_TTL_MS = 30 * 60 * 1000

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

interface ExportManifestPackage {
  readonly name: string
  readonly version: string
  /** Semver ranges every in-tree dependent declared for this package. Absent
   * in format version 1 exports. */
  readonly requirements?: readonly string[]
}

interface ExportManifest {
  readonly kind: typeof EXPORT_MANIFEST_KIND
  readonly formatVersion: number
  readonly exportedAt: string
  readonly plugin: { readonly name: string, readonly version: string }
  readonly packages: readonly ExportManifestPackage[]
  /** Build-time-only dependencies left out of the export on purpose. */
  readonly excluded?: readonly string[]
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

/** One background export job: packages copied one by one, yielding to the
 * event loop between packages so the Host webserver stays responsive. */
interface ExportJob {
  readonly id: string
  readonly exportRoot: string
  readonly packagesRoot: string
  readonly queue: readonly { readonly name: string, readonly sourceDir: string, readonly bytes: number, readonly requirements: readonly string[] }[]
  readonly bytesTotal: number
  readonly unresolved: readonly string[]
  readonly excluded: readonly string[]
  readonly pluginName: string
  readonly pluginVersion: string
  bytesDone: number
  packagesDone: number
  currentPackage: string | null
  status: 'running' | 'done' | 'failed'
  error: string | null
  exported: { name: string, version: string, requirements?: readonly string[] }[]
}

const exportJobs = new Map<string, ExportJob>()

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolveEvent => { setImmediate(resolveEvent) })
}

function pruneExportJobs(now: number): void {
  for (const [id, job] of exportJobs) {
    if (job.status !== 'running' && now - Number(id.slice('job_'.length)) > EXPORT_JOB_TTL_MS) {
      exportJobs.delete(id)
    }
  }
}

/** Start one export job: validates the request, stages the destination, and
 * begins copying in the background. */
export function startExportJob(
  profileDir: string,
  packageName: unknown,
  destinationDir: unknown,
): OfflinePluginsExportStartResponse {
  if (typeof packageName !== 'string' || !isValidPackageName(packageName)) {
    throw new OfflinePluginTransferError('invalid-path', 'package name is invalid')
  }
  const destination = assertTransferPath('destination directory', destinationDir)
  assertRealDirectory('destination directory', destination)
  if (IMMUTABLE_BUNDLE_NAMES.has(packageName)) {
    throw new OfflinePluginTransferError('immutable', `${packageName} ships with the application and cannot be exported`)
  }
  for (const job of exportJobs.values()) {
    if (job.status === 'running') {
      throw new OfflinePluginTransferError('conflict', 'an export is already running; wait for it to finish')
    }
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
  if (closure.packages.size + 1 > MAX_EXPORT_PACKAGES) {
    throw new OfflinePluginTransferError('io', 'dependency closure exceeds the supported package count')
  }
  const queue = [
    { name: packageName, sourceDir: pluginDir, bytes: 0, requirements: [] as readonly string[] },
    ...[...closure.packages].map(([name, sourceDir]) => ({
      name,
      sourceDir,
      bytes: 0,
      requirements: closure.requirements.get(name) ?? [],
    })),
  ]
  for (const entry of queue) entry.bytes = directoryBytes(entry.sourceDir)
  const bytesTotal = queue.reduce((total, entry) => total + entry.bytes, 0)

  const pluginVersion = packageVersionOf(pluginDir)
  const exportRoot = join(destination, `dsh-plugins__${sanitizedComponent(packageName)}__${sanitizedComponent(pluginVersion)}`)
  if (existsSync(exportRoot)) {
    rmSync(exportRoot, { recursive: true, force: true })
  }
  const packagesRoot = join(exportRoot, 'packages')
  mkdirSync(packagesRoot, { recursive: true })

  const job: ExportJob = {
    id: `job_${String(Date.now())}_${randomUUID().slice(0, 8)}`,
    exportRoot,
    packagesRoot,
    queue,
    bytesTotal,
    unresolved: closure.unresolved,
    excluded: closure.excluded,
    pluginName: packageName,
    pluginVersion,
    bytesDone: 0,
    packagesDone: 0,
    currentPackage: null,
    status: 'running',
    error: null,
    exported: [],
  }
  pruneExportJobs(Date.now())
  exportJobs.set(job.id, job)
  void runExportJob(job)
  return {
    jobId: job.id,
    packages: queue.map(entry => entry.name),
    totalBytes: bytesTotal,
    unresolved: closure.unresolved,
  }
}

/** Copy loop for one export job. */
async function runExportJob(job: ExportJob): Promise<void> {
  try {
    for (const entry of job.queue) {
      job.currentPackage = entry.name
      const target = join(job.packagesRoot, ...entry.name.split('/'))
      if (!existsSync(target)) {
        mkdirSync(dirname(target), { recursive: true })
        cpSync(entry.sourceDir, target, { recursive: true, dereference: true })
      }
      job.exported.push({ name: entry.name, version: packageVersionOf(target), requirements: entry.requirements })
      job.bytesDone += entry.bytes
      job.packagesDone += 1
      await yieldToEventLoop()
    }
    const exportManifest: ExportManifest = {
      kind: EXPORT_MANIFEST_KIND,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      plugin: { name: job.pluginName, version: job.pluginVersion },
      packages: job.exported,
      excluded: job.excluded,
      unresolved: job.unresolved,
    }
    writeFileSync(join(job.exportRoot, 'manifest.json'), `${JSON.stringify(exportManifest, undefined, 2)}\n`, { flag: 'wx' })
    job.currentPackage = null
    job.status = 'done'
  } catch (cause) {
    job.status = 'failed'
    job.error = cause instanceof Error ? cause.message : String(cause)
    rmSync(job.exportRoot, { recursive: true, force: true })
  }
}

/** Snapshot one export job's progress. */
export function exportJobProgress(jobId: unknown): OfflinePluginsExportProgressResponse {
  const job = typeof jobId === 'string' ? exportJobs.get(jobId) : undefined
  if (job === undefined) {
    return {
      jobId: typeof jobId === 'string' ? jobId : '',
      status: 'unknown',
      error: null,
      packagesDone: 0,
      packagesTotal: 0,
      bytesDone: 0,
      bytesTotal: 0,
      currentPackage: null,
      exportPath: null,
      unresolved: [],
    }
  }
  return {
    jobId: job.id,
    status: job.status,
    error: job.error,
    packagesDone: job.packagesDone,
    packagesTotal: job.queue.length,
    bytesDone: job.bytesDone,
    bytesTotal: job.bytesTotal,
    currentPackage: job.currentPackage,
    exportPath: job.status === 'done' ? job.exportRoot : null,
    unresolved: job.unresolved,
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
  if (manifest.kind !== EXPORT_MANIFEST_KIND || !IMPORTABLE_FORMAT_VERSIONS.includes(manifest.formatVersion)
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
    if (entry.requirements !== undefined && (!Array.isArray(entry.requirements)
      || !entry.requirements.every((range: unknown) => typeof range === 'string'))) {
      throw new OfflinePluginTransferError('invalid-manifest', `manifest requirements for ${entry.name} are invalid`)
    }
    assertRealDirectory(`package ${entry.name}`, join(packagesRoot, ...entry.name.split('/')))
  }

  const nodeModules = join(profileDir, 'node_modules')
  if (!existsSync(nodeModules)) {
    mkdirSync(nodeModules, { recursive: true })
  }
  // Node's resolution walks ancestors, so a dependency nested under the
  // plugin's own directory shadows the shared top-level copy only for this
  // plugin; every other bundle keeps resolving the top-level version.
  const pluginScopeNodeModules = join(nodeModules, ...packageName.split('/'), 'node_modules')
  const imported: string[] = []
  const skipped: string[] = []
  const scoped: string[] = []
  for (const entry of manifest.packages) {
    const name = entry.name
    const sourcePackage = join(packagesRoot, ...name.split('/'))
    const sourceVersion = packageVersionOf(sourcePackage)
    const target = join(nodeModules, ...name.split('/'))
    if (existsSync(target)) {
      const existingVersion = packageVersionOf(target)
      if (existingVersion === sourceVersion) {
        skipped.push(name)
        continue
      }
      // The plugin package itself is the thing the user asked to import:
      // replace it rather than working around it.
      if (name === packageName) {
        rmSync(target, { recursive: true, force: true })
      } else if (satisfiesAll(existingVersion, entry.requirements)) {
        // The installed shared version already meets every range this
        // plugin's tree declares, so reuse it instead of duplicating.
        skipped.push(name)
        continue
      } else {
        const scopedTarget = join(pluginScopeNodeModules, ...name.split('/'))
        if (existsSync(scopedTarget) && packageVersionOf(scopedTarget) === sourceVersion) {
          skipped.push(name)
          continue
        }
        mkdirSync(dirname(scopedTarget), { recursive: true })
        rmSync(scopedTarget, { recursive: true, force: true })
        cpSync(sourcePackage, scopedTarget, { recursive: true, dereference: true })
        scoped.push(name)
        await yieldToEventLoop()
        continue
      }
    }
    mkdirSync(dirname(target), { recursive: true })
    cpSync(sourcePackage, target, { recursive: true, dereference: true })
    imported.push(name)
    await yieldToEventLoop()
  }

  const registered = await registerBundle(profileDir, packageName)
  return {
    plugin: { name: packageName, version: manifest.plugin.version ?? packageVersionOf(join(nodeModules, ...packageName.split('/'))) },
    imported,
    skipped,
    scoped,
    unresolved: Array.isArray(manifest.unresolved) ? manifest.unresolved.filter(entry => typeof entry === 'string') : [],
    registered,
    needsRestart: true,
  }
}

/** Whether `version` is a valid semver satisfying every declared range. An
 * unparseable version or range never satisfies: the caller then falls back to
 * a plugin-scoped copy, which is always safe. */
function satisfiesAll(version: string, requirements: readonly string[] | undefined): boolean {
  if (requirements === undefined || requirements.length === 0) return false
  const normalized = validSemver(version)
  if (normalized === null) return false
  return requirements.every(range => satisfies(normalized, range))
}
