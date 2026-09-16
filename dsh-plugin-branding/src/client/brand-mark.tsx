/** Brand mark renderers: the supplied report artwork as a currentColor SVG,
 * filling the sidebar and hero brand-mark slots the official shells declare
 * but leave unregistered (their whale artwork is only the fallback). */

const MARK_PATH = 'M828.952381 146.285714a73.142857 73.142857 0 0 1 73.142857 73.142857v463.238096a73.142857 73.142857 0 0 1-73.142857 73.142857H195.047619a73.142857 73.142857 0 0 1-73.142857-73.142857V219.428571a73.142857 73.142857 0 0 1 73.142857-73.142857h633.904762z m0 73.142857H195.047619v463.238096h633.904762V219.428571z m-96.792381 84.577524v195.047619h-73.142857v-70.070857l-136.362667 136.362667-86.186666-86.211048-137.947429 137.947429-51.712-51.736381 189.635048-189.635048 86.211047 86.186667 84.772572-84.772572h-70.290286v-73.142857h195.047619zM268.190476 804.571429h487.619048v73.142857H268.190476z'

function MarkSvg({ size, className }: { size: number; className?: string | undefined }) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} className={className} aria-hidden="true">
      <path d={MARK_PATH} fill="currentColor" />
    </svg>
  )
}

/** Owner shares are intentionally structural (size + optional className);
 * the official SlotMap types are not imported so this package stays off the
 * conversation/sidebar type graphs. */

export interface SidebarBrandMarkProps {
  readonly size: number
}

export function SidebarBrandMark({ size }: SidebarBrandMarkProps) {
  return <MarkSvg size={size} />
}

export interface HeroBrandMarkProps {
  readonly size: number
  readonly className?: string | undefined
}

export function HeroBrandMark({ size, className }: HeroBrandMarkProps) {
  return <MarkSvg size={size} className={className} />
}

export interface SidebarBrandNameProps {
  readonly children?: never
}

export function SidebarBrandName(_: SidebarBrandNameProps) {
  return <span>法海问津</span>
}
