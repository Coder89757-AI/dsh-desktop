import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
// Both editions share behavior. Only release identity, launcher wording, and the
// channels' pinned core versions differ.
// The beta edition bundles an offline Python runtime that the stable edition
// does not ship, and rides dsh 0.1.6-alpha.2, whose bootstrap needs a channel
// profile adapter the stable edition's rc.2 runtime has no contract for.
const betaOnlyPaths = new Set(['desktop-python-runtime.ts', 'profile-context.ts'])
// Files that legitimately differ between the editions, each with the reason it
// is allowed to. This map is the declaration the drift check asks for — adding
// an entry is a decision to record, not a way to silence the check.
const allowedDifferences = new Map([
  ['product-identity.ts', 'the edition identity itself'],
  ['main.ts', 'the beta edition installs its offline Python runtime during startup'],
  // Beta rides dsh 0.1.6-alpha.2, whose runArgv fuses confinement preparation into the
  // execution deadline and returns { result, spawnRequested }; stable stays on
  // 0.1.5-rc.2, whose override takes an argv array and returns ShellRunResult.
  ['windows-pwsh-sandbox.ts', 'beta targets the 0.1.6-alpha.2 runArgv contract'],
  // dsh 0.1.6-alpha.2 dropped the profile patch-reload policy: `patchReload` is gone from
  // ProfileTemplate, Profile, and the profile manifest, `initProfile` takes two arguments,
  // and reload is owned by the `hmr` entry in a profile's cordis.patch.yml instead. Beta
  // follows that API; stable stays on 0.1.5-rc.2, where the field still exists.
  ['profile.ts', 'beta follows the 0.1.6-alpha.2 profile API'],
  ['profile-manager.ts', 'beta follows the 0.1.6-alpha.2 profile API'],
])
// Both editions ship the same product under a different display brand.
// User-facing copy resolves the visible name at runtime through
// brandedDisplayName(), so the editions already agree on every string a user
// reads. What still differs by brand is the documentation around the code:
// file-header comments and the native document titles carry the stable
// edition's localized name. Folding it onto the upstream name keeps this check
// about behavior drift instead of about which label a comment happens to use.
const normalizeIdentity = source => source.toString()
  .replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop')
  .replaceAll('法海问津', 'DSH Desktop')
  .replaceAll('DSH Desktop Beta', 'DSH Desktop')
// Allow only the alpha.2 bootstrap adapter calls, not arbitrary drift in these
// large shared entrypoints. Stable's rc.2 runtime has no ProfileContext contract.
const betaBootLines = new Set([
  "import { createDesktopProfileBoot } from './profile-context.ts'",
  'const profileBoot = createDesktopProfileBoot(prepared, desktopPnpmBootstrap)',
  'profileBoot.prepare(hostCtx)',
  'profileBoot.markReady()',
])
function normalizeBeta(source, path) {
  const text = normalizeIdentity(source)
  if (path !== 'main.ts' && path !== 'host-bootstrap.ts') return text
  const lines = text.split('\n')
  for (const expected of betaBootLines) {
    if (lines.filter(line => line.trim() === expected).length !== 1) {
      throw new Error(`Missing or duplicated Beta Profile adapter in ${path}: ${expected}`)
    }
  }
  return lines.filter(line => !betaBootLines.has(line.trim())).join('\n')
}

function files(directory, base = directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(path, base))
    else if (entry.isFile()) result.push(relative(base, path).split(sep).join('/'))
  }
  return result
}

const sharedPaths = new Set([...files(stableRoot), ...files(betaRoot), ...betaOnlyPaths])
const differences = []
for (const path of [...sharedPaths].sort()) {
  if (allowedDifferences.has(path)) continue
  let stable
  let beta
  try { stable = readFileSync(join(stableRoot, path)) } catch { stable = undefined }
  try { beta = readFileSync(join(betaRoot, path)) } catch { beta = undefined }
  if (betaOnlyPaths.has(path)) {
    if (stable !== undefined || beta === undefined) differences.push(`${path} (must exist only in beta)`)
    continue
  }
  if (stable === undefined || beta === undefined || normalizeIdentity(stable) !== normalizeBeta(beta, path)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size - betaOnlyPaths.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)
