/** Offline-plugins sidebar footer entry: export/import panel. */

import { Package, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfflinePluginEntry } from '../offline/contract.ts'
import type { OfflinePluginsApi } from './offline-plugins-api.ts'
import { OfflinePluginsRow } from './OfflinePluginsRow.tsx'

export interface OfflinePluginsInjected {
  readonly api: OfflinePluginsApi
}

export type OfflinePluginsPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'offline-plugins'>
  & InjectFace<OfflinePluginsInjected>

type Busy = { kind: 'export', name: string } | { kind: 'import' } | undefined

interface Notice {
  readonly kind: 'ok' | 'error'
  readonly text: string
}

export function OfflinePluginsPanel(props: OfflinePluginsPanelProps) {
  const { api, t, wide } = props
  const [panelOpen, setPanelOpen] = useState(false)
  const [plugins, setPlugins] = useState<readonly OfflinePluginEntry[]>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<Busy>(undefined)
  const [notice, setNotice] = useState<Notice | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await api.list()
    setPlugins(next.plugins)
  }, [api])

  useEffect(() => {
    if (!panelOpen || plugins !== undefined) return
    refresh().catch(() => { setLoadFailed(true) })
  }, [panelOpen, plugins, refresh])

  useEffect(() => {
    if (!panelOpen) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPanelOpen(false)
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape) }
  }, [panelOpen])

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
    setBusy({ kind: 'export', name })
    try {
      const result = await api.exportPlugin(name, destinationDir)
      const unresolved = result.unresolved.length > 0 ? t('exportUnresolved') : ''
      setNotice({
        kind: 'ok',
        text: `${t('exportDone')}: ${result.exportPath} (${String(result.packages.length)} pkgs)${unresolved}`,
      })
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : t('unknownError') })
    } finally {
      setBusy(undefined)
    }
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

  const exporting = busy?.kind === 'export'
  const importing = busy?.kind === 'import'
  return (
    <>
      <button
        type="button"
        className="dshOfflineLauncher"
        data-wide={wide ? 'true' : 'false'}
        title={t('railTitle')}
        onClick={() => { setPanelOpen(true) }}
      >
        <Package aria-hidden="true" size={16} />
        {wide && <span>{t('title')}</span>}
      </button>
      {panelOpen && (
        <div
          className="dshOfflinePanel"
          role="presentation"
          onClick={event => { if (event.target === event.currentTarget) setPanelOpen(false) }}
        >
          <div className="dshOfflineDialog" role="dialog" aria-modal="true" aria-label={t('title')}>
            <header className="dshOfflineHeader">
              <h2>{t('title')}</h2>
              <button
                type="button"
                className="dshOfflineClose"
                aria-label={t('close')}
                onClick={() => { setPanelOpen(false) }}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </header>
            <p className="dshOfflineIntro">{t('intro')}</p>
            <section className="dshOfflineSection">
              <h3>{t('installedHeading')}</h3>
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
                    busy={exporting}
                    onExport={name => { void exportOne(name) }}
                  />
                ))}
              </div>
            </section>
            <section className="dshOfflineSection">
              <h3>{t('importHeading')}</h3>
              <button
                type="button"
                className="dshOfflineBtn"
                disabled={busy !== undefined}
                onClick={() => { void importOne() }}
              >
                {importing ? t('importing') : t('importAction')}
              </button>
            </section>
            {notice !== null && (
              <p className="dshOfflineMsg" data-kind={notice.kind}>{notice.text}</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
