/** Skill inventory and lifecycle over the same filesystem layout the upstream
 * skill-filesystem provider discovers.
 *
 * Scopes: `system` skills ship with the application (bundled root), `user`
 * skills live under `$DSH_HOME/skills` and `$DSH_AGENTS_HOME/skills`.
 *
 * Enable/disable uses a `.disabled` shadow directory per root: discovery only
 * scans the top level of each root, so entries moved one level deeper become
 * invisible to the provider, and the chokidar watcher refreshes the catalog
 * live. Bundled skills are application-owned and cannot be moved; disabling
 * one instead writes a same-named inert "shadow" user skill — user roots
 * outrank the bundled root in the registry's duplicate arbitration, and the
 * shadow's frontmatter turns off both model and user invocation. */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SkillEntry } from './contract.ts'

const SHADOW_DIR = '.disabled'
const SYSTEM_DIR = '.system'
const SHADOW_MARKER = 'dsh-skill-manager-shadow'
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const MAX_SKILL_BYTES = 1024 * 1024

export class SkillsStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillsStoreError'
  }
}

interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly shadow: boolean
}

interface SkillRoot {
  readonly path: string
  readonly scope: 'system' | 'user'
  readonly skipSystem: boolean
}

/** Filesystem-backed skill inventory and lifecycle operations. */
export class SkillsStore {
  private readonly userDshRoot: string
  private readonly userAgentsRoot: string
  private readonly bundledRoot: string | undefined

