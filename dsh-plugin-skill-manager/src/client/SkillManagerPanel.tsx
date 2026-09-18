/**
 * Skill-manager settings section: MCP servers and skills in two tabs.
 *
 * The layout follows the shipped Plugins settings page: a titled section, an
 * underline tab strip, and one card per configured thing — every row expands in
 * place into its own editor instead of replacing the list, so which entry is
 * being worked on stays visible while the form is open.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServerEntry, McpToolInfo, McpToolSource, SkillEntry } from '../host/contract.ts'
import type { SkillManagerApi } from './skill-manager-api.ts'
import type { SkillManagerLocaleKey } from './skill-manager-locales.ts'

export interface SkillManagerInjected {
  readonly api: SkillManagerApi
}

export type SkillManagerSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skill-manager'>
  & InjectFace<SkillManagerInjected>

interface Notice {
  readonly kind: 'ok' | 'error'
  readonly text: string
}

type Tab = 'mcp' | 'skills'
type Translate = (key: SkillManagerLocaleKey) => string
type Run = (action: () => Promise<string | void>) => Promise<boolean>
type Report = (notice: Notice) => void

/** Sentinel editor key for the not-yet-saved server card. */
const NEW_ENTRY_KEY = '\u0000new'

/**
 * Flatten an error and its `cause` chain into one line. The Host wraps every
 * failed MCP handshake in a generic message and keeps the real reason — an
 * HTTP status, a rejected token, a refused socket — on `cause`, so reporting
 * only `message` hides the one fact the user needs.
 */
function errorText(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback
  const parts: string[] = []
  // Bounded: a cause chain that loops must not hang the panel.
  let current: unknown = cause
  while (current instanceof Error && parts.length < 4) {
    if (current.message.length > 0 && !parts.includes(current.message)) parts.push(current.message)
    current = current.cause
  }
  return parts.length > 0 ? parts.join(' — ') : fallback
}

export function SkillManagerSection(props: SkillManagerSectionProps) {
  const { api, t } = props
  const [tab, setTab] = useState<Tab>('mcp')
  const [servers, setServers] = useState<readonly McpServerEntry[]>()
  const [skills, setSkills] = useState<readonly SkillEntry[]>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await api.state()
    setServers(next.mcpServers)
    setSkills(next.skills)
  }, [api])

  useEffect(() => {
    refresh().catch(() => { setLoadFailed(true) })
  }, [refresh])

  // The action's own success value is its detail line; a rejection is already
  // localized by the caller, so `run` only decides which palette to use.
  const run = useCallback(async (action: () => Promise<string | void>): Promise<boolean> => {
    setNotice(null)
    setBusy(true)
    try {
      const detail = await action()
      await refresh()
      setNotice({ kind: 'ok', text: detail === undefined || detail === '' ? t('savedOk') : detail })
      return true
    } catch (cause) {
      setNotice({ kind: 'error', text: errorText(cause, t('unknownError')) })
      return false
    } finally {
      setBusy(false)
    }
  }, [refresh, t])

  const report = useCallback<Report>((next) => { setNotice(next) }, [])

  const pickDirectory = useCallback(async (): Promise<string | null> => {
    try {
      return await api.pickDirectory()
    } catch {
      setNotice({ kind: 'error', text: t('pickFailed') })
      return null
    }
  }, [api, t])

  const panelId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const tabs: readonly (readonly [Tab, SkillManagerLocaleKey])[] = [
    ['mcp', 'tabMcp'],
    ['skills', 'tabSkills'],
  ]

  const select = (next: Tab): void => {
    setTab(next)
    setNotice(null)
  }

  const ready = servers !== undefined && skills !== undefined

  return (
    <section className="dshSkillManagerSection">
      <h2 className="dshSkillManagerTitle">{t('title')}</h2>
      <p className="dshSkillManagerIntro">{t('intro')}</p>
      <div className="dshSkillManagerTabs" role="tablist" aria-label={t('title')}>
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            ref={(element) => { tabRefs.current[index] = element }}
            id={`${panelId}-tab-${id}`}
            type="button"
            role="tab"
            className="dshSkillManagerTab"
            data-active={tab === id}
            aria-selected={tab === id}
            aria-controls={`${panelId}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => { select(id) }}
            onKeyDown={(event) => {
              let nextIndex: number
              switch (event.key) {
                case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break
                case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break
                case 'Home': nextIndex = 0; break
                case 'End': nextIndex = tabs.length - 1; break
                default: return
              }
              event.preventDefault()
              const next = tabs[nextIndex]
              if (next === undefined) return
              select(next[0])
              tabRefs.current[nextIndex]?.focus()
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {!ready && !loadFailed && <p className="dshSkillManagerStatus">{t('loading')}</p>}
      {loadFailed && <NoticeBlock notice={{ kind: 'error', text: t('loadFailed') }} />}
      {notice !== null && <NoticeBlock notice={notice} />}
      {ready && !loadFailed && (
        <div
          className="dshSkillManagerPanel"
          id={`${panelId}-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`${panelId}-tab-${tab}`}
        >
          {tab === 'mcp'
            ? <McpTab api={api} t={t} servers={servers} busy={busy} run={run} />
            : <SkillsTab api={api} t={t} skills={skills} busy={busy} run={run} report={report} pickDirectory={pickDirectory} />}
        </div>
      )}
    </section>
  )
}

