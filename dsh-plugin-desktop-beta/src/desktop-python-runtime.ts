/** App-local offline Python runtime published to desktop Host environments. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { installPathDirectory } from './desktop-runtime-environment.ts'

/**
 * Environment variables redirected at the embedded runtime. `UV_OFFLINE` is
 * omitted only when the host explicitly opted into networked operation; the
 * wheel closure bundled beside the interpreter must otherwise satisfy uv.
 */
export interface DesktopPythonEnvironmentPatch {
  readonly UV_PYTHON: string
  readonly UV_FIND_LINKS: string
  readonly PIP_FIND_LINKS: string
  readonly PIP_DISABLE_PIP_VERSION_CHECK: string
  readonly PIP_NO_INDEX?: string
  readonly UV_OFFLINE?: string
}

/** Inputs used to publish the packaged offline Python runtime. */
export interface DesktopPythonRuntimeOptions {
  /** Host platform; only Windows carries the embedded runtime today. */
  readonly platform: NodeJS.Platform
  /** Embedded runtime root (`resources/python-runtime`), when present. */
  readonly runtimeRoot: string | undefined
  /** Parent environment whose PATH and tool variables are updated; defaults to `process.env`. */
  readonly environment?: NodeJS.ProcessEnv
  /** Keep uv network-enabled when the host really is online. */
  readonly online?: boolean
}

/** Environment and reversible PATH updates created for the Host runtime. */
export interface DesktopPythonRuntimeInstallation {
  /** Whether an embedded runtime was found and published. */
  readonly active: boolean
  /** Published Python home directory containing `python.exe`. */
  readonly pythonDir: string | undefined
  /** Published offline wheel closure directory. */
  readonly wheelsDir: string | undefined
  /** Remove this installation's environment updates. */
  dispose(): void
}

const INACTIVE_INSTALLATION: DesktopPythonRuntimeInstallation = {
  active: false,
  pythonDir: undefined,
  wheelsDir: undefined,
  dispose: () => {},
}

/** Compute the deterministic environment patch for one embedded runtime root. */
export function desktopPythonEnvironmentPatch(
  runtimeRoot: string,
  options: { online?: boolean } = {},
): DesktopPythonEnvironmentPatch {
  const patch: DesktopPythonEnvironmentPatch = {
    UV_PYTHON: join(runtimeRoot, 'python', 'python.exe'),
    UV_FIND_LINKS: join(runtimeRoot, 'wheels'),
    PIP_FIND_LINKS: join(runtimeRoot, 'wheels'),
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  }
  // Offline pip must resolve straight from the bundled closure instead of
  // stalling on an unreachable index before timing out.
  return options.online === true ? patch : { ...patch, PIP_NO_INDEX: '1', UV_OFFLINE: '1' }
}

/** Command directories prepended to PATH, most significant first. */
export function desktopPythonPathDirectories(
  runtimeRoot: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== 'win32') return []
  return [
    join(runtimeRoot, 'python'),
    join(runtimeRoot, 'python', 'Scripts'),
    join(runtimeRoot, 'uv'),
  ]
}

/** Verify the physical layout produced by `fetch-python-runtime.mjs`. */
export function desktopPythonRuntimeRootUsable(
  runtimeRoot: string | undefined,
  platform: NodeJS.Platform,
): runtimeRoot is string {
  if (runtimeRoot === undefined || platform !== 'win32') return false
  return existsSync(join(runtimeRoot, 'python', 'python.exe'))
    && existsSync(join(runtimeRoot, 'wheels', '.closure-complete'))
}

/**
 * Publish the embedded Python, uv, and wheel closure into this process's
 * environment. Host plugins, harness tool sessions, and the AA connector
 * all spawn below this process and inherit the redirected variables.
 * @param options - packaging platform, embedded runtime root, parent environment.
 * @returns activation state and an idempotent environment disposer.
 */
export function installDesktopPythonRuntime(
  options: DesktopPythonRuntimeOptions,
): DesktopPythonRuntimeInstallation {
  if (!desktopPythonRuntimeRootUsable(options.runtimeRoot, options.platform)) {
    return INACTIVE_INSTALLATION
  }
  const runtimeRoot = options.runtimeRoot
  const environment = options.environment ?? process.env
  const patch = desktopPythonEnvironmentPatch(runtimeRoot, options)
  const original = Object.fromEntries(
    Object.keys(patch).map(key => [key, environment[key]]),
  ) as Record<keyof DesktopPythonEnvironmentPatch, string | undefined>
  Object.assign(environment, patch)
  const pathDisposers = desktopPythonPathDirectories(runtimeRoot, options.platform)
    .map(directory => installPathDirectory(environment, directory, options.platform))

  let active = true
  return {
    active: true,
    pythonDir: join(runtimeRoot, 'python'),
    wheelsDir: join(runtimeRoot, 'wheels'),
    dispose: () => {
      if (!active) return
      active = false
      for (const key of Object.keys(patch) as Array<keyof DesktopPythonEnvironmentPatch>) {
        const value = original[key]
        if (value === undefined) delete environment[key]
        else environment[key] = value
      }
      for (const dispose of pathDisposers) dispose()
    },
  }
}
