/**
 * Runtime — trạng thái ván chơi và cưỡng chế luật.
 *
 * Hai trục HOÀN TOÀN TÁCH BIỆT, đây là điểm sửa quan trọng nhất so với cả bản cũ lẫn MVP trước:
 *
 *   oocStrikes      người chơi phá khung (tự định nghĩa nhân vật, godmoding, nói ngoài truyện).
 *                   Nguồn: `playerContract.forbiddenActions` + rubric. Đủ trần ⇒ bị trục xuất.
 *   tensionMeters   nguy hiểm TRONG TRUYỆN, do card `pressure` khai báo. Chạm `failAt` ⇒ thua.
 *
 * Gộp hai thứ lại — như RSM (`kamiSama.policy` + một thanh `suspicion` hardcode) và như MVP trước
 * (một counter `suspicion` gánh cả hai) — dẫn tới hoặc phạt oan người nhập vai, hoặc không bao giờ
 * trục xuất được ai. Một câu nói hớ trong vai làm nghi ngờ tăng là NỘI DUNG, không phải vi phạm.
 *
 * Trạng thái ván tự chứa phần cưỡng chế (nhãn thanh, trần, lời cảnh cáo) nên sống độc lập với file
 * scene; chỉ phần render kênh GM mới cần đọc lại scene để lấy bí mật và luật Thiên Đạo.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { GeneratedScene, PlayMode } from './scene'

export const RUN_SCHEMA_VERSION = 'rp-run-v1'

export type RunStatus = 'active' | 'won' | 'lost' | 'ejected'

export interface MeterState {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly failAt: number
}

export interface WinStepState {
  readonly id: string
  readonly description: string
  readonly done: boolean
}

export interface TurnRecord {
  readonly turn: number
  readonly action: string
  readonly outcome: string
  readonly at: string
}

export interface RunState {
  readonly schemaVersion: 'rp-run-v1'
  readonly sceneId: string
  readonly seed: string
  readonly mode: PlayMode
  readonly startedAt: string
  updatedAt: string
  turn: number
  status: RunStatus
  oocStrikes: number
  readonly maxOocStrikes: number
  readonly warningLine: string
  readonly terminationLine: string
  meters: MeterState[]
  winSteps: WinStepState[]
  readonly loseConditions: readonly string[]
  readonly flags: string[]
  readonly history: TurnRecord[]
  ending?: string
  endedAt?: string
}

/** Số cảnh cáo OOC cho phép, suy từ độ khắt khe của Thiên Đạo. Strict nhanh tay hơn. */
export function oocStrikeBudget(kamiStrictness: number): number {
  if (kamiStrictness >= 5) return 2
  if (kamiStrictness >= 3) return 3
  return 4
}

export function newRunState(scene: GeneratedScene, now: string): RunState {
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    sceneId: scene.id,
    seed: scene.seed,
    mode: scene.mode.id,
    startedAt: now,
    updatedAt: now,
    turn: 0,
    status: 'active',
    oocStrikes: 0,
    maxOocStrikes: oocStrikeBudget(scene.kamiSama.strictness),
    warningLine: scene.kamiSama.warningLine,
    terminationLine: scene.kamiSama.terminationLine,
    meters: scene.mechanics.tensionMeters.map(meter => ({
      id: meter.id,
      label: meter.label,
      value: Math.min(Math.max(meter.start, meter.min), meter.max),
      min: meter.min,
      max: meter.max,
      failAt: meter.failAt,
    })),
    winSteps: scene.mechanics.winSteps.map(step => ({ id: step.id, description: step.description, done: false })),
    loseConditions: scene.mechanics.loseConditions,
    flags: [],
    history: [],
  }
}

export function isTerminal(status: RunStatus): boolean {
  return status !== 'active'
}

// ── Tín hiệu tất định từ câu của người chơi ────────────────────────────────

export interface PlayerSignals {
  /** Người chơi tỏ ra bí — Thiên Đạo ban ơn thay vì phạt. */
  readonly bailout: boolean
  /** Dấu hiệu nói ngoài truyện / phá khung — ứng viên OOC để GM phán theo rubric. */
  readonly meta: boolean
  readonly reasons: readonly string[]
}

const META_PATTERNS: readonly { readonly re: RegExp; readonly reason: string }[] = [
  { re: /\b(ooc|out of character)\b/i, reason: 'nhắc tới OOC' },
  { re: /(ngoài truyện|ngoai truyen|bên ngoài câu chuyện)/i, reason: 'nói ngoài truyện' },
  { re: /\b(system prompt|prompt hệ thống|prompt he thong)\b/i, reason: 'nhắc tới prompt hệ thống' },
  { re: /(tôi là (tác giả|người chơi)|ta là tác giả)/i, reason: 'tự nhận là tác giả/người chơi' },
  { re: /\b(meta|godmode|god mode|powergaming)\b/i, reason: 'thuật ngữ meta/godmode' },
  { re: /(bỏ qua luật|bo qua luat|đổi luật|doi luat|reset lại ván|chơi lại từ đầu)/i, reason: 'đòi đổi luật/khởi động lại' },
]

