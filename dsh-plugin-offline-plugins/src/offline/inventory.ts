/** Profile plugin inventory: manifest bundles resolved against the Profile's
 * node_modules, including package versions and the dependency closure used by
 * exports. */

import { createRequire } from 'node:module'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { OfflinePluginEntry } from './contract.ts'

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

/** Dependency names a package declares for ordinary installation. */
function declaredDependencies(document: PackageDocument): readonly string[] {
  const names: string[] = []
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    const value = document[field]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const name of Object.keys(value)) names.push(name)
    }
  }
  return names
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

/** Depth-first dependency closure of one installed package, keyed by name. */
export function dependencyClosure(
  profileDir: string,
  rootName: string,
): { readonly packages: ReadonlyMap<string, string>, readonly unresolved: readonly string[] } {
  const packages = new Map<string, string>()
  const unresolved = new Set<string>()
  const visit = (name: string, fromDir: string): void => {
    // Node-style resolution first, then the Profile's hoisted top-level
    // node_modules (pnpm public-hoist pattern) as a fallback.
    const root = resolveDependencyRoot(name, fromDir) ?? resolveDependencyRoot(name, profileDir)
    if (root === undefined) {
      unresolved.add(name)
      return
    }
    const previous = packages.get(name)
    if (previous !== undefined) return
    packages.set(name, root)
    const document = readPackageDocument(root)
    if (document === undefined) return
    for (const dependencyName of declaredDependencies(document)) {
      if (dependencyName === name) continue
      if (!isValidPackageName(dependencyName)) continue
      visit(dependencyName, root)
    }
  }
  visit(rootName, profileDir)
  packages.delete(rootName)
  return { packages, unresolved: [...unresolved] }
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