  constructor() {
    this.userDshRoot = join(resolveDshHome(), 'skills')
    this.userAgentsRoot = resolve(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'), 'skills')
    const bundled = process.env.DSH_BUNDLED_SKILL_DIR
    this.bundledRoot = bundled === undefined || bundled.length === 0 ? undefined : resolve(bundled)
  }

  /** Roots to expose in the panel. Bundled first so system skills read top-down. */
  roots(): SkillRoot[] {
    const roots: SkillRoot[] = []
    if (this.bundledRoot !== undefined) roots.push({ path: this.bundledRoot, scope: 'system', skipSystem: false })
    roots.push({ path: this.userDshRoot, scope: 'user', skipSystem: true })
    roots.push({ path: this.userAgentsRoot, scope: 'user', skipSystem: false })
    return roots
  }

  list(): SkillEntry[] {
    const entries: SkillEntry[] = []
    for (const root of this.roots()) {
      entries.push(...this.discoverRoot(root, false), ...this.discoverRoot(root, true))
    }
    // Mark bundled skills disabled by an inert shadow; hide the shadows themselves.
    const shadows = new Set(entries.filter(entry => entry.scope === 'user' && this.isShadow(entry)).map(entry => entry.name))
    return entries
      .filter(entry => !(entry.scope === 'user' && this.isShadow(entry)))
      .map(entry => entry.scope === 'system' && shadows.has(entry.name) ? { ...entry, enabled: false } : entry)
  }

  async toggle(name: string, scope: 'system' | 'user', enabled: boolean): Promise<void> {
    if (scope === 'system') {
      this.toggleSystem(name, enabled)
      return
    }
    const entry = this.list().find(item => item.name === name && item.scope === 'user')
    if (entry === undefined) throw new SkillsStoreError(`user skill ${name} is not installed`)
    if (entry.enabled === enabled) return
    const root = this.containingRoot(entry.path)
    if (root === undefined) throw new SkillsStoreError(`skill ${name} is outside the managed skill roots`)
    if (enabled) {
      this.moveWithinRoot(join(root, SHADOW_DIR, this.leafName(entry)), join(root, this.leafName(entry)))
    } else {
      const shadowRoot = join(root, SHADOW_DIR)
      mkdirSync(shadowRoot, { recursive: true })
      this.moveWithinRoot(join(root, this.leafName(entry)), join(shadowRoot, this.leafName(entry)))
    }
  }

  async save(name: string, content: string): Promise<void> {
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new SkillsStoreError('skill name must be lowercase letters, digits, and hyphens')
    }
    if (content.length > MAX_SKILL_BYTES) throw new SkillsStoreError('skill content exceeds the supported size')
    const parsed = parseSkillFileContent(content)
    if (parsed === undefined) throw new SkillsStoreError('content must start with YAML frontmatter delimiters (---)')
    if (parsed.name !== name) throw new SkillsStoreError(`frontmatter name "${parsed.name}" does not match "${name}"`)
    if (parsed.description.length === 0) throw new SkillsStoreError('frontmatter requires a description')
    const target = join(this.userDshRoot, name)
    // A same-named disabled copy moves back into place instead of being shadowed by the new file.
    if (!existsSync(target) && existsSync(join(this.userDshRoot, SHADOW_DIR, name))) {
      this.moveWithinRoot(join(this.userDshRoot, SHADOW_DIR, name), target)
    }
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 })
  }

  async remove(name: string): Promise<void> {
    const entry = this.list().find(item => item.name === name && item.scope === 'user')
    if (entry === undefined) throw new SkillsStoreError(`user skill ${name} is not installed`)
    const root = this.containingRoot(entry.path)
    if (root === undefined) throw new SkillsStoreError(`skill ${name} is outside the managed skill roots`)
    const target = entry.enabled ? join(root, this.leafName(entry)) : join(root, SHADOW_DIR, this.leafName(entry))
    rmSync(this.assertUnderRoot(target, root), { recursive: true, force: true })
  }

  async importFrom(sourceDir: string): Promise<string[]> {
    const source = resolve(sourceDir)
    let entries
    try {
      entries = readdirSync(source, { withFileTypes: true })
    } catch {
      throw new SkillsStoreError(`cannot read directory ${source}`)
    }
    const existing = new Set(this.list().map(entry => entry.name))
    const imported: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const from = join(source, entry.name)
      if (entry.isDirectory()) {
        if (!existsSync(join(from, 'SKILL.md'))) continue
        const parsed = parseSkillFile(join(from, 'SKILL.md'))
        if (parsed === undefined) continue
        if (existing.has(parsed.name)) throw new SkillsStoreError(`a skill named ${parsed.name} already exists`)
        cpSync(from, join(this.userDshRoot, entry.name), { recursive: true, dereference: true })
        existing.add(parsed.name)
        imported.push(parsed.name)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const parsed = parseSkillFile(from)
        if (parsed === undefined) continue
        if (existing.has(parsed.name)) throw new SkillsStoreError(`a skill named ${parsed.name} already exists`)
        cpSync(from, join(this.userDshRoot, entry.name), { dereference: true })
        existing.add(parsed.name)
        imported.push(parsed.name)
      }
    }
    if (imported.length === 0) throw new SkillsStoreError('no skill files found under the chosen directory')
    return imported
  }

  read(name: string, scope: 'system' | 'user'): { content: string, readOnly: boolean } {
    const entry = this.list().find(item => item.name === name && item.scope === scope)
    if (entry === undefined) throw new SkillsStoreError(`skill ${name} (${scope}) is not installed`)
    let content: string
    try {
      content = readFileSync(entry.path, 'utf8')
    } catch {
      throw new SkillsStoreError(`skill file ${entry.path} is not readable`)
    }
    if (content.length > MAX_SKILL_BYTES) throw new SkillsStoreError('skill content exceeds the supported size')
    return { content, readOnly: scope === 'system' }
  }

  private toggleSystem(name: string, enabled: boolean): void {
    const shadowDir = join(this.userDshRoot, name)
    if (!enabled) {
      if (existsSync(shadowDir)) {
        if (!this.isShadowPath(shadowDir)) {
          throw new SkillsStoreError(`a user skill named ${name} already exists; remove it to disable the system skill`)
        }
        return
      }
      mkdirSync(shadowDir, { recursive: true })
      writeFileSync(
        join(shadowDir, 'SKILL.md'),
        [
          '---',
          `name: ${name}`,
          'description: inert shadow disabling a bundled skill',
          'disable-model-invocation: true',
          'user-invocable: false',
          'metadata:',
          `  ${SHADOW_MARKER}: true`,
          '---',
          '',
        ].join('\n'),
        { mode: 0o600 },
      )
      return
    }
    if (!existsSync(shadowDir)) return
    if (!this.isShadowPath(shadowDir)) {
      throw new SkillsStoreError(`${name} is a real user skill, not a disable marker`)
    }
    rmSync(shadowDir, { recursive: true, force: true })
  }

  private isShadow(entry: SkillEntry): boolean {
    return this.isShadowPath(dirname(entry.path))
  }

  private isShadowPath(directory: string): boolean {
    const skillFile = join(directory, 'SKILL.md')
    if (!existsSync(skillFile)) return false
    const parsed = parseSkillFile(skillFile)
    return parsed?.shadow === true
  }

  private leafName(entry: SkillEntry): string {
    return entry.kind === 'directory' ? basename(dirname(entry.path)) : basename(entry.path)
  }

  private containingRoot(entryPath: string): string | undefined {
    return this.roots().map(root => root.path).find(root => this.isUnder(entryPath, root) || this.isUnder(entryPath, join(root, SHADOW_DIR)))
  }

  private assertUnderRoot(path: string, root: string): string {
    if (!this.isUnder(path, root)) throw new SkillsStoreError('path escaped the skill root')
    return path
  }

  private isUnder(path: string, root: string): boolean {
    const relative = resolve(path).slice(resolve(root).length)
    return relative.startsWith('/') || relative.startsWith('\\')
  }

  private moveWithinRoot(from: string, to: string): void {
    if (!existsSync(from)) throw new SkillsStoreError(`expected skill entry is missing: ${from}`)
    if (existsSync(to)) throw new SkillsStoreError(`target already exists: ${to}`)
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
  }

  private discoverRoot(root: SkillRoot, disabled: boolean): SkillEntry[] {
    const base = disabled ? join(root.path, SHADOW_DIR) : root.path
    let entries
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      return []
    }
    const result: SkillEntry[] = []
    for (const entry of entries) {
      if (entry.name === SYSTEM_DIR && root.skipSystem && !disabled) continue
      if (entry.name === SHADOW_DIR) continue
      const path = join(base, entry.name)
      let skillPath: string | undefined
      let kind: 'directory' | 'flat' | undefined
      if (entry.isDirectory()) {
        skillPath = join(path, 'SKILL.md')
        kind = 'directory'
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        skillPath = path
        kind = 'flat'
      }
      if (skillPath === undefined || kind === undefined || !existsSync(skillPath)) continue
      const parsed = parseSkillFile(skillPath)
      if (parsed === undefined) continue
      result.push({
        name: parsed.name,
        description: parsed.description,
        scope: root.scope,
        enabled: !disabled,
        kind,
        path: skillPath,
      })
    }
    return result
  }
}

