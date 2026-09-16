/** Feedback relay: forwards session feedback events to the knowledge-base
 * service while a license is connected. Failed deliveries stay in a bounded
 * in-memory queue with exponential backoff; disconnect drops the queue. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import type { MessageFeedbackPut } from '@deepseek-ai/dsh-message-feedback/types'

/** One queued relay item, already projected for the service wire format. */
export interface FeedbackRelayItem {
  readonly sessionId: string
  readonly messageId: string
  readonly rating: 'positive' | 'negative' | ''
  readonly note: string
  readonly category: string
  readonly messageText: string
  readonly deleted: boolean
  readonly eventTime: number
}

const MAX_MESSAGE_TEXT_CHARS = 8_000
const MAX_QUEUE_ITEMS = 500
const BASE_RETRY_DELAY_MS = 2_000
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000

/** Extract the plain text of one derived assistant message. */
export function extractAssistantText(session: Session, messageId: string): string {
  const message = session
    .deriveMessages()
    .find(candidate => candidate.id === messageId)
  if (message === undefined) return ''
  const content: unknown = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } => (block as { type?: string }).type === 'text')
      .map(block => block.text)
      .join('\n')
  }
  return ''
}

/** Dependencies the relay reads at event time and flush time. */
export interface FeedbackRelayDeps {
  /** Whether the relay is switched on (settings-driven). */
  readonly enabled: () => boolean
  /** Connected license code; empty means not connected, so nothing is relayed. */
  readonly licenseCode: () => string
  /** Knowledge-base API base URL. */
  readonly apiUrl: () => string
}

/**
 * Forward one feedback event, if any, into the relay queue.
 * @returns the queued item, or undefined when the event is not feedback or the relay is off.
 */
export function captureFeedbackEvent(
  session: Session,
  event: SessionEvent,
  deps: FeedbackRelayDeps,
  queue: FeedbackRelayItem[],
): FeedbackRelayItem | undefined {
  if (!deps.enabled()) return undefined
  if (deps.licenseCode().trim() === '') return undefined
  if (event.type === 'feedback/message-put') {
    const put = event.data as MessageFeedbackPut
    if (queue.length >= MAX_QUEUE_ITEMS) queue.shift()
    const item: FeedbackRelayItem = {
      sessionId: session.id,
      messageId: put.item.messageId,
      rating: put.item.rating,
      note: put.item.note ?? '',
      category: put.item.category ?? '',
      messageText: extractAssistantText(session, put.item.messageId).slice(0, MAX_MESSAGE_TEXT_CHARS),
      deleted: false,
      eventTime: put.item.updatedAt,
    }
    queue.push(item)
    return item
  }
  if (event.type === 'feedback/message-delete') {
    const deletion = event.data as { sessionId: string; messageId: string }
    if (queue.length >= MAX_QUEUE_ITEMS) queue.shift()
    const item: FeedbackRelayItem = {
      sessionId: session.id,
      messageId: deletion.messageId,
      rating: '',
      note: '',
      category: '',
      messageText: '',
      deleted: true,
      eventTime: Date.now(),
    }
    queue.push(item)
    return item
  }
  return undefined
}

/**
 * Flush the queue once. Returns the items that remain queued after the attempt:
 * empty on success, the original queue on a retryable failure.
 */
export async function flushFeedbackQueue(
  queue: FeedbackRelayItem[],
  deps: FeedbackRelayDeps,
): Promise<FeedbackRelayItem[]> {
  if (queue.length === 0) return queue
  const code = deps.licenseCode().trim()
  if (code === '' || !deps.enabled()) return []
  const endpoint = new URL('/api/feedback', deps.apiUrl().trim())
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${code}`,
    },
    body: JSON.stringify({ items: queue }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`feedback relay failed (HTTP ${String(response.status)})`)
  return []
}

/** Compute the next retry delay from the consecutive failure count. */
export function retryDelayMs(failures: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** failures, MAX_RETRY_DELAY_MS)
}
