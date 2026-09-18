import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopPythonEnvironmentPatch,
  desktopPythonPathDirectories,
  desktopPythonRuntimeRootUsable,
  installDesktopPythonRuntime,
} from '../src/desktop-python-runtime.ts'
import {
  REQUIRED_WINDOWS_PYTHON_RUNTIME_ENTRIES,
  verifyWindowsPythonRuntime,
  type PackagedRuntimeContext,
} from '../scripts/verify-packaged-runtime.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-python-runtime-'))
  temporaryDirectories.push(directory)
  return directory
}

function materializeRuntime(root: string): void {
  mkdirSync(join(root, 'python', 'Scripts'), { recursive: true })
  writeFileSync(join(root, 'python', 'python.exe'), '')
  mkdirSync(join(root, 'wheels'), { recursive: true })
  writeFileSync(join(root, 'wheels', '.closure-complete'), 'demo-runtime>=0\n')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('offline Python runtime environment', () => {
  it('points uv and pip at the embedded interpreter and wheels', () => {
    const patch = desktopPythonEnvironmentPatch('C:\\app\\resources\\python-runtime')
    expect(patch.UV_PYTHON).toBe('C:\\app\\resources\\python-runtime\\python\\python.exe')
    expect(patch.UV_FIND_LINKS).toBe('C:\\app\\resources\\python-runtime\\wheels')
    expect(patch.PIP_FIND_LINKS).toBe('C:\\app\\resources\\python-runtime\\wheels')
    expect(patch.PIP_DISABLE_PIP_VERSION_CHECK).toBe('1')
    expect(patch.UV_OFFLINE).toBe('1')
    expect(patch.PIP_NO_INDEX).toBe('1')
  })

  it('keeps uv network-enabled in online mode', () => {
    const patch = desktopPythonEnvironmentPatch('/opt/python-runtime', { online: true })
    expect(patch.UV_OFFLINE).toBeUndefined()
    expect(patch.PIP_NO_INDEX).toBeUndefined()
    expect(patch.UV_PYTHON).toBe(join('/opt/python-runtime', 'python', 'python.exe'))
  })

  it('prepends python, Scripts, and uv directories on win32 only', () => {
    expect(desktopPythonPathDirectories('C:\\rt', 'win32')).toEqual([
      'C:\\rt\\python',
      'C:\\rt\\python\\Scripts',
      'C:\\rt\\uv',
    ])
    expect(desktopPythonPathDirectories('/rt', 'darwin')).toEqual([])
    expect(desktopPythonPathDirectories('/rt', 'linux')).toEqual([])
  })

  it('accepts only a complete physical runtime layout on win32', () => {
    const root = temporaryDirectory()
    expect(desktopPythonRuntimeRootUsable(root, 'win32')).toBe(false)
    materializeRuntime(root)
    expect(desktopPythonRuntimeRootUsable(root, 'win32')).toBe(true)
    expect(desktopPythonRuntimeRootUsable(root, 'darwin')).toBe(false)
    expect(desktopPythonRuntimeRootUsable(undefined, 'win32')).toBe(false)
  })

  it('stays inactive without a usable runtime root', () => {
    const environment: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' }
    const installation = installDesktopPythonRuntime({
      platform: 'win32',
      runtimeRoot: join(temporaryDirectory(), 'missing'),
      environment,
    })
    expect(installation.active).toBe(false)
    expect(installation.pythonDir).toBeUndefined()
    installation.dispose()
    expect(environment.PATH).toBe('C:\\Windows\\System32')
    expect(environment.UV_PYTHON).toBeUndefined()
  })

  it('publishes and restores the offline runtime environment', () => {
    const root = temporaryDirectory()
    materializeRuntime(root)
    const environment: NodeJS.ProcessEnv = {
      PATH: 'C:\\Windows\\System32',
      UV_PYTHON: 'C:\\SystemWide\\python.exe',
      EXISTING: 'keep',
    }
    const installation = installDesktopPythonRuntime({
      platform: 'win32',
      runtimeRoot: root,
      environment,
    })
    expect(installation.active).toBe(true)
    expect(installation.pythonDir).toBe(join(root, 'python'))
    expect(installation.wheelsDir).toBe(join(root, 'wheels'))
    expect(environment.UV_PYTHON).toBe(join(root, 'python', 'python.exe'))
    expect(environment.UV_FIND_LINKS).toBe(join(root, 'wheels'))
    expect(environment.PIP_FIND_LINKS).toBe(join(root, 'wheels'))
    expect(environment.UV_OFFLINE).toBe('1')
    expect(environment.PIP_DISABLE_PIP_VERSION_CHECK).toBe('1')
    expect(environment.PATH).toBe([
      join(root, 'uv'),
      join(root, 'python', 'Scripts'),
      join(root, 'python'),
      'C:\\Windows\\System32',
    ].join(';'))

    installation.dispose()
    expect(environment.PATH).toBe('C:\\Windows\\System32')
    expect(environment.UV_PYTHON).toBe('C:\\SystemWide\\python.exe')
    expect(environment.UV_FIND_LINKS).toBeUndefined()
    expect(environment.PIP_FIND_LINKS).toBeUndefined()
    expect(environment.UV_OFFLINE).toBeUndefined()
    expect(environment.PIP_DISABLE_PIP_VERSION_CHECK).toBeUndefined()
    expect(environment.EXISTING).toBe('keep')

    installation.dispose()
    expect(environment.PATH).toBe('C:\\Windows\\System32')
  })

  it('omits UV_OFFLINE when the host opts into networked operation', () => {
    const root = temporaryDirectory()
    materializeRuntime(root)
    const environment: NodeJS.ProcessEnv = {}
    const installation = installDesktopPythonRuntime({
      platform: 'win32',
      runtimeRoot: root,
      environment,
      online: true,
    })
    expect(installation.active).toBe(true)
    expect(environment.UV_OFFLINE).toBeUndefined()
    installation.dispose()
  })
})

describe('packaged offline Python runtime verification', () => {
  function windowsContext(appOutDir: string): PackagedRuntimeContext {
    return {
      appOutDir,
      electronPlatformName: 'win32',
      packager: { appInfo: { productFilename: 'DSH Desktop Beta' } },
    }
  }

  it('accepts the complete embedded layout', () => {
    const appOutDir = temporaryDirectory()
    const present = new Set(
      REQUIRED_WINDOWS_PYTHON_RUNTIME_ENTRIES.map(entry => join(appOutDir, 'resources', entry)),
    )
    expect(verifyWindowsPythonRuntime(windowsContext(appOutDir), path => present.has(path))).toBe(true)
  })

  it('rejects a missing wheel closure marker', () => {
    const appOutDir = temporaryDirectory()
    const present = new Set(
      REQUIRED_WINDOWS_PYTHON_RUNTIME_ENTRIES
        .filter(entry => entry !== 'python-runtime/wheels/.closure-complete')
        .map(entry => join(appOutDir, 'resources', entry)),
    )
    expect(() => verifyWindowsPythonRuntime(windowsContext(appOutDir), path => present.has(path)))
      .toThrow(/missing required entries: python-runtime\/wheels\/\.closure-complete/)
  })

  it('honors the packaging-time opt-out marker', () => {
    const appOutDir = temporaryDirectory()
    const present = new Set([join(appOutDir, 'resources', 'python-runtime', 'DISABLED')])
    expect(verifyWindowsPythonRuntime(windowsContext(appOutDir), path => present.has(path))).toBe(false)
  })

  it('honors the packaging-time opt-out environment', () => {
    const appOutDir = temporaryDirectory()
    expect(verifyWindowsPythonRuntime(
      windowsContext(appOutDir),
      () => false,
      { DSH_DESKTOP_PYTHON_RUNTIME: '0' },
    )).toBe(false)
  })

  it('ignores non-Windows platforms entirely', () => {
    const appOutDir = temporaryDirectory()
    const macContext: PackagedRuntimeContext = {
      appOutDir,
      electronPlatformName: 'darwin',
      packager: { appInfo: { productFilename: 'DSH Desktop Beta' } },
    }
    expect(verifyWindowsPythonRuntime(macContext, () => false)).toBe(false)
  })
})
