/**
 * Headless probe — `ctx.credentials` 的读写往返与落盘形态。
 *
 * 回答的问题（auth-gate 评估 §4.2 / §6 未列入但必须确认）：
 *   1. `GrantRecord.payload` 能否承载任意 JSON（token 对象）并按原样读回？
 *   2. 落盘文件在哪、是什么格式、**是否加密**？
 *   3. 跨 owner / 跨 scope 的可见性 —— 别的插件能否 `readRecord` 到我的 token？
 *   4. 文件权限（Windows ACL 无法用 posix mode 判断，但至少看是否设了 mode）。
 *
 * 安全：全程在**临时 DSH_HOME** 下进行，不触碰用户真实的 `~/.dsh`。
 *
 * 用法：node scripts/probe-credentials.mjs
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

const BIN_NAME = 'dsh-credentials-probe'
const MODULE_BASE = pathToFileURL(fileURLToPath(new URL('../package.json', import.meta.url))).href

const home = mkdtempSync(join(tmpdir(), 'dsh-credentials-probe-'))
// dsh-credentials-local 以 $DSH_HOME 为根；把它指向临时目录，避免污染真实配置。
process.env.DSH_HOME = home

const TOKEN_PAYLOAD = {
  accessToken: 'probe-access-token-DO-NOT-LOG',
  refreshToken: 'probe-refresh-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
  serverAddress: 'https://probe.invalid',
  username: 'probe-user',
  nested: { scopes: ['read', 'write'], n: 42, flag: true },
}

const report = { home, probes: {} }
let host

// boot() 需要一个 root 配置文件；空树即可，待测行由 insert patch 挂上。
const rootConfig = join(home, 'root.yml')
writeFileSync(rootConfig, '[]\n')

/** 递归列出 home 下的文件（含大小/权限），最多 40 条。 */
const walk = (dir, depth = 0, out = []) => {
  if (depth > 3 || out.length > 40) return out
  let items = []
  try {
    items = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    const full = join(dir, item.name)
    if (item.isDirectory()) walk(full, depth + 1, out)
    else {
      const stat = statSync(full)
      out.push({ path: full.replace(home, '$DSH_HOME'), bytes: stat.size, mode: (stat.mode & 0o777).toString(8) })
    }
  }
  return out
}

try {
  host = await boot(
    BIN_NAME,
    rootConfig,
    [{ insert: [
      // `dsh-credentials-local` 的 LocalCredentialProvider 继承自 dsh-credentials 的
      // CredentialProvider 并自行 provide `credentials` 服务 —— 两个包各插一行会撞
      // "service credentials has been registered"，所以只插 provider 包。
      { id: 'credentials-local', name: '@deepseek-ai/dsh-credentials-local' },
    ] }],
    () => {},
    MODULE_BASE,
  )

  const credentials = host.credentials
  report.servicePresent = credentials !== undefined
  report.serviceMethods = credentials
    ? Object.getOwnPropertyNames(Object.getPrototypeOf(credentials)).filter((k) => k !== 'constructor')
    : null

  const KEY = credentialKey('probe-plugin', 'session')

  // ── 探针 A：写入 → 读回（GrantRecord.payload 的 JSON 往返）──────────────
  report.probes.writeRead = await (async () => {
    try {
      const written = await credentials.modifyRecord(KEY, async (current) => ({
        kind: 'grant',
        payload: { ...TOKEN_PAYLOAD, previousExisted: current !== undefined },
      }))
      const record = await credentials.readRecord(KEY)
      return {
        key: String(KEY),
        writtenKind: written?.kind ?? null,
        readKind: record?.kind ?? null,
        roundTripExact: JSON.stringify(record?.payload) === JSON.stringify({ ...TOKEN_PAYLOAD, previousExisted: false }),
      }
    } catch (error) {
      return { error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
    }
  })()

  // ── 探针 B：记录空间是否有身份隔离 ────────────────────────────────────
  // readRecord 的签名里**没有任何调用方身份参数** —— 用两个不同 scope 的 key
  // 各读一次，并列出全部记录，看"别的插件写的记录"是否也在同一个命名空间里。
  report.probes.recordSpaceIsolation = await (async () => {
    try {
      // 用第二个 scope 写一条，模拟"另一个插件"的记录
      await credentials.modifyRecord(credentialKey('other-plugin', 'session'), async () => ({
        kind: 'grant',
        payload: { marker: 'written-by-other-scope' },
      }))
      const mine = await credentials.readRecord(KEY)
      const foreign = await credentials.readRecord(credentialKey('other-plugin', 'session'))
      const listed = await credentials.listRecords()
      const described = await credentials.describeRecord(KEY)
      return {
        // 同一 ctx 能读到另一 scope 的记录 → 记录空间对调用方不设隔离
        foreignReadableFromSameContext: foreign !== undefined,
        foreignPayload: foreign?.payload ?? null,
        mineStillReadable: mine !== undefined,
        listRecords: listed.map((entry) => String(entry.key)),
        // describe 是否泄露值 —— 期望：不含任何 value 字段
        describeKeys: described ? Object.keys(described).sort() : null,
        describeLeaksValue: JSON.stringify(described ?? {}).includes('probe-access-token'),
      }
    } catch (error) {
      return { error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
    }
  })()

  // ── 探针 C：删除往返 ─────────────────────────────────────────────────
  report.probes.deleteRoundTrip = await (async () => {
    try {
      await credentials.deleteRecord(credentialKey('other-plugin', 'session'))
      const after = await credentials.readRecord(credentialKey('other-plugin', 'session'))
      return { removed: after === undefined, afterValue: after ?? null }
    } catch (error) {
      return { error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
    }
  })()

  // ── 探针 C：落盘形态（路径 / 格式 / 是否明文 / 权限）──────────────────
  report.probes.persisted = (() => {
    const files = walk(home)
    const candidates = files.filter((f) => /credential|secret|token/i.test(f.path))
    return {
      dshHomeFiles: files,
      credentialFiles: candidates,
      // 直接看内容里能否搜到明文 token 片段 —— 这是"是否加密"的直接判据
      plaintextHits: candidates
        .map((f) => {
          try {
            const text = readFileSync(join(home, f.path.replace('$DSH_HOME', '')), 'utf8')
            return { path: f.path, containsAccessToken: text.includes('probe-access-token'), preview: text.slice(0, 300) }
          } catch {
            return { path: f.path, unreadable: true }
          }
        }),
    }
  })()
} catch (error) {
  report.fatal = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`
  report.fatalStack = String(error?.stack ?? '').split('\n').slice(0, 8)
} finally {
  try {
    await host?.fiber.dispose()
  } catch {}
}

console.log(JSON.stringify(report, null, 2))

// 结束后清理临时 home（保留一个开关便于人工查看）
if (process.env.KEEP_PROBE_HOME !== '1') rmSync(home, { recursive: true, force: true })
else console.log(`\n[kept] probe home: ${home}`)