/** Status or failure line, tinted by kind. */
function NoticeBlock(props: { readonly notice: Notice }) {
  return (
    <p
      className="dshSkillManagerNotice"
      data-kind={props.notice.kind}
      role={props.notice.kind === 'error' ? 'alert' : 'status'}
    >
      {props.notice.text}
    </p>
  )
}

/** Read-only capsule badge; the tone selects the palette. */
function StateTag(props: { readonly tone: 'outline' | 'neutral' | 'success', readonly children: ReactNode }) {
  return <span className="dshSkillManagerTag" data-tone={props.tone}>{props.children}</span>
}

/** Two-state toggle; the accessible name is required at every render site. */
function Toggle(props: {
  readonly checked: boolean
  readonly disabled: boolean
  readonly label: string
  readonly onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      className="dshSkillManagerSwitch"
      onClick={() => { props.onChange(!props.checked) }}
    >
      <span className="dshSkillManagerSwitchThumb" />
    </button>
  )
}

/** Inline destructive confirmation, replacing the browser's own dialog. */
function ConfirmBar(props: {
  readonly question: string
  readonly busy: boolean
  readonly t: Translate
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  return (
    <div className="dshSkillManagerConfirm" role="group" aria-label={props.question}>
      <span className="dshSkillManagerConfirmText">{props.question}</span>
      <button
        type="button"
        className="dshSkillManagerBtn"
        data-size="sm"
        data-variant="danger"
        disabled={props.busy}
        onClick={props.onConfirm}
      >
        {props.t('confirmYes')}
      </button>
      <button
        type="button"
        className="dshSkillManagerBtn"
        data-size="sm"
        data-variant="secondary"
        disabled={props.busy}
        onClick={props.onCancel}
      >
        {props.t('cancel')}
      </button>
    </div>
  )
}

interface McpFormState {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command: string
  readonly args: string
  readonly env: string
  readonly cwd: string
  readonly url: string
  readonly headers: string
}

interface McpEditorState {
  readonly mode: 'form' | 'json'
  readonly form: McpFormState
  readonly json: string
}

interface OpenMcpEditor {
  /** Editor key: the saved server name, or `NEW_ENTRY_KEY` while creating. */
  readonly key: string
  readonly state: McpEditorState
}

type ToolsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ok', readonly source: McpToolSource, readonly tools: readonly McpToolInfo[] }
  | { readonly status: 'error', readonly detail: string }

const EMPTY_MCP_FORM: McpFormState = {
  serverName: '', transport: 'stdio', command: '', args: '', env: '', cwd: '', url: '', headers: '',
}

const MCP_JSON_TEMPLATE = `${JSON.stringify({
  serverName: 'my-server',
  transport: 'stdio',
  enabled: true,
  command: 'npx',
  args: ['-y', 'some-mcp-server'],
  env: {},
}, undefined, 2)}\n`

function entryToJson(entry: McpServerEntry): string {
  return `${JSON.stringify(entry, undefined, 2)}\n`
}

/** The transport target shown on a collapsed card. */
function serverTarget(server: McpServerEntry): string {
  if (server.transport === 'streamable-http') return server.url ?? ''
  return [server.command ?? '', ...(server.args ?? [])].join(' ').trim()
}

function parseKeyValueLines(raw: string, separator: RegExp): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const index = trimmed.search(separator)
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index).replace(separator, '').trim()
    if (key.length > 0) result[key] = value
  }
  return result
}

