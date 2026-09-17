/** Offline-plugins settings section: inline export/import management UI. */

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

export function OfflinePluginsSection(props: OfflinePluginsSectionProps) {
  const { api, t } = props
  const [plugins, setPlugins] = useState<readonly OfflinePluginEntry[]>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<Busy>(undefined)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [progress, setProgress] = useState<ExportProgressView | null>(null)
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

  const exportOne = async (name: string): Promise<void> => {
    setNotice(null)
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

  const importOne = async (): Promise<void> => {
    setNotice(null)
    const sourceDir = await pickDirectory()
    if (sourceDir === null) return
    setBusy({ kind: 'import' })
    try {
      const result = await api.importFrom(sourceDir)
      setNotice({
        kind: 'ok',
        text: `${t('importDone')}: ${result.plugin.name}@${result.plugin.version} `
          + `(+${String(result.imported.length)} deps) ${t('needsRestart')}`,
      })
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : t('unknownError') })
    } finally {
      setBusy(undefined)
    }
  }

  const importing = busy?.kind === 'import'
  return (
    <div className="dshOfflineBody">
      <p className="dshOfflineIntro">{t('intro')}</p>
      <h3 className="dshOfflineHeading">{t('installedHeading')}</h3>
      {loadFailed && <p className="dshOfflineMsg" data-kind="error">{t('loadFailed')}</p>}
      {!loadFailed && plugins !== undefined && plugins.length === 0 && (
        <p className="dshOfflineEmpty">{t('noPlugins')}</p>
      )}
      <div className="dshOfflineList">
        {(plugins ?? []).map(entry => (
          <OfflinePluginsRow
            key={entry.name}
            entry={entry}
            t={t}
            busy={progress !== null}
            onExport={name => { void exportOne(name) }}
          />
        ))}
      </div>
      {progress !== null && (
        <div className="dshOfflineProgressBlock">
          <div className="dshOfflineProgress">
            <div
              className="dshOfflineProgressFill"
              style={{ width: `${progress.bytesTotal > 0
                ? Math.min(100, Math.round(progress.bytesDone / progress.bytesTotal * 100))
                : 0}%` }}
            />
          </div>
          <div className="dshOfflineProgressMeta">
            {t('exporting')} {String(progress.packagesDone)}/{String(progress.packagesTotal)}
            {' · '}{formatMegabytes(progress.bytesDone)} / {formatMegabytes(progress.bytesTotal)}
            {progress.currentPackage !== null && ` · ${progress.currentPackage}`}
          </div>
        </div>
      )}
      <h3 className="dshOfflineHeading">{t('importHeading')}</h3>
      <div>
        <button
          type="button"
          className="dshOfflineBtn"
          disabled={busy !== undefined}
          onClick={() => { void importOne() }}
        >
          {importing ? t('importing') : t('importAction')}
        </button>
      </div>
      {notice !== null && (
        <p className="dshOfflineMsg" data-kind={notice.kind}>{notice.text}</p>
      )}
    </div>
  )
}
