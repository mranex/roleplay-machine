/**
 * Tầng gọi API host của Roleplay Machine.
 *
 * UI chạy trong trình duyệt nên không đọc được đĩa: mọi thứ đi qua
 * `POST /rp-machine/api/<method>` cùng origin, kèm header `x-rp-request` để
 * host biết request do chính UI này phát ra.
 *
 * Không import gì ngoài `fetch` của trình duyệt.
 */

/** Chữ host dùng để che nội dung card bị niệm phong (khớp `MASKED_TEXT` phía host). */
export const MASKED_TEXT = '— nội dung bị niệm phong —'

/** Tám loại card, giữ đúng thứ tự host dùng khi lắp cảnh. */
export const CARD_TYPES = [
  'world',
  'player_role',
  'npc',
  'opening',
  'pressure',
  'goal',
  'hidden_truth',
  'chaos',
] as const

export type CardType = (typeof CARD_TYPES)[number]

/** Mức hiển thị của card. Khác `public` là bị niệm phong. */
export const VISIBILITY_OPTIONS = ['public', 'hidden', 'gm_only', 'locked'] as const

export type Visibility = (typeof VISIBILITY_OPTIONS)[number]

/** Trần ký tự của từng mảnh chỉ thị — khớp `FRAGMENT_LIMITS` phía host. */
export const FRAGMENT_LIMITS = {
  prompt: 1000,
  firstMessage: 4000,
  hiddenTruth: 1000,
  heavenRule: 500,
  contentBoundary: 1000,
} as const

export type FragmentKey = keyof typeof FRAGMENT_LIMITS

export const FRAGMENT_ORDER: readonly FragmentKey[] = [
  'prompt',
  'firstMessage',
  'hiddenTruth',
  'heavenRule',
  'contentBoundary',
]

/** Nhãn tiếng Việt cho từng mảnh. */
export const FRAGMENT_LABELS: Readonly<Record<FragmentKey, string>> = {
  prompt: 'Chỉ thị (prompt)',
  firstMessage: 'Lời mở đầu (firstMessage)',
  hiddenTruth: 'Sự thật bị niệm phong (hiddenTruth)',
  heavenRule: 'Luật Thiên Đạo (heavenRule)',
  contentBoundary: 'Ranh giới nội dung (contentBoundary)',
}

/** Nhãn tiếng Việt cho từng mức hiển thị. */
export const VISIBILITY_LABELS: Readonly<Record<Visibility, string>> = {
  public: 'công khai',
  hidden: 'ẩn',
  gm_only: 'chỉ GM',
  locked: 'khoá',
}

export interface CardFragments {
  prompt: string
  firstMessage: string
  hiddenTruth: string
  heavenRule: string
  contentBoundary: string
}

/** Card nhìn từ UI. `masked` = nội dung đã bị che. */
export interface RpCard {
  id: string
  type: string
  title: string
  chaos: number
  visibility: string
  weight: number
  tags: string[]
  description: string
  fragments: CardFragments
  /** `true` khi nội dung của card này đã bị niệm phong (card gm_only, chưa mở). */
  masked: boolean
}

export interface StatusSnapshot {
  total: number
  byType: Record<string, number>
  gmOnly: number
  packs: number
  issues: string[]
  scenes: { id: string; mode: string; chaosTotal: number }[]
  runs: { sceneId: string; status: string; turn: number }[]
}

export interface CardsResponse {
  cards: RpCard[]
  /** Cảnh báo khi nạp thư viện (file hỏng, pack sai…). */
  issues?: string[]
  /** Danh mục loại card host chấp nhận. */
  types?: string[]
}

export interface TensionMeter {
  id: string
  label: string
  value: number
  max: number
  failAt: number
}

export type PlayMode = 'coward' | 'semi_coward' | 'boss_mode'

export interface DrawResult {
  ok: boolean
  sceneId: string
  mode: PlayMode
  modeLabel?: string
  source: { id: string; title: string } | null
  chaos: { total: number; level: string; eventEvery: number; description?: string }
  briefing: string
  meters: TensionMeter[]
  winSteps: number
  frame: string
  notes: string[]
}

export interface RunSnapshot {
  ok: boolean
  sceneId: string | null
  status: string
  frame: string
  meters?: TensionMeter[]
  winSteps?: { done: number; total: number }
  runs?: { sceneId: string; status: string; turn: number }[]
}

export interface SaveCardResult {
  id: string
  file: string
}

export interface DeleteCardResult {
  ok: boolean
  id: string
}

/** Gọi API và trả về đúng kiểu đã khai báo. */
export type Send = <T>(method: string, body?: object, signal?: AbortSignal) => Promise<T>

/** Thân phản hồi thô của host. */
interface RpEnvelope {
  ok: boolean
  value?: unknown
  error?: string
  code?: string
}

function envelopeOf(parsed: unknown): RpEnvelope {
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as RpEnvelope
  }
  return { ok: false, error: 'Phản hồi từ host không phải JSON object.' }
}

/** Gộp lỗi mạng và lỗi host thành một câu tiếng Việt đọc được. */
function failureMessage(parsed: RpEnvelope, status: number): string {
  const detail = typeof parsed.error === 'string' && parsed.error !== '' ? parsed.error : `HTTP ${status}`
  const code = typeof parsed.code === 'string' && parsed.code !== '' ? ` [${parsed.code}]` : ''
  return `Roleplay Machine báo lỗi${code}: ${detail}`
}

/**
 * Gọi một method của API host.
 *
 * Ném `Error` với thông điệp tiếng Việt khi HTTP không OK hoặc khi host trả
 * `ok: false`. Truyền `signal` để huỷ khi panel unmount.
 */
export async function callRp<T>(method: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/rp-machine/api/' + method, {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'content-type': 'application/json', 'x-rp-request': '1' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text === '' ? {} : JSON.parse(text)
  } catch {
    parsed = { ok: false, error: 'Host trả về dữ liệu không phải JSON.' }
  }
  const envelope = envelopeOf(parsed)
  if (!response.ok || envelope.ok !== true) throw new Error(failureMessage(envelope, response.status))
  return envelope.value as T
}

/** Trạng thái ván gần nhất, hoặc ván chỉ định. */
export function loadState(sceneId?: string, signal?: AbortSignal): Promise<RunSnapshot> {
  return callRp<RunSnapshot>('state', sceneId === undefined || sceneId === '' ? {} : { sceneId }, signal)
}

/** Thư viện + số liệu tổng quan. */
export function loadStatus(signal?: AbortSignal): Promise<StatusSnapshot> {
  return callRp<StatusSnapshot>('status', {}, signal)
}

/**
 * Danh sách card. `reveal: true` chỉ dùng khi người dùng đã xác nhận muốn ăn spoil.
 */
export function loadCards(reveal: boolean, signal?: AbortSignal): Promise<CardsResponse> {
  return callRp<CardsResponse>('cards', { reveal }, signal)
}

export function saveCard(card: object, signal?: AbortSignal): Promise<SaveCardResult> {
  return callRp<SaveCardResult>('save-card', { card, replace: true }, signal)
}

export function deleteCard(id: string, signal?: AbortSignal): Promise<DeleteCardResult> {
  return callRp<DeleteCardResult>('delete-card', { id }, signal)
}
