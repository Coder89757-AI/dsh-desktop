/**
 * Offline-plugins settings section: inline export/import management UI.
 *
 * The layout follows the shipped Plugins settings page: a titled section, one
 * card per installed plugin, and a dashed "place a thing here" affordance for
 * the import flow that ends the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfflinePluginEntry } from '../offline/contract.ts'
import type { OfflinePluginsApi } from './offline-plugins-api.ts'
import { OfflinePluginsRow } from './OfflinePluginsRow.tsx'

export interface OfflinePluginsInjected {
  readonly api: OfflinePluginsApi
}

export type OfflinePluginsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'offline-plugins'>
  & InjectFace<OfflinePluginsInjected>

type Busy = { kind: 'import' } | undefined

interface Notice {
  readonly kind: 'ok' | 'error'
  readonly text: string
}

interface ExportProgressView {
  /** Plugin the running job belongs to, so its card can stay marked busy. */
  readonly pluginName: string
  readonly jobId: string
  readonly packagesDone: number
  readonly packagesTotal: number
  readonly bytesDone: number
  readonly bytesTotal: number
  readonly currentPackage: string | null
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Status or failure line, tinted by kind. */
function NoticeBlock(props: { readonly notice: Notice }) {
  return (
    <p
      className="dshOfflineNotice"
      data-kind={props.notice.kind}
      role={props.notice.kind === 'error' ? 'alert' : 'status'}
    >
      {props.notice.text}
    </p>
  )
}

