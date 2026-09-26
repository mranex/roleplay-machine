/**
 * Nửa trình duyệt của plugin Roleplay Machine.
 *
 * Đăng ký một loại tab ở sidebar phải, rồi đưa thân tab và tiêu đề vào hai seat
 * có khoá. Không chạm gì tới store hay cấu trúc bên trong của sidebar: chỉ dùng
 * đúng đường công khai `sidebarRightTabs` + `sidebar.right.pane.tab[.title]`.
 *
 * Toàn bộ dữ liệu đi qua HTTP cùng origin (`api.ts`). Không có tác dụng phụ ở
 * cấp module: `<style>` chỉ được gắn trong `apply`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './styles.css'
import {
  CARD_TYPES, FRAGMENT_LABELS, FRAGMENT_LIMITS, FRAGMENT_ORDER, MASKED_TEXT, VISIBILITY_LABELS, VISIBILITY_OPTIONS, callRp,
} from './api'
import type {
  CardFragments, DrawResult, FragmentKey, PlayMode, RpCard, RunSnapshot, Send, StatusSnapshot, TensionMeter, Visibility,
} from './api'
import type { ClientHost } from './host'

// ── Định danh ──────────────────────────────────────────────────────────────

/** Khoá của thân tab và tiêu đề tab trong seat có khoá. */
export const PANEL_TAB_ID = '@rp/rp-machine/panel'

/** Loại tab đăng ký với sidebar phải. */
export const PANEL_KIND = 'rp-machine'

/** Dịch vụ client mà plugin này cần trước khi `apply` chạy. */
export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

/** Mở (hoặc đưa ra trước) tab Roleplay Machine. */
export function openRoleplayPanel(host: ClientHost): void {
  host.sidebarRight.openTab(PANEL_KIND)
}

