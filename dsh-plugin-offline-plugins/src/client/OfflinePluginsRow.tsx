/** One installed plugin card with its export action. */

import type { ReactNode } from 'react'
import type { OfflinePluginEntry } from '../offline/contract.ts'
import type { OfflinePluginsLocaleKey } from './offline-plugins-locales.ts'

interface OfflinePluginsRowProps {
  readonly entry: OfflinePluginEntry
  readonly t: (key: OfflinePluginsLocaleKey) => string
  /** Another plugin's export is in flight; every row refuses a second run. */
  readonly busy: boolean
  /** This plugin's own export is in flight, scanning included. */
  readonly active: boolean
  readonly onExport: (name: string) => void
}

/** Read-only capsule badge; the tone selects the palette. */
function StateTag(props: { readonly tone: 'neutral' | 'info', readonly children: ReactNode }) {
  return <span className="dshOfflineTag" data-tone={props.tone}>{props.children}</span>
}

export function OfflinePluginsRow(props: OfflinePluginsRowProps) {
  const { entry, t, busy, active, onExport } = props
  return (
    <li className="dshOfflineCard">
      <div className="dshOfflineCardHead">
        <span className="dshOfflineCardText">
          <span className="dshOfflineCardTitle" title={entry.name}>{entry.name}</span>
          <span className="dshOfflineCardMeta">{`v${entry.version}`}</span>
        </span>
        {entry.immutable && <StateTag tone="info">{t('immutableBadge')}</StateTag>}
        {entry.disabled && <StateTag tone="neutral">{t('disabledBadge')}</StateTag>}
        {!entry.immutable && (
          <button
            type="button"
            className="dshOfflineBtn"
            data-size="sm"
            data-variant="secondary"
            disabled={busy}
            onClick={() => { onExport(entry.name) }}
          >
            {active ? t('exporting') : t('exportAction')}
          </button>
        )}
      </div>
    </li>
  )
}