export function OfflinePluginsSection(props: OfflinePluginsSectionProps) {
  const { api, t } = props
  const [plugins, setPlugins] = useState<readonly OfflinePluginEntry[]>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<Busy>(undefined)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [progress, setProgress] = useState<ExportProgressView | null>(null)
  /** Plugin whose dependency scan is running, before any job exists yet. */
  const [starting, setStarting] = useState<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval>>()

  const refresh = useCallback(async (): Promise<void> => {
    const next = await api.list()
    setPlugins(next.plugins)
  }, [api])

  useEffect(() => {
    refresh().catch(() => { setLoadFailed(true) })
  }, [refresh])

  useEffect(() => () => { if (pollTimer.current !== undefined) clearInterval(pollTimer.current) }, [])

  const pickDirectory = async (): Promise<string | null> => {
    try {
      return await api.pickDirectory()
    } catch {
      setNotice({ kind: 'error', text: t('pickFailed') })
      return null
    }
  }

  /** The export flow itself: pick a destination, start the job, then poll it. */
  const runExport = async (name: string): Promise<void> => {
    const destinationDir = await pickDirectory()
    if (destinationDir === null) return
    let started
    try {
      started = await api.startExport(name, destinationDir)
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : t('unknownError') })
      return
    }
    // A hot-reloaded client can pair with a stale Host that still runs the
    // old synchronous export route: its response carries no jobId. Surface
    // that instead of silently polling a route the Host does not have.
    if (typeof started.jobId !== 'string' || started.jobId === '') {
      setNotice({ kind: 'error', text: t('hostStale') })
      return
    }
    setProgress({
      pluginName: name,
      jobId: started.jobId,
      packagesDone: 0,
      packagesTotal: started.packages.length,
      bytesDone: 0,
      bytesTotal: started.totalBytes,
      currentPackage: started.packages[0] ?? null,
    })
    if (pollTimer.current !== undefined) clearInterval(pollTimer.current)
    let pollFailures = 0
    pollTimer.current = setInterval(() => {
      void (async () => {
        let snapshot
        try {
          snapshot = await api.exportProgress(started.jobId)
          pollFailures = 0
        } catch {
          pollFailures += 1
          if (pollFailures >= 10) {
            if (pollTimer.current !== undefined) clearInterval(pollTimer.current)
            pollTimer.current = undefined
            setProgress(null)
            setNotice({ kind: 'error', text: t('hostStale') })
          }
          return
        }
        setProgress({
          pluginName: name,
          jobId: snapshot.jobId,
          packagesDone: snapshot.packagesDone,
          packagesTotal: snapshot.packagesTotal,
          bytesDone: snapshot.bytesDone,
          bytesTotal: snapshot.bytesTotal,
          currentPackage: snapshot.currentPackage,
        })
        if (snapshot.status === 'running') return
        if (pollTimer.current !== undefined) clearInterval(pollTimer.current)
        pollTimer.current = undefined
        setProgress(null)
        if (snapshot.status === 'failed') {
          setNotice({ kind: 'error', text: snapshot.error ?? t('unknownError') })
          return
        }
        const unresolved = snapshot.unresolved.length > 0 ? t('exportUnresolved') : ''
        setNotice({
          kind: 'ok',
          text: `${t('exportDone')}: ${snapshot.exportPath ?? ''} (${String(snapshot.packagesTotal)} pkgs)${unresolved}`,
        })
        await refresh().catch(() => {})
      })()
    }, 300)
  }

  /**
   * Export one plugin, keeping its row busy for the whole call.
   *
   * The Host walks the entire dependency closure and totals its bytes before it
   * can answer with a job, and that wait is long enough to look hung when the
   * only feedback would be a progress bar that has not appeared yet.
   */
  const exportOne = async (name: string): Promise<void> => {
    setNotice(null)
    setStarting(name)
    try {
      await runExport(name)
    } finally {
      setStarting(null)
    }
  }

  const importOne = async (): Promise<void> => {
    setNotice(null)
    const sourceDir = await pickDirectory()
    if (sourceDir === null) return
    setBusy({ kind: 'import' })
    try {
      const result = await api.importFrom(sourceDir)
      const scopedDetail = result.scoped.length > 0
        ? ` ${t('importScoped').replace('{n}', String(result.scoped.length))}`
        : ''
      setNotice({
        kind: 'ok',
        text: `${t('importDone')}: ${result.plugin.name}@${result.plugin.version} `
          + `(+${String(result.imported.length)} deps)${scopedDetail} ${t('needsRestart')}`,
      })
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : t('unknownError') })
    } finally {
      setBusy(undefined)
    }
  }

  const importing = busy?.kind === 'import'
  const percent = progress === null || progress.bytesTotal <= 0
    ? 0
    : Math.min(100, Math.round(progress.bytesDone / progress.bytesTotal * 100))

  return (
    <section className="dshOfflineSection">
      <h2 className="dshOfflineTitle">{t('title')}</h2>
      <p className="dshOfflineIntro">{t('intro')}</p>
      {loadFailed && <NoticeBlock notice={{ kind: 'error', text: t('loadFailed') }} />}
      {notice !== null && <NoticeBlock notice={notice} />}
      {!loadFailed && plugins === undefined && <p className="dshOfflineStatus">{t('loading')}</p>}
      {plugins !== undefined && (
        <div className="dshOfflineGroup">
          <p className="dshOfflineGroupHead">
            {t('installedHeading')}
            <span className="dshOfflineGroupCount">{`· ${String(plugins.length)}`}</span>
          </p>
          {plugins.length === 0 ? <p className="dshOfflineEmpty">{t('noPlugins')}</p> : (
            <ul className="dshOfflineCards">
              {plugins.map(entry => (
                <OfflinePluginsRow
                  key={entry.name}
                  entry={entry}
                  t={t}
                  busy={starting !== null || progress !== null}
                  active={starting === entry.name || progress?.pluginName === entry.name}
                  onExport={name => { void exportOne(name) }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {starting !== null && (
        <div className="dshOfflineProgressBlock">
          <div className="dshOfflineProgressHead">
            <span className="dshOfflineProgressLabel">{t('exporting')}</span>
            <span className="dshOfflineProgressNote">{t('exportScanning')}</span>
            <span className="dshOfflineProgressSpacer" />
          </div>
          <div className="dshOfflineProgressTrack" role="progressbar" aria-label={t('exportScanning')}>
            <div className="dshOfflineProgressFill" data-indeterminate="true" />
          </div>
        </div>
      )}
      {progress !== null && (
        <div className="dshOfflineProgressBlock">
          <div className="dshOfflineProgressHead">
            <span className="dshOfflineProgressLabel">{t('exporting')}</span>
            <span className="dshOfflineProgressCount">
              {`${String(progress.packagesDone)}/${String(progress.packagesTotal)}`}
            </span>
            <span className="dshOfflineProgressSpacer" />
            <span className="dshOfflineProgressBytes">
              {`${formatMegabytes(progress.bytesDone)} / ${formatMegabytes(progress.bytesTotal)}`}
            </span>
          </div>
          <div
            className="dshOfflineProgressTrack"
            role="progressbar"
            aria-label={t('exporting')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="dshOfflineProgressFill" style={{ width: `${String(percent)}%` }} />
          </div>
          {progress.currentPackage !== null && (
            <p className="dshOfflineProgressPackage" title={progress.currentPackage}>
              {progress.currentPackage}
            </p>
          )}
        </div>
      )}
      <div className="dshOfflineGroup">
        <p className="dshOfflineGroupHead">{t('importHeading')}</p>
        <div className="dshOfflineActions">
          <button
            type="button"
            className="dshOfflineBtn"
            data-variant="dashed"
            disabled={busy !== undefined}
            onClick={() => { void importOne() }}
          >
            {importing ? t('importing') : t('importAction')}
          </button>
        </div>
      </div>
    </section>
  )
}
