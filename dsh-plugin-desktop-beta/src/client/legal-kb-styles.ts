/** Legal-KB launcher and connection-panel styles, owned by Desktop. */

const STYLE_ID = 'dsh-plugin-desktop-legal-kb-styles'

const CSS = `
.dshLegalKbLauncher {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 4px);
  margin: 0 -2px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dshLegalKbLauncher:hover { background: color-mix(in oklab, currentColor 8%, transparent); }
.dshLegalKbLauncher[data-wide='false'] { justify-content: center; padding: 8px 0; }
.dshLegalKbLauncherIcon {
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 4px;
}
.dshLegalKbHeaderIcon {
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 4px;
}
.dshLegalKbLauncherLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 13px;
}
.dshLegalKbLauncherState {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: color-mix(in oklab, currentColor 25%, transparent);
}
.dshLegalKbLauncherState[data-on='true'] { background: #2fa96c; }

.dshLegalKbBackdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
}
.dshLegalKbPanel {
  width: min(420px, calc(100vw - 48px));
  max-height: min(560px, calc(100vh - 96px));
  overflow-y: auto;
  padding: 20px;
  border-radius: 14px;
  background: var(--color-bg, #1c1c1e);
  color: var(--color-fg, #f2f2f2);
  box-shadow: 0 18px 48px rgb(0 0 0 / 35%);
}
.dshLegalKbPanelHeader {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dshLegalKbPanelHeader h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.dshLegalKbClose {
  display: flex;
  border: none;
  padding: 4px;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dshLegalKbClose:hover { background: color-mix(in oklab, currentColor 10%, transparent); }
.dshLegalKbIntro { margin: 10px 0 14px; font-size: 12.5px; opacity: 0.75; }

.dshLegalKbState {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in oklab, currentColor 6%, transparent);
}
.dshLegalKbStateBadge {
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: color-mix(in oklab, currentColor 14%, transparent);
}
.dshLegalKbState[data-connected='true'] .dshLegalKbStateBadge { background: rgb(47 169 108 / 22%); }
.dshLegalKbIdentity { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.dshLegalKbIdentity > div { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
.dshLegalKbIdentity dt { opacity: 0.65; }
.dshLegalKbIdentity dd { margin: 0; text-align: right; overflow-wrap: anywhere; }

.dshLegalKbForm { display: flex; flex-direction: column; gap: 10px; }
.dshLegalKbField { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; opacity: 0.95; }
.dshLegalKbInput {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid color-mix(in oklab, currentColor 20%, transparent);
  border-radius: 8px;
  background: color-mix(in oklab, currentColor 5%, transparent);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.dshLegalKbInput:focus { outline: none; border-color: color-mix(in oklab, currentColor 45%, transparent); }
.dshLegalKbAdvancedToggle {
  align-self: flex-start;
  border: none;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  opacity: 0.7;
  cursor: pointer;
  text-decoration: underline;
}
.dshLegalKbAdvanced { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: 10px; background: color-mix(in oklab, currentColor 5%, transparent); }
.dshLegalKbError { margin: 0; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; background: rgb(220 80 80 / 16%); }
.dshLegalKbActions { display: flex; gap: 8px; }
.dshLegalKbPrimary, .dshLegalKbSecondary {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dshLegalKbPrimary { background: #3b82f6; color: #fff; }
.dshLegalKbPrimary:disabled { opacity: 0.5; cursor: default; }
.dshLegalKbSecondary { background: color-mix(in oklab, currentColor 12%, transparent); color: inherit; }
.dshLegalKbSecondary:disabled { opacity: 0.5; cursor: default; }
.dshLegalKbHint { margin: 14px 0 0; font-size: 12px; opacity: 0.6; }
`

/** Install the Legal-KB sheet once; tolerate headless Client boot. */
export function installLegalKbStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/legal-kb'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
