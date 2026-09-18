/** Prepare the offline Python runtime embedded into Windows packages.
 *
 * Produces `build/python-runtime/` from configurable mirrors:
 *
 *   python/   standalone CPython from python-build-standalone (install_only)
 *   uv/       uv.exe mirrored from the @dataiku/uv-win32-x64 npm package
 *   wheels/   wheel closure for the bundled AA connector dependencies
 *
 * The whole tree is idempotent: components whose recorded manifest entries
 * still match are reused, downloads are cached below `.cache/`, and the
 * wheel closure is rebuilt only when the connector dependency list changes.
 *
 * Environment knobs (all optional):
 *   DSH_DESKTOP_PYTHON_RUNTIME=0   leave an empty runtime directory (offline
 *                                  bundle disabled for this build)
 *   DSH_PYTHON_STANDALONE_MIRROR   python-build-standalone mirror root
 *   DSH_PYTHON_STANDALONE_TAG      release tag (default 20260901)
 *   DSH_PYTHON_STANDALONE_VERSION  CPython version (default 3.12.14)
 *   DSH_UV_NPM_REGISTRY            npm registry serving @dataiku/uv-win32-x64
 *   DSH_UV_VERSION                 uv version (default 0.12.0)
 *   DSH_PYPI_INDEX_URL             index used for the wheel closure download
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const outputRoot = join(packageRoot, 'build', 'python-runtime')
const cacheRoot = join(outputRoot, '.cache')

const DEFAULT_PYTHON_MIRROR = 'https://registry.npmmirror.com/-/binary/python-build-standalone'
const DEFAULT_PYTHON_TAG = '20260901'
const DEFAULT_PYTHON_VERSION = '3.12.14'
const DEFAULT_UV_REGISTRY = 'https://registry.npmmirror.com'
const DEFAULT_UV_VERSION = '0.12.0'
const DEFAULT_PYPI_INDEX = 'https://mirrors.aliyun.com/pypi/simple/'

function log(message) {
  console.log(`fetch-python-runtime: ${message}`)
}

function fail(message) {
  throw new Error(`fetch-python-runtime: ${message}`)
}

function setting(name, fallback) {
  const value = process.env[name]
  return value === undefined || value.length === 0 ? fallback : value
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Remove one tree, parking it below the cache when the host guards bulk
 * deletes. Guarded hosts keep rejected `rmSync` trees below the output root,
 * so the parked copy stays out of the packaged result either way.
 */
