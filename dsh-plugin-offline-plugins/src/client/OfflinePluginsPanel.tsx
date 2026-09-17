/** Offline-plugins settings section: inline export/import management UI. */

import { useCallback, useEffect, useState } from 'react'
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

type Busy = { kind: 'export', name: string } | { kind: 'import' } | undefined

interface Notice {
  readonly kind: 'ok' | 'error'
  readonly text: string
}

export function OfflinePluginsSection(props: OfflinePluginsSectionProps) {
  const { api, t } = props
  const [plugins, setPlugins] = useState<readonly OfflinePluginEntry[]>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<Busy>(undefined)
  const [notice, setNotice] = useState<Notice | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await api.list()
    setPlugins(next.plugins)
  }, [api])

  useEffect(() => {
    refresh().catch(() => { setLoadFailed(true) })
  }, [refresh])

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
            busy={exporting}
            onExport={name => { void exportOne(name) }}
          />
        ))}
      </div>
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