function toFormState(server: McpServerEntry): McpFormState {
  return {
    serverName: server.serverName,
    transport: server.transport,
    command: server.command ?? '',
    args: (server.args ?? []).join('\n'),
    env: Object.entries(server.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    cwd: server.cwd ?? '',
    url: server.url ?? '',
    headers: Object.entries(server.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n'),
  }
}

function toServerEntry(form: McpFormState): McpServerEntry {
  const args = form.args.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0)
  return form.transport === 'stdio'
    ? {
      serverName: form.serverName.trim(),
      transport: 'stdio',
      enabled: true,
      command: form.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      env: parseKeyValueLines(form.env, /=/u),
      ...(form.cwd.trim().length > 0 ? { cwd: form.cwd.trim() } : {}),
    }
    : {
      serverName: form.serverName.trim(),
      transport: 'streamable-http',
      enabled: true,
      url: form.url.trim(),
      headers: parseKeyValueLines(form.headers, /:\s*/u),
    }
}

/** Transport kinds the Host accepts; anything else is reported, never coerced. */
function readTransport(value: unknown): McpServerEntry['transport'] | null {
  return value === 'stdio' || value === 'streamable-http' ? value : null
}

/** Keep the string-valued entries of a JSON object; anything else is dropped. */
function stringMapOf(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}

/**
 * Project a JSON entry onto the form's fields, or `null` when the value is not
 * an entry this editor can present.
 *
 * Only the JSON → form switch uses this. Submitting the JSON editor sends the
 * parsed value to the Host untouched: a projection covers the form's fields
 * only, so routing a save through one would silently drop `headers` and `env`.
 */
function toFormEntry(value: unknown): McpServerEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const transport = readTransport(record.transport)
  if (transport === null) return null
  return {
    serverName: typeof record.serverName === 'string' ? record.serverName : '',
    transport,
    enabled: true,
    ...(typeof record.command === 'string' ? { command: record.command } : {}),
    ...(Array.isArray(record.args) && record.args.every(item => typeof item === 'string') ? { args: record.args as string[] } : {}),
    env: stringMapOf(record.env),
    ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
    headers: stringMapOf(record.headers),
  }
}

