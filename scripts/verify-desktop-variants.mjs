import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
// Both editions share behavior. Only release identity and launcher wording differ.
// The beta edition bundles an offline Python runtime that the stable edition
// does not ship, so this module exists only there by design.
const betaOnlyPaths = new Set(['desktop-python-runtime.ts'])
// Files that legitimately differ between the editions, each with the reason it
// is allowed to. This map is the declaration the drift check asks for — adding
// an entry is a decision to record, not a way to silence the check.
const allowedDifferences = new Map([
  ['product-identity.ts', 'the edition identity itself'],
  ['main.ts', 'the beta edition installs its offline Python runtime during startup'],
  ['electron-runtime.ts', 'the beta edition keeps the full tray menu; the stable edition ships Quit only'],
])
// Both editions ship the same product under a different display brand: the
// stable edition carries the localized one, the beta edition the upstream one.
// Folding the localized name onto the upstream one keeps this check about
// behavior drift instead of about which label a user-facing string happens to
// use, and it is the same trade the two rewrites above already make.
const normalizeIdentity = source => source.toString()
  .replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop')
  // Localized brand first, then the Beta suffix: the stable edition writes
  // "法海问津 Beta" where the beta edition writes "DSH Desktop Beta", so
  // collapsing the brand before the suffix is what lands both on one string.
  .replaceAll('法海问津', 'DSH Desktop')
  .replaceAll('DSH Desktop Beta', 'DSH Desktop')

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
  if (stable === undefined || beta === undefined || normalizeIdentity(stable) !== normalizeIdentity(beta)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size - betaOnlyPaths.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)
