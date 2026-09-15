/**
 * Desktop-owned occupants for the shared brand seats.
 *
 * Three seats carry the rendered product identity. `ui-sidebar` declares
 * `sidebar.brand.mark` / `sidebar.brand.name` and falls back to the fish mark
 * plus a local-build label; `ui-conversation` declares
 * `conversation.hero.brand.mark` and falls back to its animated fish; and
 * `@deepseek-ai/dsh-client-ui-brand-official` claims the sidebar pair in
 * official builds. This package installs its Loader patch that disables the
 * official occupants, then claims the seats here, so a Desktop release
 * presents its own name and mark instead of the upstream ones.
 */

import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DESKTOP_PRODUCT_NAME } from '../product-identity.ts'

/** Brand blue shared with the packaged application, installer, and tray art. */
const BRAND_BLUE = '#0D5FA7'

/** Stem of the Lexford mark, on the shared 50-unit art board. */
const BRAND_MARK_STEM = 'M15 7h6a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4V11a4 4 0 0 1 4-4z'

/** Foot of the Lexford mark, on the shared 50-unit art board. */
const BRAND_MARK_FOOT = 'M15 29h20a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4z'

/** Sidebar seat: monochrome mark inheriting the shell's brand-row color. */
export function DesktopSidebarBrandMark({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={BRAND_MARK_STEM} />
      <path fill="currentColor" d={BRAND_MARK_FOOT} />
    </svg>
  )
}

/** Sidebar seat: the product name; the shell's own span owns the type treatment. */
export function DesktopSidebarBrandName(): ReactNode {
  return DESKTOP_PRODUCT_NAME
}

/**
 * Hero seat: the packaged-mark treatment (brand field plus white mark). The
 * requesting surface supplies the placeholder mark's class, which carries the
 * swim keyframes that belong to the fish it replaces, so it is deliberately
 * not forwarded here.
 * @param props.size - requested square edge in pixels.
 * @returns the hero brand mark.
 */
export function DesktopHeroBrandMark({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <rect width="1024" height="1024" rx="184" fill={BRAND_BLUE} />
      <rect x="244" y="160" width="206" height="704" rx="86" fill="#FFFFFF" />
      <rect x="244" y="578" width="536" height="206" rx="86" fill="#FFFFFF" />
    </svg>
  )
}

/**
 * Claim the shared brand seats for the Desktop product identity. Declaration
 * injection runs each registration set once its declaring package has published
 * the slot, so the result does not depend on plugin activation order; collapsing
 * a declaration disposes the set again.
 * @param ctx - Desktop browser Cordis context.
 */
export function applyDesktopBrand(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DesktopSidebarBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, DesktopSidebarBrandName)
    })),
    'dsh-plugin-desktop: sidebar brand seats',
  )
  ctx.effect(
    () => ctx.slots.inject('conversation.hero.brand.mark', function* () {
      yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, DesktopHeroBrandMark)
    }),
    'dsh-plugin-desktop: conversation hero brand seat',
  )
}