function parseSkillFile(path: string): ParsedSkillFile | undefined {
  try {
    return parseSkillFileContent(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Minimal frontmatter reader aligned with the upstream provider's rules:
 * a leading `---` block with string `name` and `description`. */
export function parseSkillFileContent(raw: string): ParsedSkillFile | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/u, '') !== '---') return undefined
  let cursor = firstLineEnd + 1
  for (;;) {
    const nextNewline = raw.indexOf('\n', cursor)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(cursor, lineEnd).replace(/\r$/u, '') === '---') {
      let data: unknown
      try {
        data = parseYaml(raw.slice(firstLineEnd + 1, cursor)) as unknown
      } catch {
        return undefined
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
      const document = data as Record<string, unknown>
      const name = document.name
      const description = document.description
      if (typeof name !== 'string' || name.length === 0 || typeof description !== 'string') return undefined
      if (!SKILL_NAME_PATTERN.test(name)) return undefined
      const metadata = document.metadata
      const shadow = typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
        && (metadata as Record<string, unknown>)[SHADOW_MARKER] === true
      return { name, description, shadow }
    }
    if (nextNewline < 0) return undefined
    cursor = nextNewline + 1
  }
}

/** Exposed for tests: the user roots this store manages. */
export function managedUserRoots(): readonly string[] {
  const store = new SkillsStore()
  return store.roots().filter(root => root.scope === 'user').map(root => root.path)
}