// ── Tiện ích ───────────────────────────────────────────────────────────────

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Bọc `callRp` thành đúng chữ ký `Send` mà các màn hình dùng. */
async function send<T>(method: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  return await callRp<T>(method, body, signal)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isPlayMode(value: string): value is PlayMode {
  return value === 'coward' || value === 'semi_coward' || value === 'boss_mode'
}

/**
 * Ép kết quả `draw` về đúng hình dạng UI cần. Host là nguồn sự thật, nhưng dữ
 * liệu qua HTTP là `unknown` — ở đây chỉ đọc những trường đã biết.
 */
function toDrawResult(value: unknown): DrawResult {
  const raw = asRecord(value)
  const chaos = asRecord(raw['chaos'])
  const sourceRaw = raw['source']
  const source = typeof sourceRaw === 'object' && sourceRaw !== null ? asRecord(sourceRaw) : null
  const metersRaw = Array.isArray(raw['meters']) ? raw['meters'] : []
  const notesRaw = Array.isArray(raw['notes']) ? raw['notes'] : []
  const mode = str(raw['mode'])
  return {
    ok: raw['ok'] !== false,
    sceneId: str(raw['sceneId']),
    mode: isPlayMode(mode) ? mode : 'coward',
    modeLabel: typeof raw['modeLabel'] === 'string' ? raw['modeLabel'] : undefined,
    source: source === null ? null : { id: str(source['id']), title: str(source['title']) },
    chaos: {
      total: num(chaos['total']),
      level: str(chaos['level'], '?'),
      eventEvery: num(chaos['eventEvery']),
      description: typeof chaos['description'] === 'string' ? chaos['description'] : undefined,
    },
    briefing: str(raw['briefing']),
    meters: metersRaw.map(item => {
      const meter = asRecord(item)
      return {
        id: str(meter['id']), label: str(meter['label']), value: num(meter['value']),
        max: num(meter['max'], 1), failAt: num(meter['failAt']),
      }
    }),
    winSteps: num(raw['winSteps']),
    frame: str(raw['frame']),
    notes: notesRaw.map(note => String(note)),
  }
}

function toStatus(value: unknown): StatusSnapshot {
  const raw = asRecord(value)
  return {
    total: num(raw['total']),
    byType: asRecord(raw['byType']) as Record<string, number>,
    gmOnly: num(raw['gmOnly']),
    packs: num(raw['packs']),
    issues: Array.isArray(raw['issues']) ? raw['issues'].map(issue => String(issue)) : [],
    scenes: Array.isArray(raw['scenes']) ? (raw['scenes'] as StatusSnapshot['scenes']) : [],
    runs: Array.isArray(raw['runs']) ? (raw['runs'] as StatusSnapshot['runs']) : [],
  }
}

// ── Bản nháp card (màn Sửa card) ───────────────────────────────────────────

interface CardDraft extends CardFragments {
  id: string
  title: string
  type: string
  chaos: number
  weight: number
  visibility: string
  tags: string
  description: string
}

/** Card trống: đúng mặc định của nút "Tạo card trống". */
function blankDraft(id: string): CardDraft {
  return {
    id, title: '', type: 'world', chaos: 2, weight: 10, visibility: 'public',
    tags: '', description: '', prompt: '', firstMessage: '', hiddenTruth: '', heavenRule: '', contentBoundary: '',
  }
}

/** Card đang bị niệm phong thì mảnh rỗng, không bao giờ chép `MASKED_TEXT` vào form. */
function draftFromCard(card: RpCard): CardDraft {
  const sealed = card.masked
  return {
    ...blankDraft(card.id),
    id: card.id,
    title: card.title,
    type: card.type,
    chaos: card.chaos,
    weight: card.weight,
    visibility: card.visibility,
    tags: card.tags.join(', '),
    description: sealed ? '' : card.description,
    prompt: sealed ? '' : card.fragments.prompt,
    firstMessage: sealed ? '' : card.fragments.firstMessage,
    hiddenTruth: sealed ? '' : card.fragments.hiddenTruth,
    heavenRule: sealed ? '' : card.fragments.heavenRule,
    contentBoundary: sealed ? '' : card.fragments.contentBoundary,
  }
}

function parseTags(raw: string): string[] {
  return raw.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
}

/** Dựng object `rsm-card-v1` để gửi lên host. */
function draftToCardPayload(draft: CardDraft): Record<string, unknown> {
  return {
    schemaVersion: 'rsm-card-v1',
    id: draft.id.trim(),
    type: draft.type,
    title: draft.title.trim(),
    chaos: draft.chaos,
    weight: draft.weight,
    visibility: draft.visibility,
    tags: parseTags(draft.tags),
    description: draft.description,
    fragments: {
      prompt: draft.prompt,
      firstMessage: draft.firstMessage,
      hiddenTruth: draft.hiddenTruth,
      heavenRule: draft.heavenRule,
      contentBoundary: draft.contentBoundary,
    },
  }
}

function newCardId(): string {
  const salt = Math.floor(Math.random() * 36 ** 3).toString(36)
  return `card_moi_${Date.now().toString(36)}_${salt}`
}

// ── Mảnh nhỏ dùng chung ────────────────────────────────────────────────────

function Badge({ children, warn = false }: { children: ReactNode; warn?: boolean }): ReactNode {
  return <span className={warn ? 'rp-badge rp-badge-warn' : 'rp-badge'}>{children}</span>
}

function ErrorLine({ message }: { message: string }): ReactNode {
  return message === '' ? null : <div className="rp-error">{message}</div>
}

/** Một mảnh chỉ thị: nhãn, trần ký tự (đỏ khi vượt), và textarea. */
function FragmentField({ label, hint, value, limit, onChange }: {
  label: string; hint?: string; value: string; limit: number; onChange: (value: string) => void
}): ReactNode {
  const over = value.length > limit
  return (
    <label className="rp-fragment">
      <span className="rp-fragment-head">
        <span>{label} {hint === undefined ? null : <em className="rp-hint">({hint})</em>}</span>
        <span className={over ? 'rp-counter rp-counter-over' : 'rp-counter'}>{value.length} / {limit}</span>
      </span>
      <textarea className="rp-textarea" value={value} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function MeterBar({ meter }: { meter: TensionMeter }): ReactNode {
  const ratio = meter.max <= 0 ? 0 : Math.min(1, Math.max(0, meter.value / meter.max))
  const danger = meter.failAt > 0 && meter.value >= meter.failAt
  return (
    <div className="rp-meter">
      <div className="rp-meter-head">
        <span>{meter.label === '' ? meter.id : meter.label}</span>
        <span className="rp-muted">{meter.value}/{meter.max} · thua ở {meter.failAt}</span>
      </div>
      <div className="rp-meter-bar">
        <div className={danger ? 'rp-meter-fill rp-meter-fill-danger' : 'rp-meter-fill'} style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
      </div>
    </div>
  )
}

// ── Màn 1: Thư viện ────────────────────────────────────────────────────────

function LibraryCard({ card, busy, onEdit, onDelete, onReveal }: {
  card: RpCard; busy: boolean; onEdit: (card: RpCard) => void; onDelete: (card: RpCard) => void; onReveal: () => void
}): ReactNode {
  const visibility = VISIBILITY_LABELS[card.visibility as Visibility] ?? card.visibility
  return (
    <div className="rp-card">
      <div className="rp-card-head">
        <span className="rp-card-title">{card.title === '' ? '(không tiêu đề)' : card.title}</span>
        {card.masked ? <Badge warn>niêm phong</Badge> : null}
      </div>
      <div className="rp-row">
        <Badge>{card.type === '' ? 'không rõ' : card.type}</Badge>
        <Badge>chaos {card.chaos}</Badge>
        <Badge>weight {card.weight}</Badge>
        {card.visibility === 'public' ? null : <Badge>{visibility}</Badge>}
        <span className="rp-muted">{card.id}</span>
      </div>
      {card.tags.length === 0 ? null : <div className="rp-tags">{card.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
      <div className="rp-card-prompt">
        {/* Card bị niệm phong: chỉ tiêu đề và tag hiện ra, mọi mảnh đều là chữ che. */}
        {card.masked ? <span className="rp-sealed">{MASKED_TEXT}</span> : card.fragments.prompt}
      </div>
      <div className="rp-row">
        <button type="button" className="rp-button" disabled={busy} onClick={() => onEdit(card)}>Sửa</button>
        <button type="button" className="rp-button rp-button-danger" disabled={busy} onClick={() => onDelete(card)}>Xoá</button>
        {card.masked ? (
          <button type="button" className="rp-button rp-button-primary" disabled={busy} onClick={onReveal}>
            Hiện nội dung (có spoil)
          </button>
        ) : null}
      </div>
    </div>
  )
}

function LibraryView({ status, cards, busy, error, onRefresh, onReveal, onEdit, onDelete }: {
  status: StatusSnapshot | null; cards: RpCard[] | null; busy: boolean; error: string
  onRefresh: () => void; onReveal: () => void; onEdit: (card: RpCard) => void; onDelete: (card: RpCard) => void
}): ReactNode {
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [onlyMasked, setOnlyMasked] = useState(false)

  const list = cards ?? []
  const needle = query.trim().toLowerCase()
  const visible = list.filter(card => {
    if (type !== '' && card.type !== type) return false
    if (onlyMasked && !card.masked) return false
    if (needle === '') return true
    return card.title.toLowerCase().includes(needle)
      || card.id.toLowerCase().includes(needle)
      || card.tags.some(tag => tag.toLowerCase().includes(needle))
  })
  const counts = status === null
    ? `${list.length} card`
    : `${status.total} card · ${status.gmOnly} bị giấu · ${status.packs} pack`

  return (
    <div className="rp-body">
      <div className="rp-row">
        <span className="rp-counts">{counts}</span>
        <button type="button" className="rp-button" disabled={busy} onClick={onRefresh}>{busy ? 'Đang nạp…' : 'Nạp lại'}</button>
      </div>
      {status !== null && status.issues.length > 0 ? (
        <div className="rp-error">Thư viện có {status.issues.length} cảnh báo: {status.issues.join(' · ')}</div>
      ) : null}
      <label className="rp-field">
        <span>Loại card</span>
        <select className="rp-select" value={type} onChange={event => setType(event.target.value)}>
          <option value="">Tất cả</option>
          {CARD_TYPES.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <div className="rp-row">
        <input className="rp-input" type="search" placeholder="Lọc theo tiêu đề, id hoặc tag…" value={query}
          onChange={event => setQuery(event.target.value)} />
        <label className="rp-check">
          <input type="checkbox" checked={onlyMasked} onChange={event => setOnlyMasked(event.target.checked)} />
          chỉ card bị giấu
        </label>
      </div>
      <ErrorLine message={error} />
      {cards === null ? (
        <div className="rp-empty">Đang nạp thư viện…</div>
      ) : visible.length === 0 ? (
        <div className="rp-empty">Không có card nào khớp bộ lọc.</div>
      ) : (
        <div className="rp-list">
          {visible.map(card => (
            <LibraryCard key={card.id} card={card} busy={busy} onEdit={onEdit} onDelete={onDelete} onReveal={onReveal} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Màn 2: Rút bài ─────────────────────────────────────────────────────────

const MODE_CHOICES: readonly { id: PlayMode; label: string; description: string }[] = [
  { id: 'coward', label: 'Tôi là người bình thường', description: 'Tự chọn card cho mọi slot — kiểm soát toàn bộ cảnh.' },
  { id: 'semi_coward', label: 'Tôi có hơi bất thường', description: 'Chọn tối đa 3 slot, phần còn lại để Thiên Đạo rút.' },
  { id: 'boss_mode', label: 'Tôi là siêu anh hùng', description: 'Không chọn gì cả, thế giới tự chuyển động.' },
]

function DrawView({ send }: { send: Send }): ReactNode {
  const [mode, setMode] = useState<PlayMode>('semi_coward')
  const [seed, setSeed] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<DrawResult | null>(null)
  const [frame, setFrame] = useState('')

  const alive = useRef(true)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      inFlight.current?.abort()
    }
  }, [])

  const startRequest = useCallback((): AbortController => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    return controller
  }, [])

  const runDraw = useCallback(async (): Promise<void> => {
    setDrawing(true)
    setError('')
    const controller = startRequest()
    try {
      const body = seed.trim() === '' ? { mode } : { mode, seed: seed.trim() }
      const value = await send<unknown>('draw', body, controller.signal)
      if (alive.current) setResult(toDrawResult(value))
    } catch (caught) {
      if (!isAbort(caught) && alive.current) setError(messageOf(caught))
    } finally {
      if (alive.current) setDrawing(false)
    }
  }, [mode, seed, send, startRequest])

  const runState = useCallback(async (): Promise<void> => {
    setLoadingFrame(true)
    setError('')
    const controller = startRequest()
    try {
      const snapshot = await callRp<RunSnapshot>('state', {}, controller.signal)
      if (alive.current) setFrame(snapshot.frame === '' ? 'Chưa có ván nào.' : snapshot.frame)
    } catch (caught) {
      if (!isAbort(caught) && alive.current) setError(messageOf(caught))
    } finally {
      if (alive.current) setLoadingFrame(false)
    }
  }, [startRequest])

  return (
    <div className="rp-body">
      <div className="rp-mode">
        {MODE_CHOICES.map(choice => (
          <label key={choice.id} className="rp-mode-option">
            <input type="radio" name="rp-mode" value={choice.id} checked={mode === choice.id} onChange={() => setMode(choice.id)} />
            <span className="rp-mode-label">{choice.label}</span>
            <span className="rp-mode-desc">{choice.description}</span>
          </label>
        ))}
      </div>
      <label className="rp-field">
        <span>Seed (bỏ trống thì lấy mốc thời gian)</span>
        <input className="rp-input" value={seed} onChange={event => setSeed(event.target.value)} placeholder="ví dụ: van-01" />
      </label>
      <div className="rp-row">
        <button type="button" className="rp-button rp-button-primary" disabled={drawing} onClick={() => void runDraw()}>
          {drawing ? 'Đang rút…' : 'Rút bài'}
        </button>
        <button type="button" className="rp-button" disabled={loadingFrame} onClick={() => void runState()}>
          {loadingFrame ? 'Đang tải…' : 'Tải lại trạng thái ván'}
        </button>
      </div>
      <ErrorLine message={error} />
      {result === null ? null : (
        <>
          <div className="rp-row">
            <Badge>{result.source === null ? 'trộn từ toàn pool' : `pack: ${result.source.title}`}</Badge>
            <Badge>chaos {result.chaos.total}</Badge>
            <Badge>mức {result.chaos.level}</Badge>
            <Badge>biến cố mỗi {result.chaos.eventEvery} lượt</Badge>
            <Badge>{result.winSteps} bước thắng</Badge>
          </div>
          <div className="rp-muted">ván {result.sceneId}</div>
          {result.meters.length === 0 ? null : (
            <div className="rp-list">{result.meters.map(meter => <MeterBar key={meter.id} meter={meter} />)}</div>
          )}
          {result.notes.length === 0 ? null : (
            <ul className="rp-notes">
              {result.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
            </ul>
          )}
          <div className="rp-field">
            <span>Briefing cho người chơi</span>
            <pre className="rp-pre">{result.briefing}</pre>
          </div>
        </>
      )}
      {frame === '' ? null : (
        <div className="rp-field">
          <span>Khung công khai của ván</span>
          <pre className="rp-pre">{frame}</pre>
        </div>
      )}
    </div>
  )
}

// ── Màn 3: Sửa card ────────────────────────────────────────────────────────

function EditorView({ send, cards, busy, initial, onSaved, onNeedCards }: {
  send: Send; cards: RpCard[] | null; busy: boolean; initial: RpCard | null
  onSaved: () => void; onNeedCards: () => void
}): ReactNode {
  const [draft, setDraft] = useState<CardDraft>(() => (initial === null ? blankDraft('card_moi') : draftFromCard(initial)))
  const [picked, setPicked] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedFile, setSavedFile] = useState('')

  const alive = useRef(true)
  const inFlight = useRef<AbortController | null>(null)
  const applied = useRef<RpCard | null>(initial)

  // Card được đẩy từ thư viện sang (nút "Sửa") chỉ nạp một lần cho mỗi lần đẩy.
  useEffect(() => {
    if (initial !== null && initial !== applied.current) {
      applied.current = initial
      setDraft(draftFromCard(initial))
    }
  }, [initial])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      inFlight.current?.abort()
    }
  }, [])

  const patch = useCallback((changes: Partial<CardDraft>): void => {
    setDraft(current => ({ ...current, ...changes }))
  }, [])

  const overLimit = FRAGMENT_ORDER.some(key => draft[key].length > FRAGMENT_LIMITS[key])

  const reset = useCallback((): void => {
    setDraft(blankDraft(newCardId()))
    setPicked('')
    setError('')
    setSavedFile('')
  }, [])

  const save = useCallback(async (): Promise<void> => {
    setSaving(true)
    setError('')
    setSavedFile('')
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    try {
      const value = asRecord(await send<unknown>('save-card', { card: draftToCardPayload(draft), replace: true }, controller.signal))
      if (alive.current) setSavedFile(str(value['file'], `đã lưu ${str(value['id'], draft.id.trim())}`))
      onSaved()
    } catch (caught) {
      if (!isAbort(caught) && alive.current) setError(messageOf(caught))
    } finally {
      if (alive.current) setSaving(false)
    }
  }, [draft, onSaved, send])

  const loadFromLibrary = useCallback((id: string): void => {
    setPicked(id)
    const found = (cards ?? []).find(card => card.id === id)
    if (found === undefined) return
    setDraft(draftFromCard(found))
    setError('')
    setSavedFile('')
  }, [cards])

  return (
    <div className="rp-body">
      <div className="rp-row">
        <button type="button" className="rp-button" onClick={reset}>Tạo card trống</button>
        <button type="button" className="rp-button" disabled={busy} onClick={onNeedCards}>Nạp lại thư viện</button>
      </div>
      <label className="rp-field">
        <span>Nạp từ thư viện</span>
        <select className="rp-select" value={picked} onFocus={onNeedCards} onChange={event => loadFromLibrary(event.target.value)}>
          <option value="">— chọn card có sẵn —</option>
          {(cards ?? []).map(card => (
            <option key={card.id} value={card.id}>{card.id} · {card.title === '' ? '(không tiêu đề)' : card.title}</option>
          ))}
        </select>
      </label>
      <label className="rp-field">
        <span>id</span>
        <input className="rp-input" value={draft.id} onChange={event => patch({ id: event.target.value })} />
      </label>
      <label className="rp-field">
        <span>Tiêu đề</span>
        <input className="rp-input" value={draft.title} onChange={event => patch({ title: event.target.value })} />
      </label>
      <div className="rp-grid-2">
        <label className="rp-field">
          <span>Loại</span>
          <select className="rp-select" value={draft.type} onChange={event => patch({ type: event.target.value })}>
            {CARD_TYPES.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="rp-field">
          <span>Hiển thị</span>
          <select className="rp-select" value={draft.visibility} onChange={event => patch({ visibility: event.target.value })}>
            {VISIBILITY_OPTIONS.map(item => <option key={item} value={item}>{VISIBILITY_LABELS[item]}</option>)}
          </select>
        </label>
        <label className="rp-field">
          <span>chaos (1–5)</span>
          <input className="rp-input" type="number" min={1} max={5} value={draft.chaos} onChange={event => patch({ chaos: Number(event.target.value) })} />
        </label>
        <label className="rp-field">
          <span>weight</span>
          <input className="rp-input" type="number" value={draft.weight} onChange={event => patch({ weight: Number(event.target.value) })} />
        </label>
      </div>
      <label className="rp-field">
        <span>Tags (cách nhau bằng dấu phẩy)</span>
        <input className="rp-input" value={draft.tags} onChange={event => patch({ tags: event.target.value })} placeholder="noir, thanh-pho, mua" />
      </label>
      <label className="rp-field">
        <span>Mô tả</span>
        <textarea className="rp-textarea" value={draft.description} onChange={event => patch({ description: event.target.value })} />
      </label>
      {FRAGMENT_ORDER.map(key => (
        <FragmentField key={key} label={FRAGMENT_LABELS[key]} value={draft[key]} limit={FRAGMENT_LIMITS[key]}
          hint={key === 'firstMessage' ? 'chỉ card loại opening mới dùng' : undefined}
          onChange={value => patch({ [key]: value })} />
      ))}
      {overLimit ? <div className="rp-error">Có mảnh vượt trần ký tự — host sẽ từ chối khi lưu.</div> : null}
      <ErrorLine message={error} />
      {savedFile === '' ? null : <div className="rp-ok">Đã lưu: {savedFile}</div>}
      <div className="rp-actions">
        <button type="button" className="rp-button rp-button-primary" disabled={saving || overLimit} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </div>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────

type ViewId = 'library' | 'draw' | 'editor'

const TABS: readonly { id: ViewId; label: string }[] = [
  { id: 'library', label: 'Thư viện' },
  { id: 'draw', label: 'Rút bài' },
  { id: 'editor', label: 'Sửa card' },
]

function RoleplayPanel({ sessionId }: { sessionId: string }): ReactNode {
  const [view, setView] = useState<ViewId>('library')
  const [status, setStatus] = useState<StatusSnapshot | null>(null)
  const [cards, setCards] = useState<RpCard[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<RpCard | null>(null)
  const [libraryLoaded, setLibraryLoaded] = useState(false)

  const alive = useRef(true)
  const inFlight = useRef<AbortController | null>(null)
  const autoLoaded = useRef(false)
  /** Nhớ lần nạp gần nhất có mở niệm phong hay không, để "Nạp lại" không tự niêm phong lại. */
  const revealed = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      inFlight.current?.abort()
    }
  }, [])

  const loadLibrary = useCallback(async (reveal: boolean): Promise<void> => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    revealed.current = reveal
    setBusy(true)
    setError('')
    try {
      const [nextStatus, nextCards] = await Promise.all([
        send<unknown>('status', {}, controller.signal),
        send<unknown>('cards', { reveal }, controller.signal),
      ])
      if (!alive.current) return
      const raw = asRecord(nextCards)
      setStatus(toStatus(nextStatus))
      setCards(Array.isArray(raw['cards']) ? (raw['cards'] as RpCard[]) : [])
      setLibraryLoaded(true)
    } catch (caught) {
      if (!isAbort(caught) && alive.current) setError(messageOf(caught))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  // Thư viện nạp ở lần hiện đầu tiên, không phải ở cấp module.
  useEffect(() => {
    if (!libraryLoaded && !autoLoaded.current) {
      autoLoaded.current = true
      void loadLibrary(false)
    }
  }, [libraryLoaded, loadLibrary])

  /** Nạp lại giữ nguyên trạng thái niêm phong đang có. */
  const refresh = useCallback((): void => {
    void loadLibrary(revealed.current)
  }, [loadLibrary])

  const reveal = useCallback((): void => {
    const confirmed = window.confirm(
      'Mở niệm phong sẽ hiện nguyên văn mảnh bí mật (hiddenTruth) của card gm_only.\n\n'
      + 'Nếu bạn là người chơi, việc này làm mất toàn bộ bất ngờ của ván.\n\nVẫn hiện nội dung?',
    )
    if (confirmed) void loadLibrary(true)
  }, [loadLibrary])

  const removeCard = useCallback((card: RpCard): void => {
    const name = card.title === '' ? card.id : card.title
    if (!window.confirm(`Xoá card "${name}" khỏi thư viện? Thao tác này không hoàn tác được.`)) return
    void (async () => {
      try {
        await send<unknown>('delete-card', { id: card.id })
        if (alive.current) refresh()
      } catch (caught) {
        if (!isAbort(caught) && alive.current) setError(messageOf(caught))
      }
    })()
  }, [refresh])

  const openEditor = useCallback((card: RpCard): void => {
    setEditing(card)
    setView('editor')
  }, [])

  const createCard = useCallback((): void => {
    setEditing(null)
    setView('editor')
  }, [])

  return (
    <div className="rp-root" data-rp-panel="" data-session={sessionId}>
      <div className="rp-header">
        <div className="rp-title">
          <span>Roleplay Machine</span>
        </div>
        <div className="rp-tabs">
          {TABS.map(tab => (
            <button key={tab.id} type="button" className={view === tab.id ? 'rp-tab rp-tab-active' : 'rp-tab'} onClick={() => setView(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {view === 'library' ? (
        <LibraryView
          status={status}
          cards={cards}
          busy={busy}
          error={error}
          onRefresh={refresh}
          onReveal={reveal}
          onEdit={openEditor}
          onDelete={removeCard}
        />
      ) : null}
      {view === 'draw' ? <DrawView send={send} /> : null}
      {view === 'editor' ? (
        <EditorView send={send} cards={cards} busy={busy} initial={editing} onSaved={refresh} onNeedCards={refresh} />
      ) : null}
      <div className="rp-row">
        <button type="button" className="rp-button" onClick={createCard}>Card mới</button>
        <span className="rp-muted">Card lưu vào pool của workspace.</span>
      </div>
    </div>
  )
}

function RoleplayPanelTitle(): ReactNode {
  return <span>Roleplay Machine</span>
}

// ── Đăng ký với host ───────────────────────────────────────────────────────

/** Gắn CSS vào tài liệu và trả về hàm gỡ, để `host.effect` dọn dẹp khi nạp lại. */
function mountStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const element = document.createElement('style')
  element.dataset['rpStyles'] = 'rp-machine'
  element.textContent = styles
  document.head.append(element)
  return () => {
    element.remove()
  }
}

/** Định nghĩa loại tab: tiêu đề động + dòng hướng dẫn trong menu "thêm tab". */
function tabDefinition(): Parameters<ClientHost['sidebarRightTabs']['register']>[0] {
  return {
    id: PANEL_TAB_ID,
    kind: PANEL_KIND,
    title: () => 'Roleplay Machine',
    guide: [{ order: 60, title: () => 'Roleplay Machine', description: () => 'Thư viện card, rút bài và sửa card.' }],
  }
}

/** Đăng ký thân tab và tiêu đề tab dưới cùng một khoá. */
export function apply(host: ClientHost): void {
  host.effect(() => mountStyles(), 'rp-machine: styles')
  host.effect(() => host.sidebarRightTabs.register(tabDefinition()), 'rp-machine: sidebar tab')

  host.slots.inject('sidebar.right.pane.tab', () => host.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PANEL_TAB_ID,
    inject: (sessionId: string) => ({ sessionId }),
  }, RoleplayPanel))

  host.slots.inject('sidebar.right.pane.tab.title', () => host.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: PANEL_TAB_ID,
    inject: (sessionId: string) => ({ sessionId }),
  }, RoleplayPanelTitle))
}