function removeTree(path) {
  if (!existsSync(path)) return
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    mkdirSync(cacheRoot, { recursive: true })
    const parked = join(cacheRoot, `.parked-${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
    renameSync(path, parked)
    log(`parked guarded tree ${path} below ${parked}`)
  }
}

/** tar treats `D:\...` drive prefixes as remote host specs; hand it forward slashes. */
function tarPath(path) {
  return path.replaceAll('\\', '/')
}

function extractArchive(archive, destination) {
  const result = spawnSync('tar', ['--force-local', '-xf', tarPath(archive), '-C', tarPath(destination)], { stdio: 'pipe' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    fail(`cannot extract ${archive} (${String(result.status)}): ${result.stderr?.toString() ?? ''}`)
  }
}

async function downloadToFile(url, destination) {
  log(`downloading ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    fail(`download failed with HTTP ${String(response.status)} for ${url}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const temporary = `${destination}.${process.pid}.tmp`
  writeFileSync(temporary, buffer)
  renameSync(temporary, destination)
  return buffer
}

function readManifest() {
  const path = join(outputRoot, 'manifest.json')
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return typeof value === 'object' && value !== null ? value : {}
  } catch {
    return {}
  }
}

function writeManifest(manifest) {
  writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/** Resolve the bundled AA connector archive the package actually depends on. */
function connectorArchive() {
  const vendorDir = join(repoRoot, 'vendor', 'agents-anywhere')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const reference = manifest.dependencies?.['@agents-anywhere/dsh-bridge-next']
    ?? manifest.devDependencies?.['@agents-anywhere/dsh-bridge-next']
  const referenced = /^\s*file:\s*(.+\.tgz)\s*$/.exec(String(reference ?? ''))?.[1]
  if (referenced !== undefined) {
    const archive = join(packageRoot, referenced)
    if (existsSync(archive)) return archive
    fail(`package.json references ${referenced}, which does not exist below ${packageRoot}`)
  }
  if (existsSync(vendorDir)) {
    const archives = readdirSync(vendorDir).filter(name => name.endsWith('.tgz')).sort()
    const archive = archives.at(-1)
    if (archive !== undefined) {
      log(`no file: bridge dependency declared; falling back to ${archive}`)
      return join(vendorDir, archive)
    }
  }
  fail('no vendor/agents-anywhere/*.tgz found; the wheel closure needs the bundled connector pyproject.toml')
}

/** Read one file from a tar archive without extracting it to disk. */
function readTarEntry(archive, entry) {
  const result = spawnSync('tar', ['--force-local', '-xOf', tarPath(archive), entry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    fail(`cannot read ${entry} from ${archive}: ${result.stderr?.toString() ?? ''}`)
  }
  return result.stdout.toString()
}

function quotedValues(block) {
  return [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => match[1])
}

/** Capture one bracketed TOML array, ignoring brackets inside quoted strings. */
function tomlArrayBlock(text, openingIndex) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = openingIndex; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { inString = !inString; continue }
    if (inString) continue
    if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth === 0) return text.slice(openingIndex + 1, index)
    }
  }
  return ''
}

/** Extra requirements the desktop agent must satisfy while fully offline,
 * beyond the bundled connector closure (e.g. Word report generation). */
const DESKTOP_EXTRA_REQUIREMENTS = [
  'python-docx>=1.1.2',
  'openpyxl>=3.1.5',
]

/** Locate `<key> = [` and capture its balanced array body. */
function tomlArrayFor(text, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[`, 'm').exec(text)
  if (match === null) return ''
  return tomlArrayBlock(text, match.index + match[0].length - 1)
}

/** Extract runtime and build requirements from the connector pyproject. */
function connectorRequirements() {
  const pyproject = readTarEntry(
    connectorArchive(),
    'package/lib/bundled-connector/pyproject.toml',
  )
  const dependencies = tomlArrayFor(pyproject, 'dependencies')
  const buildRequires = tomlArrayFor(pyproject, 'requires')
  // `uv run` resolves the default dependency groups too, so the offline
  // closure must cover the connector's dev group regardless of UV_NO_DEV.
  const devGroup = tomlArrayFor(pyproject, 'dev')
  const requirements = [...quotedValues(dependencies), ...quotedValues(buildRequires), ...quotedValues(devGroup)]
  if (requirements.length === 0) {
    fail('the bundled connector pyproject.toml exposes no requirements')
  }
  return [...new Set(requirements)]
}

async function ensurePython(manifest) {
  const mirror = setting('DSH_PYTHON_STANDALONE_MIRROR', DEFAULT_PYTHON_MIRROR)
  const tag = setting('DSH_PYTHON_STANDALONE_TAG', DEFAULT_PYTHON_TAG)
  const version = setting('DSH_PYTHON_STANDALONE_VERSION', DEFAULT_PYTHON_VERSION)
  const archiveName = `cpython-${version}+${tag}-x86_64-pc-windows-msvc-install_only.tar.gz`
  const url = `${mirror}/${tag}/${archiveName}`
  const pythonDir = join(outputRoot, 'python')
  const recorded = manifest.python
  if (recorded?.url === url && existsSync(join(pythonDir, 'python.exe'))) {
    ensurePython3Alias(pythonDir)
    log(`python ${version} is already present`)
    return recorded
  }
  mkdirSync(cacheRoot, { recursive: true })
  const archive = join(cacheRoot, archiveName)
  if (!existsSync(archive)) await downloadToFile(url, archive)
  const checksum = sha256File(archive)
  const staging = join(cacheRoot, `.python-extract.${process.pid}`)
  removeTree(staging)
  mkdirSync(staging, { recursive: true })
  extractArchive(archive, staging)
  // install_only archives either lay out python.exe directly or below one python/ directory.
  const extractedRoot = existsSync(join(staging, 'python.exe'))
    ? staging
    : join(staging, 'python')
  if (!existsSync(join(extractedRoot, 'python.exe'))) {
    fail(`the python archive ${archiveName} did not contain python.exe`)
  }
  removeTree(pythonDir)
  renameSync(extractedRoot, pythonDir)
  ensurePython3Alias(pythonDir)
  removeTree(staging)
  return { url, sha256: checksum }
}

/**
 * The upstream agent resolves its interpreter through the bare name
 * `python3`, but python-build-standalone ships only `python.exe`. Publish a
 * copy under the expected name so PATH lookup succeeds on Windows.
 */
function ensurePython3Alias(pythonDir) {
  const python = join(pythonDir, 'python.exe')
  const python3 = join(pythonDir, 'python3.exe')
  if (existsSync(python3)) return
  copyFileSync(python, python3)
  log('published python3.exe beside python.exe for bare-name discovery')
}

async function ensureUv(manifest) {
  const version = setting('DSH_UV_VERSION', DEFAULT_UV_VERSION)
  const uvPath = join(outputRoot, 'uv', 'uv.exe')
  // Prefer the @dataiku/uv-win32-x64 binary already hoisted next to the bundled
  // bridge dependency; it stays version-locked with the connector runtime.
  const hoistedUv = join(packageRoot, 'node_modules', '@dataiku', 'uv-win32-x64', 'bin', 'uv.exe')
  const source = existsSync(hoistedUv)
    ? hoistedUv
    : `${setting('DSH_UV_NPM_REGISTRY', DEFAULT_UV_REGISTRY)}/@dataiku/uv-win32-x64/-/uv-win32-x64-${version}.tgz`
  if (manifest.uv?.source === source && existsSync(uvPath)) {
    log(`uv from ${source} is already present`)
    return manifest.uv
  }
  const staging = join(cacheRoot, `.uv-extract.${process.pid}`)
  removeTree(staging)
  mkdirSync(staging, { recursive: true })
  if (existsSync(hoistedUv)) {
    copyFileSync(hoistedUv, join(staging, 'uv.exe'))
  } else {
    mkdirSync(cacheRoot, { recursive: true })
    const archiveName = `uv-win32-x64-${version}.tgz`
    const archive = join(cacheRoot, archiveName)
    if (!existsSync(archive)) await downloadToFile(source, archive)
    extractArchive(archive, staging)
  }
  const checksum = sha256File(join(staging, 'uv.exe'))
  removeTree(join(outputRoot, 'uv'))
  mkdirSync(join(outputRoot, 'uv'), { recursive: true })
  renameSync(join(staging, 'uv.exe'), uvPath)
  removeTree(staging)
  return { source, sha256: checksum }
}

function runPython(pythonExecutable, args) {
  const result = spawnSync(pythonExecutable, args, { stdio: 'pipe' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    fail(`python ${args.join(' ')} exited with ${String(result.status)}: ${result.stderr?.toString() ?? ''}`)
  }
  return result
}

/** ensurepip on python-build-standalone installs the pip module but no
 * Windows launcher, so materialize Scripts/pip.exe explicitly; the packaged
 * runtime verifier requires it. */
function ensurePipLauncher() {
  const pythonExecutable = join(outputRoot, 'python', 'python.exe')
  const pipLauncher = join(outputRoot, 'python', 'Scripts', 'pip.exe')
  if (existsSync(pipLauncher)) return
  log('generating the Windows pip launcher')
  runPython(pythonExecutable, [
    '-m', 'pip', 'install', '--force-reinstall', '--disable-pip-version-check',
    '-i', setting('DSH_PYPI_INDEX_URL', DEFAULT_PYPI_INDEX), 'pip',
  ])
  if (!existsSync(pipLauncher)) fail('reinstalling pip did not produce python/Scripts/pip.exe')
}

/**
 * uv resolves the connector lock universally (every platform and Python fork),
 * so the offline wheel closure must also cover dependencies that pip skips on
 * a win32 host: non-win32 `sys_platform` markers such as pexpect/ptyprocess
 * and emscripten-only bridges such as httpx2-jsfetch. Those requirements hide
 * inside transitive wheel metadata, so scan every downloaded wheel and keep
 * downloading stripped requirements until the closure reaches a fixed point.
 */
const UNIVERSAL_SCAN_SCRIPT = [
  'import json, sys, zipfile',
  'from pathlib import Path',
  'out = set()',
  'for wheel in Path(sys.argv[1]).glob("*.whl"):',
  '    with zipfile.ZipFile(wheel) as archive:',
  '        names = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]',
  '        if not names:',
  '            continue',
  '        for line in archive.read(names[0]).decode("utf-8", "replace").splitlines():',
  '            if not line.startswith("Requires-Dist:"):',
  '                continue',
  '            body = line[len("Requires-Dist:"):].strip()',
  '            if ";" not in body:',
  '                continue',
  '            requirement, marker = body.split(";", 1)',
  '            normalized = marker.replace(chr(34), chr(39))',
  '            if "extra ==" in normalized:',
  '                continue',
  '            if "sys_platform" in normalized and "sys_platform == \'win32\'" not in normalized:',
  '                out.add(requirement.strip())',
  'print(json.dumps(sorted(out)))',
].join('\n')

function scanUniversalRequirements(pythonExecutable, wheelsDir) {
  return JSON.parse(runPython(pythonExecutable, ['-c', UNIVERSAL_SCAN_SCRIPT, wheelsDir]).stdout.toString())
}

async function ensureWheels(manifest) {
  const requirements = [...connectorRequirements(), ...DESKTOP_EXTRA_REQUIREMENTS]
  const topText = `${requirements.join('\n')}\n`
  const wheelsDir = join(outputRoot, 'wheels')
  const marker = join(wheelsDir, '.closure-complete')
  if (manifest.wheels?.requirementText === topText && existsSync(marker)) {
    log(`wheel closure for ${String(requirements.length)} requirements is already present`)
    return manifest.wheels
  }
  const nonWinMarker = /;\s*sys_platform\s*!=\s*['"]win32['"]/
  const portableOnly = [...new Set(requirements
    .filter(requirement => nonWinMarker.test(requirement))
    .map(requirement => requirement.replace(/\s*;\s*sys_platform\s*!=\s*['"]win32['"]\s*$/, '')))]
  // hatchling builds editable wheels through the `editables` package without
  // declaring it in its own metadata, and `uv sync` installs the connector
  // editable, so the offline closure must ship it explicitly.
  const buildExtras = ['editables>=0.3']
  const satisfied = new Set()
  const pythonExecutable = join(outputRoot, 'python', 'python.exe')
  if (!existsSync(pythonExecutable)) fail('python.exe is required before the wheel closure download')
  log('bootstrapping pip via ensurepip')
  runPython(pythonExecutable, ['-m', 'ensurepip', '--upgrade'])
  const index = setting('DSH_PYPI_INDEX_URL', DEFAULT_PYPI_INDEX)
  const requirementFile = join(outputRoot, 'connector-requirements.txt')
  writeFileSync(requirementFile, topText)
  removeTree(wheelsDir)
  mkdirSync(wheelsDir, { recursive: true })
  log(`downloading ${String(requirements.length)} requirements from ${index}`)
  runPython(pythonExecutable, [
    '-m', 'pip', 'download',
    '-r', requirementFile,
    '-d', wheelsDir,
    '-i', index,
    '--disable-pip-version-check',
    // uv cannot build sdists while offline, so the closure must be wheels-only.
    '--only-binary', ':all:',
  ])
  // pip evaluates `sys_platform != 'win32'` markers as false on this host, so
  // the requirements above skip pexpect/ptyprocess entirely; download them
  // marker-less so uv's universal resolution can still satisfy them offline.
  const skippedByHost = [...portableOnly, ...buildExtras].filter(requirement => !satisfied.has(requirement))
  if (skippedByHost.length > 0) {
    log(`downloading ${String(skippedByHost.length)} host-marker-skipped requirements`)
    runPython(pythonExecutable, [
      '-m', 'pip', 'download',
      ...skippedByHost,
      '-d', wheelsDir,
      '-i', index,
      '--disable-pip-version-check',
      '--only-binary', ':all:',
    ])
    for (const requirement of skippedByHost) satisfied.add(requirement)
  }
  for (let round = 1; round <= 6; round += 1) {
    const fresh = [...new Set(scanUniversalRequirements(pythonExecutable, wheelsDir)
      .filter(requirement => !satisfied.has(requirement)))]
    if (fresh.length === 0) break
    log(`downloading ${String(fresh.length)} universal-resolution requirements (round ${String(round)})`)
    runPython(pythonExecutable, [
      '-m', 'pip', 'download',
      ...fresh,
      '-d', wheelsDir,
      '-i', index,
      '--disable-pip-version-check',
      '--only-binary', ':all:',
    ])
    for (const requirement of fresh) satisfied.add(requirement)
  }
  writeFileSync(marker, `${[...satisfied].sort().join('\n')}\n`)
  const wheelCount = readdirSync(wheelsDir).filter(name => name.endsWith('.whl')).length
  if (wheelCount === 0) fail('the wheel closure download produced no wheels')
  return { requirementText: topText, universal: [...satisfied].sort(), wheels: wheelCount }
}

/** Leave an empty, warning-tagged runtime tree when the bundle is disabled. */
function ensureDisabledTree() {
  mkdirSync(outputRoot, { recursive: true })
  const marker = join(outputRoot, 'DISABLED')
  if (!existsSync(marker)) {
    writeFileSync(marker, 'DSH_DESKTOP_PYTHON_RUNTIME=0 excluded the offline Python runtime from this build.\n')
  }
  log('offline Python runtime disabled (DSH_DESKTOP_PYTHON_RUNTIME=0)')
}

export async function ensurePythonRuntime(environment = process.env) {
  if (process.platform !== 'win32') {
    fail('the offline Python runtime only supports Windows x64 packaging hosts')
  }
  if (environment.DSH_DESKTOP_PYTHON_RUNTIME === '0') {
    ensureDisabledTree()
    return { enabled: false }
  }
  mkdirSync(outputRoot, { recursive: true })
  const manifest = readManifest()
  const python = await ensurePython(manifest)
  const uv = await ensureUv(manifest)
  ensurePipLauncher()
  const wheels = await ensureWheels(manifest)
  writeManifest({ schemaVersion: 1, python, uv, wheels })
  log('offline Python runtime is ready below build/python-runtime')
  return { enabled: true }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  ensurePythonRuntime().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
