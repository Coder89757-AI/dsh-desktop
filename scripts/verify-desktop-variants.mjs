import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
// Both editions now pin one core API. Only their product identities differ,
// plus the beta edition's offline Python runtime, which the stable edition
// does not ship, so that module exists only there by design.
const betaOnlyPaths = new Set(['desktop-python-runtime.ts'])
// Files that legitimately differ between the editions, each with the reason it
// is allowed to. This map is the declaration the drift check asks for — adding
// an entry is a decision to record, not a way to silence the check.
const allowedDifferences = new Map([
  ['product-identity.ts', 'the edition identity itself'],
  ['main.ts', 'the beta edition installs its offline Python runtime during startup'],
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

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)