const BAILOUT_PATTERNS: readonly RegExp[] = [
  /(tôi bí|tôi hết ý|bí quá|bí rồi|bế tắc|không nghĩ ra)/i,
  /(gợi ý|hint|cho tôi manh mối|mách nước)/i,
  /(giờ (tôi )?làm gì|giờ phải làm sao|biết làm gì bây giờ)/i,
  /\b(help|i'?m stuck)\b/i,
]

/**
 * Bắt tín hiệu thô từ câu người chơi. KHÔNG thay phán đoán của GM: nó chỉ chuyển thành chỉ dẫn để
 * GM áp rubric. Cố tình không để regex quyết định thay, vì regex rất dễ phạt oan người nhập vai.
 */
export function detectPlayerSignals(text: string): PlayerSignals {
  const reasons: string[] = []
  let meta = false
  for (const pattern of META_PATTERNS) {
    if (pattern.re.test(text)) {
      meta = true
      reasons.push(pattern.reason)
    }
  }
  let bailout = false
  for (const re of BAILOUT_PATTERNS) {
    if (re.test(text)) {
      bailout = true
      reasons.push('người chơi tỏ ra bí')
      break
    }
  }
  return { bailout, meta, reasons }
}

function clone(state: RunState): RunState {
  return {
    ...state,
    meters: state.meters.map(meter => ({ ...meter })),
    winSteps: state.winSteps.map(step => ({ ...step })),
    flags: [...state.flags],
    history: [...state.history],
  }
}

export interface StatusCheck {
  readonly status: RunStatus
  readonly reason: string
}

/** Máy trạng thái. Trạng thái kết thúc DÍNH: thắng rồi thì không thể thua vì một thanh chạm trần. */
export function evaluateStatus(state: RunState): StatusCheck {
  if (state.status === 'won') return { status: 'won', reason: 'đã hoàn thành toàn bộ bước thắng' }
  if (state.status === 'ejected') return { status: 'ejected', reason: `vượt ${state.maxOocStrikes} cảnh cáo OOC` }
  if (state.status === 'lost') return { status: 'lost', reason: 'một thanh căng thẳng đã chạm ngưỡng thua' }

  if (state.oocStrikes >= state.maxOocStrikes) {
    return { status: 'ejected', reason: `vượt ${state.maxOocStrikes} cảnh cáo OOC` }
  }
  const failed = state.meters.find(meter => meter.value >= meter.failAt)
  if (failed !== undefined) return { status: 'lost', reason: `${failed.label} chạm ${failed.failAt}` }
  if (state.winSteps.length > 0 && state.winSteps.every(step => step.done)) {
    return { status: 'won', reason: 'hoàn thành toàn bộ bước thắng' }
  }
  return { status: 'active', reason: 'đang chơi' }
}

function settle(state: RunState, now: string): RunState {
  const check = evaluateStatus(state)
  state.status = check.status
  state.updatedAt = now
  if (isTerminal(check.status)) {
    state.endedAt = state.endedAt ?? now
    state.ending = check.reason
  }
  return state
}

// ── Cổng OOC ───────────────────────────────────────────────────────────────

export interface OocResult {
  readonly state: RunState
  readonly ok: boolean
  readonly ejected: boolean
  readonly text: string
}

/** Ghi một vi phạm OOC. Đủ trần là bị trục xuất khỏi màn chơi. */
export function applyOocStrike(state: RunState, reason: string, now: string): OocResult {
  if (isTerminal(state.status)) {
    return { state, ok: false, ejected: state.status === 'ejected', text: `Ván đã kết thúc (${state.status}), không ghi thêm cảnh cáo.` }
  }
  const next = clone(state)
  next.oocStrikes = state.oocStrikes + 1
  next.flags.push(`ooc:${reason}`)
  settle(next, now)
  const ejected = next.status === 'ejected'
  const text = ejected
    ? `${next.terminationLine} (${reason})`
    : `${next.warningLine} Cảnh cáo ${next.oocStrikes}/${next.maxOocStrikes}: ${reason}`
  return { state: next, ok: true, ejected, text }
}

// ── Thanh căng thẳng ───────────────────────────────────────────────────────

export interface MeterResult {
  readonly state: RunState
  readonly ok: boolean
  readonly failed: boolean
  readonly text: string
}

export function findMeter(state: RunState, meterId: string): MeterState | undefined {
  return state.meters.find(meter => meter.id === meterId)
}

/** Đổi giá trị một thanh căng thẳng. Chạm `failAt` là thua. */
export function adjustMeter(state: RunState, meterId: string, delta: number, reason: string, now: string): MeterResult {
  if (isTerminal(state.status)) {
    return { state, ok: false, failed: state.status === 'lost', text: `Ván đã kết thúc (${state.status}).` }
  }
  const meter = findMeter(state, meterId)
  if (meter === undefined) {
    return { state, ok: false, failed: false, text: `Không có thanh "${meterId}" trong ván này.` }
  }
  const next = clone(state)
  const target = next.meters.find(entry => entry.id === meterId) as MeterState
  const value = Math.min(Math.max(meter.value + delta, meter.min), meter.max)
  ;(target as { value: number }).value = value
  next.flags.push(`meter:${meterId}:${delta >= 0 ? '+' : ''}${delta}`)
  settle(next, now)
  const failed = next.status === 'lost'
  const text = failed
    ? `${meter.label} chạm ${meter.failAt}. Thế giới khép lại quanh ngươi.`
    : `${meter.label} ${value}/${meter.max} (thua ở ${meter.failAt}) — ${reason}`
  return { state: next, ok: true, failed, text }
}

/** Đặt giá trị tuyệt đối cho một thanh. */
export function setMeter(state: RunState, meterId: string, value: number, reason: string, now: string): MeterResult {
  const meter = findMeter(state, meterId)
  if (meter === undefined) {
    return { state, ok: false, failed: false, text: `Không có thanh "${meterId}" trong ván này.` }
  }
  return adjustMeter(state, meterId, value - meter.value, reason, now)
}

// ── Bước thắng ─────────────────────────────────────────────────────────────

export interface StepResult {
  readonly state: RunState
  readonly ok: boolean
  readonly finished: boolean
  readonly text: string
}

/**
 * Đánh dấu một bước thắng đã hoàn thành trong truyện.
 *
 * Thông điệp trả về cố tình gọn: chỉ số thứ tự, vì `goal` là công khai nhưng bước thắng vẫn là văn
 * bản của card và không cần lặp lại nguyên văn trong output của tool.
 */
export function completeWinStep(state: RunState, step: number | string, now: string): StepResult {
  if (isTerminal(state.status)) {
    return { state, ok: false, finished: state.status === 'won', text: `Ván đã kết thúc (${state.status}).` }
  }
  const total = state.winSteps.length
  const index = typeof step === 'number' ? step - 1 : state.winSteps.findIndex(entry => entry.id === step)
  const target = state.winSteps[index]
  if (target === undefined) {
    const shown = typeof step === 'number' ? String(step) : '(id đã cho)'
    return { state, ok: false, finished: false, text: `Không thấy bước thắng ${shown} (ván này có ${total} bước).` }
  }
  if (target.done) {
    return { state, ok: false, finished: false, text: `Bước ${index + 1}/${total} đã xong trước đó.` }
  }
  const next = clone(state)
  const entry = next.winSteps[index] as WinStepState
  ;(entry as { done: boolean }).done = true
  settle(next, now)
  const finished = next.status === 'won'
  return {
    state: next,
    ok: true,
    finished,
    text: finished
      ? `Bước ${index + 1}/${total} hoàn tất. Toàn bộ bước thắng đã xong — ván chơi đi tới cái kết thật.`
      : `Bước ${index + 1}/${total} hoàn tất.`,
  }
}

export function stepsDone(state: RunState): number {
  return state.winSteps.filter(step => step.done).length
}

export function progressOf(state: RunState): number {
  if (state.winSteps.length === 0) return 0
  return Math.round((stepsDone(state) / state.winSteps.length) * 100)
}

// ── Lượt ───────────────────────────────────────────────────────────────────

export function recordTurn(state: RunState, action: string, outcome: string, now: string): RunState {
  if (isTerminal(state.status)) return state
  const next = clone(state)
  next.turn = state.turn + 1
  next.history.push({ turn: next.turn, action, outcome, at: now })
  if (next.history.length > 200) next.history.splice(0, next.history.length - 200)
  return settle(next, now)
}

/**
 * Nhịp biến cố cưỡng bức theo chaos. Trả true khi lượt này buộc phải có biến cố.
 * Bản cũ chỉ ghi chaos ra màn hình; ở đây nó điều khiển nhịp thật.
 */
export function isEventDue(state: RunState, eventEvery: number): boolean {
  if (eventEvery <= 0 || state.turn === 0) return false
  return state.turn % eventEvery === 0
}

// ── Render ─────────────────────────────────────────────────────────────────

/** Kênh CÔNG KHAI: người chơi đọc được. Không chứa `hiddenTruth` của bất kỳ card nào. */
export function renderPublicFrame(state: RunState): string {
  const lines: string[] = []
  lines.push(`【Ván】${state.sceneId} · lượt ${state.turn} · trạng thái ${state.status}`)
  if (state.meters.length > 0) {
    const meters = state.meters.map(meter => `${meter.label} ${meter.value}/${meter.max} (thua ở ${meter.failAt})`)
    lines.push(`【Thanh căng thẳng】${meters.join(' · ')}`)
  }
  lines.push(`【Cảnh cáo OOC】${state.oocStrikes}/${state.maxOocStrikes}`)
  lines.push(`【Tiến độ】${stepsDone(state)}/${state.winSteps.length} bước thắng`)
  return lines.join('\n')
}

/** Kênh GM: chứa bí mật, mô tả bước thắng, và toàn bộ luật Thiên Đạo. */
export function renderGmFrame(state: RunState, scene: GeneratedScene): string {
  const lines: string[] = []
  lines.push(`【Runtime】${state.sceneId} · lượt ${state.turn} · ${state.status}${state.ending === undefined ? '' : ` (${state.ending})`}`)
  lines.push(`Chaos ${scene.chaos.total}/40 (${scene.chaos.level}) — biến cố cưỡng bức mỗi ${scene.chaos.eventEvery} lượt.`)
  lines.push('')
  lines.push(`【SỰ THẬT BỊ NIÊM PHONG — không bao giờ nói thẳng】${scene.sceneCore.hiddenTruth}`)
  lines.push('')
  lines.push('Bước thắng (đếm bằng code, không tự chế):')
  for (const [index, step] of state.winSteps.entries()) {
    lines.push(`  ${index + 1}. [${step.done ? 'x' : ' '}] ${step.description}`)
  }
  lines.push(`Thua khi: ${state.loseConditions.join(' | ')}`)
  if (state.meters.length > 0) {
    lines.push('Thanh căng thẳng:')
    for (const meter of state.meters) {
      lines.push(`  ${meter.label}: ${meter.value}/${meter.max}, thua ở ${meter.failAt}`)
    }
  }
  lines.push(`Cảnh cáo OOC: ${state.oocStrikes}/${state.maxOocStrikes} — đủ trần là bị trục xuất.`)
  lines.push('')
  lines.push(`【Thiên Đạo — strictness ${scene.kamiSama.strictness}/5】`)
  for (const rule of scene.kamiSama.rules) lines.push(`  - ${rule}`)
  lines.push('')
  lines.push(`【Vai của người chơi — KHÔNG được tự định nghĩa lại】${scene.playerContract.role}`)
  if (scene.playerContract.forbiddenActions.length > 0) {
    lines.push('Người chơi KHÔNG được tự cho mình:')
    for (const action of scene.playerContract.forbiddenActions) lines.push(`  - ${action}`)
  }
  if (scene.derivation.derived.length > 0) {
    lines.push('')
    lines.push(`【Trường do máy suy ra】${scene.derivation.derived.join(' · ')}`)
  }
  return lines.join('\n')
}

export function renderEnding(state: RunState): string {
  switch (state.status) {
    case 'won':
      return `KẾT THẬT: người chơi đã hoàn thành mục tiêu. ${state.ending ?? ''}`.trim()
    case 'ejected':
      return `BAD END (bị trục xuất khỏi màn chơi): ${state.ending ?? ''}`.trim()
    case 'lost':
      return `BAD END: ${state.ending ?? ''}`.trim()
    case 'active':
      return 'Ván chơi chưa kết thúc.'
  }
}

// ── Lưu / đọc ──────────────────────────────────────────────────────────────

export function runsDirOf(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'roleplay-machine', 'runs')
}

export function runDirOf(workspaceRoot: string, sceneId: string): string {
  return path.join(runsDirOf(workspaceRoot), sceneId)
}

export function saveRun(workspaceRoot: string, state: RunState): string {
  const dir = runDirOf(workspaceRoot, state.sceneId)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'state.json')
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  return file
}

export function loadRun(workspaceRoot: string, sceneId: string): RunState | undefined {
  const file = path.join(runDirOf(workspaceRoot, sceneId), 'state.json')
  if (!fs.existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RunState
    return parsed?.schemaVersion === RUN_SCHEMA_VERSION ? parsed : undefined
  } catch {
    return undefined
  }
}

export interface RunSummary {
  readonly sceneId: string
  readonly status: RunStatus
  readonly turn: number
  readonly updatedAt: string
}

export function listRuns(workspaceRoot: string): RunSummary[] {
  const dir = runsDirOf(workspaceRoot)
  if (!fs.existsSync(dir)) return []
  const out: RunSummary[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const state = loadRun(workspaceRoot, entry.name)
    if (state === undefined) continue
    out.push({ sceneId: state.sceneId, status: state.status, turn: state.turn, updatedAt: state.updatedAt })
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}
