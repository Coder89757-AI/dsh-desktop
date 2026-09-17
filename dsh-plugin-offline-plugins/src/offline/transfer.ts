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
import { randomUUID } from 'node:crypto'
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

/** One background export job: packages copied one by one, yielding to the
 * event loop between packages so the Host webserver stays responsive. */
interface ExportJob {
  readonly id: string
  readonly exportRoot: string
  readonly packagesRoot: string
  readonly queue: readonly { readonly name: string, readonly sourceDir: string, readonly bytes: number }[]
  readonly bytesTotal: number
  readonly unresolved: readonly string[]
  readonly pluginName: string
  readonly pluginVersion: string
  bytesDone: number
  packagesDone: number
  currentPackage: string | null
  status: 'running' | 'done' | 'failed'
  error: string | null
  exported: { name: string, version: string }[]
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
    { name: packageName, sourceDir: pluginDir, bytes: 0 },
    ...[...closure.packages].map(([name, sourceDir]) => ({ name, sourceDir, bytes: 0 })),
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
      job.exported.push({ name: entry.name, version: packageVersionOf(target) })
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
    await yieldToEventLoop()
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
