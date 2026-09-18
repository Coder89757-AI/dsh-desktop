/** Profile plugin inventory: manifest bundles resolved against the Profile's
 * node_modules, including package versions and the dependency closure used by
 * exports. */

import { createRequire } from 'node:module'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { OfflinePluginEntry } from './contract.ts'

/** Build-time-only dependencies that never need to travel with an export:
 * they are consumed when compiling native addons, not at plugin load time. */
export const EXPORT_EXCLUDED_PACKAGES: ReadonlySet<string> = new Set(['node-addon-api'])

/** Bundles that ship with the application itself and are never exportable. */
export const IMMUTABLE_BUNDLE_NAMES: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-community-market',
  'dsh-plugin-desktop',
  'dsh-plugin-desktop-beta',
])

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && PACKAGE_NAME_PATTERN.test(name)
}

interface ProfileManifest {
  readonly bundles: readonly string[]
}

interface RawProfileManifest {
  dependencies?: unknown
  dsh?: {
    profile?: {
      bundles?: unknown
    }
  }
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
    ? value as readonly string[]
    : []
}

/** Read the active Profile manifest's declared bundle names. */
export function readProfileManifest(profileDir: string): ProfileManifest {
  const raw = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as RawProfileManifest
  return { bundles: stringArray(raw.dsh?.profile?.bundles) }
}

interface PackageDocument {
  name?: unknown
  version?: unknown
  dependencies?: unknown
  optionalDependencies?: unknown
}

function readPackageDocument(packageDir: string): PackageDocument | undefined {
  try {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageDocument
  } catch {
    return undefined
  }
}

function packageVersion(packageDir: string): string {
  const document = readPackageDocument(packageDir)
  return typeof document?.version === 'string' ? document.version : '0.0.0'
}

/** Real on-disk directory for one installed package, following pnpm links. */
export function installedPackageDir(profileDir: string, name: string): string | undefined {
  const candidate = join(profileDir, 'node_modules', name)
  try {
    const info = lstatSync(candidate)
    if (!info.isDirectory() && !info.isSymbolicLink()) return undefined
    return realpathSync(candidate)
  } catch {
    return undefined
  }
}

/** Dependencies a package declares for ordinary installation, with the semver
 * range each declaration carries (non-string ranges degrade to `*`). */
function declaredDependencies(document: PackageDocument): readonly { readonly name: string, readonly range: string }[] {
  const entries: { name: string, range: string }[] = []
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    const value = document[field]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
        entries.push({ name, range: typeof range === 'string' ? range : '*' })
      }
    }
  }
  return entries
}

/** Walk node_modules ancestors manually (handles ESM-only packages whose
 * `exports` map blocks `require.resolve`). */
function probeNodeModules(dependencyName: string, startDir: string): string | undefined {
  const segments = dependencyName.split('/')
  let current = resolve(startDir)
  for (;;) {
    const base = /node_modules[/\\]?$/u.test(current) ? current : join(current, 'node_modules')
    const candidate = join(base, ...segments)
    if (existsSync(join(candidate, 'package.json'))) {
      const document = readPackageDocument(candidate)
      if (document?.name === dependencyName) {
        try {
          return realpathSync(candidate)
        } catch {
          return undefined
        }
      }
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** Resolve one dependency's real package root the way Node would from `fromDir`. */
function resolveDependencyRoot(dependencyName: string, fromDir: string): string | undefined {
  const localRequire = createRequire(join(fromDir, 'package.json'))
  for (const subpath of [`${dependencyName}/package.json`, dependencyName]) {
    try {
      const resolved = localRequire.resolve(subpath)
      let current = resolve(dirname(resolved))
      for (;;) {
        const manifestPath = join(current, 'package.json')
        if (existsSync(manifestPath)) {
          const document = readPackageDocument(current)
          if (document?.name === dependencyName) return current
        }
        const parent = dirname(current)
        if (parent === current) return undefined
        current = parent
      }
    } catch {
      // Try the next resolution strategy.
    }
  }
  return probeNodeModules(dependencyName, fromDir)
}

/** Depth-first dependency closure of one installed package, keyed by name.
 * `requirements` collects, per dependency, every semver range its in-tree
 * dependents declared — import uses it to decide whether an already-installed
 * top-level version can be reused instead of copied. */
export function dependencyClosure(
  profileDir: string,
  rootName: string,
): {
  readonly packages: ReadonlyMap<string, string>
  readonly requirements: ReadonlyMap<string, readonly string[]>
  readonly excluded: readonly string[]
  readonly unresolved: readonly string[]
} {
  const packages = new Map<string, string>()
  const requirements = new Map<string, string[]>()
  const excluded = new Set<string>()
  const unresolved = new Set<string>()
  const visit = (name: string, range: string, fromDir: string): void => {
    // Node-style resolution first, then the Profile's hoisted top-level
    // node_modules (pnpm public-hoist pattern) as a fallback.
    const root = resolveDependencyRoot(name, fromDir) ?? resolveDependencyRoot(name, profileDir)
    if (root === undefined) {
      unresolved.add(name)
      return
    }
    const ranges = requirements.get(name)
    if (ranges === undefined) requirements.set(name, [range])
    else if (!ranges.includes(range)) ranges.push(range)
    if (EXPORT_EXCLUDED_PACKAGES.has(name)) {
      excluded.add(name)
      return
    }
    const previous = packages.get(name)
    if (previous !== undefined) return
    packages.set(name, root)
    const document = readPackageDocument(root)
    if (document === undefined) return
    for (const dependency of declaredDependencies(document)) {
      if (dependency.name === name) continue
      if (!isValidPackageName(dependency.name)) continue
      visit(dependency.name, dependency.range, root)
    }
  }
  visit(rootName, '*', profileDir)
  packages.delete(rootName)
  requirements.delete(rootName)
  return { packages, requirements, excluded: [...excluded], unresolved: [...unresolved] }
}

/** Every installed Profile plugin visible to the management panel.
 * `mutableNames` and `disabledNames` come from the Desktop plugin-management
 * service; names it does not know fall back to the launcher-owned set. */
export function listInstalledPlugins(
  profileDir: string,
  mutableNames: ReadonlySet<string>,
  disabledNames: ReadonlySet<string>,
): readonly OfflinePluginEntry[] {
  const manifest = readProfileManifest(profileDir)
  const entries: OfflinePluginEntry[] = []
  for (const name of manifest.bundles) {
    const packageDir = installedPackageDir(profileDir, name)
    const knownMutable = mutableNames.size > 0
      ? mutableNames.has(name)
      : !IMMUTABLE_BUNDLE_NAMES.has(name)
    entries.push({
      name,
      version: packageDir === undefined ? '?' : packageVersion(packageDir),
      immutable: !knownMutable,
      disabled: disabledNames.has(name),
    })
  }
  return entries
}