function McpTab(props: {
  readonly api: SkillManagerApi
  readonly t: Translate
  readonly servers: readonly McpServerEntry[]
  readonly busy: boolean
  readonly run: Run
}) {
  const { api, t, servers, busy, run } = props
  const [editing, setEditing] = useState<OpenMcpEditor | null>(null)
  const [editorNotice, setEditorNotice] = useState<Notice | null>(null)
  /** Server whose removal is awaiting confirmation, independent of the editor. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [tools, setTools] = useState<ToolsState | null>(null)

  /** Read one entry's tool catalog; a failure lands in the section, not the page. */
  const loadTools = (entry: McpServerEntry, probe: boolean): void => {
    setTools({ status: 'loading' })
    void (async () => {
      try {
        const result = await api.listTools(entry, probe)
        setTools(result.ok
          ? { status: 'ok', source: result.source ?? 'probe', tools: result.tools }
          : { status: 'error', detail: result.detail })
      } catch (cause) {
        setTools({ status: 'error', detail: errorText(cause, t('unknownError')) })
      }
    })()
  }

  const closeEditor = (): void => {
    setEditing(null)
    setEditorNotice(null)
    setConfirming(null)
    setTools(null)
  }

  const openEditor = (entry: McpServerEntry | null): void => {
    setEditorNotice(null)
    setConfirming(null)
    const key = entry === null ? NEW_ENTRY_KEY : entry.serverName
    if (editing?.key === key) { closeEditor(); return }
    setEditing({
      key,
      state: entry === null
        ? { mode: 'form', form: EMPTY_MCP_FORM, json: MCP_JSON_TEMPLATE }
        : { mode: 'form', form: toFormState(entry), json: entryToJson(entry) },
    })
    // A saved server's catalog is worth showing the moment its editor opens;
    // the unsaved new-entry card has nothing configured to ask yet.
    if (entry === null) setTools(null)
    else loadTools(entry, false)
  }

  const setState = (next: McpEditorState): void => {
    setEditing(current => current === null ? null : { ...current, state: next })
  }

  const patchForm = (patch: Partial<McpFormState>): void => {
    setEditing(current => current === null
      ? null
      : { ...current, state: { ...current.state, form: { ...current.state.form, ...patch } } })
  }

  const switchMode = (mode: 'form' | 'json'): void => {
    if (editing === null || editing.state.mode === mode) return
    setEditorNotice(null)
    if (mode === 'json') {
      setState({ ...editing.state, mode, json: entryToJson(toServerEntry(editing.state.form)) })
      return
    }
    const parsed = readJsonEntry(editing.state.json)
    if (parsed === undefined) return
    const entry = toFormEntry(parsed)
    if (entry === null) {
      setEditorNotice({ kind: 'error', text: t('mcpTransportUnsupported') })
      return
    }
    setState({ ...editing.state, mode, form: toFormState(entry) })
  }

  /** Parse the JSON editor, reporting the reason when it cannot be read. */
  function readJsonEntry(raw: string): unknown {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      setEditorNotice({ kind: 'error', text: `${t('mcpJsonInvalid')}: ${errorText(cause, '')}` })
      return undefined
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setEditorNotice({ kind: 'error', text: t('mcpJsonNotObject') })
      return undefined
    }
    return parsed
  }

  /** Read the editor into an entry, or report why it cannot be read. */
  const readEntry = (state: McpEditorState): McpServerEntry | null => {
    if (state.mode === 'form') return toServerEntry(state.form)
    const parsed = readJsonEntry(state.json)
    if (parsed === undefined) return null
    const record = parsed as Record<string, unknown>
    if (readTransport(record.transport) === null) {
      setEditorNotice({ kind: 'error', text: t('mcpTransportUnsupported') })
      return null
    }
    // The JSON editor owns the raw entry shape, so the value goes to the Host
    // exactly as written — including `headers` and `env`, which the form sees
    // as text lines. The Host revalidates every field on save and on probe.
    return record as unknown as McpServerEntry
  }

  const submit = (): void => {
    if (editing === null) return
    const entry = readEntry(editing.state)
    if (entry === null) return
    void (async () => {
      if (await run(async () => { await api.saveServer(entry) })) closeEditor()
    })()
  }

  const test = (): void => {
    if (editing === null || testing) return
    const entry = readEntry(editing.state)
    if (entry === null) return
    setEditorNotice(null)
    setTesting(true)
    void (async () => {
      try {
        const result = await api.testServer(entry)
        setEditorNotice({ kind: result.ok ? 'ok' : 'error', text: result.detail })
      } catch (cause) {
        setEditorNotice({ kind: 'error', text: errorText(cause, t('unknownError')) })
      } finally {
        setTesting(false)
      }
    })()
  }

  /** The server's tool catalog: live tools when it runs, a probe otherwise. */
  const renderTools = (): ReactNode => {
    if (tools === null) return null
    return (
      <div className="dshSkillManagerTools">
        <div className="dshSkillManagerToolsHead">
          <span className="dshSkillManagerToolsTitle">{t('mcpTools')}</span>
          {tools.status === 'ok' && (
            <>
              <span className="dshSkillManagerGroupCount">{`· ${String(tools.tools.length)}`}</span>
              <StateTag tone="neutral">
                {tools.source === 'running' ? t('mcpToolsRunning') : t('mcpToolsProbe')}
              </StateTag>
            </>
          )}
          <span className="dshSkillManagerFooterSpacer" />
          <button
            type="button" className="dshSkillManagerBtn" data-size="sm" data-variant="secondary"
            disabled={busy || tools.status === 'loading'}
            onClick={() => {
              // Refresh asks about the editor's current entry, so it always
              // probes: a live instance would answer for the saved config.
              const entry = editing === null ? null : readEntry(editing.state)
              if (entry !== null) loadTools(entry, true)
            }}
          >
            {t('mcpToolsRefresh')}
          </button>
        </div>
        {tools.status === 'loading' && <p className="dshSkillManagerStatus">{t('mcpToolsLoading')}</p>}
        {tools.status === 'error' && <NoticeBlock notice={{ kind: 'error', text: tools.detail }} />}
        {tools.status === 'ok' && tools.tools.length === 0 && (
          <p className="dshSkillManagerEmpty">{t('mcpToolsEmpty')}</p>
        )}
        {tools.status === 'ok' && tools.tools.length > 0 && (
          <ul className="dshSkillManagerToolsList">
            {tools.tools.map(tool => (
              <li key={tool.name} className="dshSkillManagerTool">
                <span className="dshSkillManagerToolName">{tool.name}</span>
                {tool.description === '' ? null : (
                  <span className="dshSkillManagerToolDesc">
                    {tool.description.replace(/\s+/gu, ' ').trim()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const renderEditor = (state: McpEditorState): ReactNode => (
    <>
      <div className="dshSkillManagerModes" role="tablist" aria-label={t('mcpEdit')}>
        <button
          type="button" role="tab" className="dshSkillManagerModeBtn" data-active={state.mode === 'form'}
          aria-selected={state.mode === 'form'} onClick={() => { switchMode('form') }}
        >
          {t('mcpModeForm')}
        </button>
        <button
          type="button" role="tab" className="dshSkillManagerModeBtn" data-active={state.mode === 'json'}
          aria-selected={state.mode === 'json'} onClick={() => { switchMode('json') }}
        >
          {t('mcpModeJson')}
        </button>
      </div>
      {editorNotice !== null && <NoticeBlock notice={editorNotice} />}
      {state.mode === 'json' ? (
        <label className="dshSkillManagerField">
          <span className="dshSkillManagerFieldLabel">{t('mcpJsonHint')}</span>
          <textarea
            className="dshSkillManagerTextarea" data-size="tall" value={state.json} spellCheck={false}
            onChange={event => { setState({ ...state, json: event.target.value }) }}
          />
        </label>
      ) : (
        <>
          <label className="dshSkillManagerField">
            <span className="dshSkillManagerFieldLabel">{t('mcpServerName')}</span>
            <input
              className="dshSkillManagerInput" value={state.form.serverName}
              onChange={event => { patchForm({ serverName: event.target.value }) }}
            />
          </label>
          <label className="dshSkillManagerField">
            <span className="dshSkillManagerFieldLabel">{t('mcpTransportLabel')}</span>
            <select
              className="dshSkillManagerSelect" value={state.form.transport}
              onChange={event => { patchForm({ transport: event.target.value as McpFormState['transport'] }) }}
            >
              <option value="stdio">stdio</option>
              <option value="streamable-http">streamable-http</option>
            </select>
          </label>
          {state.form.transport === 'stdio' ? (
            <>
              <label className="dshSkillManagerField">
                <span className="dshSkillManagerFieldLabel">{t('mcpCommand')}</span>
                <input
                  className="dshSkillManagerInput" value={state.form.command}
                  onChange={event => { patchForm({ command: event.target.value }) }}
                />
              </label>
              <label className="dshSkillManagerField">
                <span className="dshSkillManagerFieldLabel">{t('mcpArgs')}</span>
                <textarea
                  className="dshSkillManagerTextarea" value={state.form.args}
                  onChange={event => { patchForm({ args: event.target.value }) }}
                />
              </label>
              <label className="dshSkillManagerField">
                <span className="dshSkillManagerFieldLabel">{t('mcpEnv')}</span>
                <textarea
                  className="dshSkillManagerTextarea" value={state.form.env}
                  onChange={event => { patchForm({ env: event.target.value }) }}
                />
              </label>
              <label className="dshSkillManagerField">
                <span className="dshSkillManagerFieldLabel">{t('mcpCwd')}</span>
                <input
                  className="dshSkillManagerInput" value={state.form.cwd}
                  onChange={event => { patchForm({ cwd: event.target.value }) }}
                />
              </label>
            </>
          ) : (
            <>
              <label className="dshSkillManagerField">
                <span className="dshSkillManagerFieldLabel">{t('mcpUrl')}</span>
                <input
                  className="dshSkillManagerInput" value={state.form.url} placeholder="https://example.invalid/mcp"
                  onChange={event => { patchForm({ url: event.target.value }) }}
                />
              </label>
              <label className="dshSkillManagerField">
                <span className="dshSkillManagerFieldLabel">{t('mcpHeaders')}</span>
                <textarea
                  className="dshSkillManagerTextarea" value={state.form.headers}
                  onChange={event => { patchForm({ headers: event.target.value }) }}
                />
              </label>
            </>
          )}
        </>
      )}
      {renderTools()}
      <div className="dshSkillManagerFooter">
        <span className="dshSkillManagerFooterSpacer" />
        <button
          type="button" className="dshSkillManagerBtn" data-size="sm" data-variant="secondary"
          disabled={busy || testing} onClick={test}
        >
          {t('mcpTest')}
        </button>
        <button
          type="button" className="dshSkillManagerBtn" data-variant="secondary" disabled={busy}
          onClick={closeEditor}
        >
          {t('cancel')}
        </button>
        <button
          type="button" className="dshSkillManagerBtn" data-variant="primary" disabled={busy}
          onClick={submit}
        >
          {t('save')}
        </button>
      </div>
    </>
  )

  const creating = editing?.key === NEW_ENTRY_KEY

  return (
    <>
      <div className="dshSkillManagerGroup">
        <p className="dshSkillManagerGroupHead">
          {t('mcpHeading')}
          <span className="dshSkillManagerGroupCount">{`· ${String(servers.length)}`}</span>
        </p>
        {servers.length === 0 && !creating && <p className="dshSkillManagerEmpty">{t('mcpEmpty')}</p>}
        {servers.length > 0 && (
          <ul className="dshSkillManagerCards">
            {servers.map((server) => {
              const open = editing?.key === server.serverName
              const target = serverTarget(server)
              return (
                <li key={server.serverName} className="dshSkillManagerCard" data-open={open}>
                  <div className="dshSkillManagerCardHead">
                    <button
                      type="button"
                      className="dshSkillManagerCardToggle"
                      aria-expanded={open}
                      aria-label={`${server.serverName}: ${t('mcpEdit')}`}
                      onClick={() => { openEditor(server) }}
                    >
                      <span className="dshSkillManagerCardText">
                        <span className="dshSkillManagerCardTitle" title={server.serverName}>{server.serverName}</span>
                        <span className="dshSkillManagerCardMeta" title={target}>{target}</span>
                      </span>
                      <StateTag tone="outline">{server.transport}</StateTag>
                      <StateTag tone={server.enabled ? 'success' : 'neutral'}>
                        {server.enabled ? t('mcpEnabled') : t('mcpDisabled')}
                      </StateTag>
                      <span className="dshSkillManagerChevron" aria-hidden="true" />
                    </button>
                    <span className="dshSkillManagerCardActions">
                      <Toggle
                        checked={server.enabled}
                        disabled={busy}
                        label={`${server.serverName}: ${server.enabled ? t('mcpDisable') : t('mcpEnable')}`}
                        onChange={(next) => {
                          void run(async () => { await api.toggleServer(server.serverName, next) })
                        }}
                      />
                      <button
                        type="button" className="dshSkillManagerBtn" data-size="sm" data-variant="danger" disabled={busy}
                        onClick={() => { closeEditor(); setConfirming(server.serverName) }}
                      >
                        {t('mcpRemove')}
                      </button>
                    </span>
                  </div>
                  {confirming === server.serverName && (
                    <div className="dshSkillManagerCardBody">
                      <ConfirmBar
                        t={t} busy={busy} question={t('confirmRemove')}
                        onCancel={() => { setConfirming(null) }}
                        onConfirm={() => {
                          void (async () => {
                            if (await run(async () => { await api.removeServer(server.serverName) })) setConfirming(null)
                          })()
                        }}
                      />
                    </div>
                  )}
                  {open && editing !== null && (
                    <div className="dshSkillManagerCardBody">{renderEditor(editing.state)}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {creating && editing !== null && (
          <div className="dshSkillManagerCard" data-open="true">
            <div className="dshSkillManagerCardHead">
              <span className="dshSkillManagerCardText">
                <span className="dshSkillManagerCardTitle">{t('mcpAdd')}</span>
              </span>
            </div>
            <div className="dshSkillManagerCardBody">{renderEditor(editing.state)}</div>
          </div>
        )}
      </div>
      <div className="dshSkillManagerActions">
        <button
          type="button" className="dshSkillManagerBtn" data-variant="dashed" disabled={busy}
          onClick={() => { openEditor(null) }}
        >
          {t('mcpAdd')}
        </button>
      </div>
    </>
  )
}

interface SkillEditorState {
  readonly key: string
  readonly name: string
  readonly scope: 'system' | 'user'
  readonly content: string
  readonly readOnly: boolean
}

function skillKey(skill: SkillEntry): string {
  return `${skill.scope}/${skill.name}`
}

function deriveNameFromContent(content: string): string {
  const match = /^---\r?\nname:\s*([^\s]+)\s*$/mu.exec(content)
  return match?.[1] ?? ''
}

function SkillsTab(props: {
  readonly api: SkillManagerApi
  readonly t: Translate
  readonly skills: readonly SkillEntry[]
  readonly busy: boolean
  readonly run: Run
  readonly report: Report
  readonly pickDirectory: () => Promise<string | null>
}) {
  const { api, t, skills, busy, run, report, pickDirectory } = props
  const [editor, setEditor] = useState<SkillEditorState | null>(null)
  const [editorNotice, setEditorNotice] = useState<Notice | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const closeEditor = (): void => {
    setEditor(null)
    setEditorNotice(null)
    setConfirming(null)
  }

  const openEditor = (skill: SkillEntry): void => {
    const key = skillKey(skill)
    if (editor?.key === key) { closeEditor(); return }
    if (opening !== null) return
    setEditorNotice(null)
    setConfirming(null)
    setOpening(key)
    void (async () => {
      try {
        const value = await api.readSkill(skill.name, skill.scope)
        setEditor({ key, name: skill.name, scope: skill.scope, content: value.content, readOnly: value.readOnly })
      } catch (cause) {
        report({ kind: 'error', text: errorText(cause, t('unknownError')) })
      } finally {
        setOpening(null)
      }
    })()
  }

  const save = (): void => {
    if (editor === null) return
    const name = editor.scope === 'user' ? editor.name : deriveNameFromContent(editor.content)
    void (async () => {
      if (await run(async () => { await api.saveSkill(name, editor.content) })) closeEditor()
    })()
  }

  const grouped: readonly (readonly ['system' | 'user', readonly SkillEntry[]])[] = [
    ['system', skills.filter(skill => skill.scope === 'system')],
    ['user', skills.filter(skill => skill.scope === 'user')],
  ]

  const creating = editor?.key === NEW_ENTRY_KEY

  const renderEditor = (): ReactNode => {
    if (editor === null) return null
    return (
      <>
        {editor.readOnly && <p className="dshSkillManagerStatus">{t('skillReadOnlyNote')}</p>}
        {editorNotice !== null && <NoticeBlock notice={editorNotice} />}
        <textarea
          className="dshSkillManagerTextarea" data-size="tall" value={editor.content} spellCheck={false}
          aria-label={t('skillContent')}
          onChange={event => { setEditor({ ...editor, content: event.target.value }) }}
        />
        <div className="dshSkillManagerFooter">
          <span className="dshSkillManagerFooterSpacer" />
          <button
            type="button" className="dshSkillManagerBtn" data-variant="secondary" disabled={busy}
            onClick={closeEditor}
          >
            {t('cancel')}
          </button>
          <button
            type="button" className="dshSkillManagerBtn" data-variant="primary" disabled={busy}
            onClick={save}
          >
            {t('save')}
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      {skills.length === 0 && !creating && <p className="dshSkillManagerEmpty">{t('skillsEmpty')}</p>}
      {grouped.map(([scope, entries]) => entries.length === 0 ? null : (
        <div key={scope} className="dshSkillManagerGroup">
          <p className="dshSkillManagerGroupHead">
            {scope === 'system' ? t('scopeSystem') : t('scopeUser')}
            <span className="dshSkillManagerGroupCount">{`· ${String(entries.length)}`}</span>
          </p>
          <ul className="dshSkillManagerCards">
            {entries.map((skill) => {
              const key = skillKey(skill)
              const open = editor?.key === key
              return (
                <li key={key} className="dshSkillManagerCard" data-open={open}>
                  <div className="dshSkillManagerCardHead">
                    <span className="dshSkillManagerCardText">
                      <span className="dshSkillManagerCardTitle" title={skill.name}>{skill.name}</span>
                      {skill.description === '' ? null : (
                        <span className="dshSkillManagerCardDesc" title={skill.description}>{skill.description}</span>
                      )}
                    </span>
                    <StateTag tone="outline">
                      {skill.scope === 'system' ? t('scopeSystem') : t('scopeUser')}
                    </StateTag>
                    <span className="dshSkillManagerCardActions">
                      <Toggle
                        checked={skill.enabled}
                        disabled={busy}
                        label={`${skill.name}: ${skill.enabled ? t('mcpDisable') : t('mcpEnable')}`}
                        onChange={(next) => {
                          void run(async () => { await api.toggleSkill(skill.name, skill.scope, next) })
                        }}
                      />
                      <button
                        type="button" className="dshSkillManagerBtn" data-size="sm" data-variant="secondary"
                        disabled={busy || opening !== null}
                        onClick={() => { openEditor(skill) }}
                      >
                        {open ? t('cancel') : t('skillEdit')}
                      </button>
                      {skill.scope === 'user' && !open && (
                        <button
                          type="button" className="dshSkillManagerBtn" data-size="sm" data-variant="danger"
                          disabled={busy}
                          onClick={() => { closeEditor(); setConfirming(key) }}
                        >
                          {t('skillDelete')}
                        </button>
                      )}
                    </span>
                  </div>
                  {confirming === key && (
                    <div className="dshSkillManagerCardBody">
                      <ConfirmBar
                        t={t} busy={busy} question={t('confirmDelete')}
                        onCancel={() => { setConfirming(null) }}
                        onConfirm={() => {
                          void (async () => {
                            if (await run(async () => { await api.deleteSkill(skill.name) })) setConfirming(null)
                          })()
                        }}
                      />
                    </div>
                  )}
                  {open && <div className="dshSkillManagerCardBody">{renderEditor()}</div>}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {creating && (
        <div className="dshSkillManagerCard" data-open="true">
          <div className="dshSkillManagerCardHead">
            <span className="dshSkillManagerCardText">
              <span className="dshSkillManagerCardTitle">{t('skillNew')}</span>
              <span className="dshSkillManagerCardMeta">{t('scopeUser')}</span>
            </span>
          </div>
          <div className="dshSkillManagerCardBody">{renderEditor()}</div>
        </div>
      )}
      <div className="dshSkillManagerActions">
        <button
          type="button" className="dshSkillManagerBtn" data-variant="dashed" disabled={busy}
          onClick={() => {
            setConfirming(null)
            setEditor({ key: NEW_ENTRY_KEY, name: '', scope: 'user', content: t('skillTemplate'), readOnly: false })
            setEditorNotice(null)
          }}
        >
          {t('skillNew')}
        </button>
        <button
          type="button" className="dshSkillManagerBtn" data-variant="dashed" disabled={busy}
          onClick={() => {
            void (async () => {
              const sourceDir = await pickDirectory()
              if (sourceDir === null) return
              await run(async () => {
                const imported = await api.importSkills(sourceDir)
                return imported.length > 0 ? imported.join(', ') : ''
              })
            })()
          }}
        >
          {t('skillImport')}
        </button>
      </div>
    </>
  )
}
