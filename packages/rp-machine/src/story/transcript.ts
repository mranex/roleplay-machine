/**
 * Transcript — nguyên liệu thô của câu chuyện, ghi bằng CODE.
 *
 * Vì sao không lấy log chat làm nguồn: log chat chứa cả kênh ngầm (`hiddenTruth`), cả OOC, cả nhắc nhở
 * hệ thống. Đưa nó cho writer là tự tay phá ranh giới mà tầng actor vừa dựng. Nguồn ở đây là **bản ghi
 * có cấu trúc của những gì thật sự xảy ra trong simulation**, cộng thêm lời kể mà Thiên Đạo tự nộp và
 * được dán nhãn riêng là "rendering, không phải canon".
 *
 * Phần lớn file này chạy không cần model: actor report mỗi lượt đã có sẵn diễn biến riêng, broadcast đã
 * có sẵn ai tri giác được gì. Trước đây cả hai bị vứt đi sau mỗi lượt.
 *
 * Định dạng: JSONL append-only. Một lượt một dòng; lời kể là một dòng riêng để `rp_log` không phải sửa
 * file (sửa file là mất tính append-only, và hỏng giữa chừng là mất cả lượt).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CanonicalEvent } from '../actor/events'
import { eventText } from '../actor/events'
import { playerPerception } from '../actor/broadcast'
import type { ActorDefinition, WorldState } from '../actor/model'
import type { PlayerAction } from '../actor/perception'
import type { ActorTurnResult } from '../actor/turn'
import type { ActorOutput } from '../actor/payload'
import type { RunState } from '../runtime'
import { runDirOf } from '../runtime'

export const TRANSCRIPT_VERSION = 'rp-transcript-v1'
export const STORY_MODES = ['actor', 'single'] as const
export type StoryMode = (typeof STORY_MODES)[number]

/** Một người nhận được một sự kiện, ở mức nào. Đây chính là ô của bản đồ dramatic irony. */
export interface TranscriptPerception {
  readonly actorId: string
  readonly name: string
  readonly fidelity: string
  readonly received: string
}

export interface TranscriptEvent {
  readonly id: string
  readonly type: string
  readonly source: string
  readonly sourceName: string
  readonly location: string
  readonly target?: string
  /** Câu mô tả trung tính của chính event — không phải văn. */
  readonly text: string
  /** `private` = chưa từng tới tay người chơi. */
  readonly visibility: 'public' | 'private'
  readonly playerFidelity: string
  readonly playerReceived: string
  readonly perceivedBy: readonly TranscriptPerception[]
}

/** Diễn biến riêng của một actor trong một lượt. Niềm tin ở đây CÓ THỂ SAI so với canon. */
export interface TranscriptActorTurn {
  readonly id: string
  readonly name: string
  readonly perceived: string
  readonly interpretation: string
  readonly emotion: string
  readonly intent: string
  readonly intentContent: string
  readonly target?: string
  readonly plan?: string
  readonly beliefs: readonly string[]
}

export interface TranscriptMeter {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly max: number
  readonly failAt: number
}

/** Một lượt: hành động người chơi, sự thật đã commit, ai biết gì, nội tâm actor. */
export interface TranscriptTurn {
  readonly kind: 'turn'
  readonly version: string
  readonly sceneId: string
  readonly mode: StoryMode
  readonly turn: number
  readonly at: string
  readonly playerAction: string
  readonly playerActionType: string
  readonly playerLocation: string
  readonly events: readonly TranscriptEvent[]
  /** Chỉ những gì người chơi tri giác được VÀ có ngữ nghĩa. */
  readonly playerPerceived: readonly string[]
  /** Sự thật công khai mà người chơi không tri giác được. */
  readonly withheld: readonly string[]
  /** Ý định chưa thành sự thật — chỉ Thiên Đạo thấy. */
  readonly privateEvents: readonly string[]
  readonly actors: readonly TranscriptActorTurn[]
  readonly meters: readonly TranscriptMeter[]
  readonly oocStrikes: number
  readonly status: string
  readonly ending?: string
}

/** Lời kể do Thiên Đạo nộp. KHÔNG phải canon: có thể chứa chi tiết nó tự thêm. */
export interface TranscriptNarration {
  readonly kind: 'narration'
  readonly version: string
  readonly sceneId: string
  readonly turn: number
  readonly at: string
  readonly narration: string
  readonly outcome?: string
}

export type TranscriptRecord = TranscriptTurn | TranscriptNarration

/** Một lượt đã hợp nhất với lời kể của nó. */
export interface StoryTurn extends TranscriptTurn {
  readonly narration?: string
  readonly outcome?: string
}

// ── Đường dẫn ──────────────────────────────────────────────────────────────

export function transcriptFileOf(workspaceRoot: string, sceneId: string): string {
  return path.join(runDirOf(workspaceRoot, sceneId), 'transcript.jsonl')
}

export function storyDirOf(workspaceRoot: string, sceneId: string): string {
  return path.join(runDirOf(workspaceRoot, sceneId), 'stories')
}

export function exportDirOf(workspaceRoot: string, sceneId: string): string {
  return path.join(runDirOf(workspaceRoot, sceneId), 'export')
}

/**
 * Gắn hệ quả thật vào lượt tương ứng trong `state.json`.
 *
 * Đây là chỗ sửa lỗi cũ: `recordTurn` được gọi với `outcome = ''` ở cả `rp_turn` lẫn `rp_actor_turn`, nên
 * `history[].outcome` chưa bao giờ có nội dung. Hệ quả chỉ biết được sau khi kể xong, nên nó được vá ở
 * đây chứ không phải lúc mở lượt.
 */
export function withTurnOutcome(state: RunState, turn: number, outcome: string): RunState {
  const trimmed = outcome.trim()
  if (trimmed === '') return state
  return { ...state, history: state.history.map(entry => (entry.turn === turn ? { ...entry, outcome: trimmed } : entry)) }
}

// ── Ghi ───────────────────────────────────────────────────────────────────

export function appendTranscript(workspaceRoot: string, sceneId: string, record: TranscriptRecord): string {
  const file = transcriptFileOf(workspaceRoot, sceneId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
  return file
}

/** Dựng bản ghi một lượt từ kết quả pipeline actor. Toàn bộ ở đây là code, không có model. */
export function turnRecordFromActorTurn(input: {
  readonly sceneId: string
  readonly at: string
  readonly state: RunState
  readonly definitions: readonly ActorDefinition[]
  readonly action: PlayerAction
  readonly result: ActorTurnResult
}): TranscriptTurn {
  const { result, definitions } = input
  const nameOf = (id: string): string => definitions.find(entry => entry.id === id)?.name ?? id

  const byEvent = new Map<string, TranscriptPerception[]>()
  for (const entry of result.broadcast.entries) {
    const list = byEvent.get(entry.eventId) ?? []
    list.push({ actorId: entry.actorId, name: nameOf(entry.actorId), fidelity: entry.fidelity, received: entry.received })
    byEvent.set(entry.eventId, list)
  }

  const events: TranscriptEvent[] = result.committed.map(event => {
    const player = playerPerception(event, result.world)
    return {
      id: event.id,
      type: event.type,
      source: event.source,
      sourceName: event.source === 'player' ? 'Người chơi' : nameOf(event.source),
      location: event.location,
      ...(event.target === undefined ? {} : { target: event.target }),
      text: eventText(event),
      visibility: event.visibility,
      playerFidelity: player.fidelity,
      playerReceived: player.received,
      perceivedBy: (byEvent.get(event.id) ?? []).slice().sort((a, b) => (a.actorId < b.actorId ? -1 : 1)),
    }
  })

  const outputOf = new Map<string, ActorOutput>()
  for (const output of result.outputs) outputOf.set(output.actorId, output)

  const receivedOf = new Map<string, string>()
  for (const decision of result.decisions) {
    if (decision.wake && decision.received !== '') receivedOf.set(decision.actorId, decision.received)
  }

  // Chỉ actor được đánh thức mới có diễn biến riêng trong lượt này.
  const actors: TranscriptActorTurn[] = result.awake.flatMap(actorId => {
    const output = outputOf.get(actorId)
    if (output === undefined) return []
    return [{
      id: actorId,
      name: nameOf(actorId),
      perceived: receivedOf.get(actorId) ?? '',
      interpretation: output.interpretation,
      emotion: output.emotion,
      intent: output.intent.type,
      intentContent: output.intent.content,
      ...(output.intent.target === undefined ? {} : { target: output.intent.target }),
      ...(output.plan === undefined ? {} : { plan: `${output.plan.goal} — chờ: ${output.plan.trigger}` }),
      beliefs: output.beliefClaims.map(claim => `${claim.claim} (${Math.round(claim.confidence * 100)}%)`),
    }]
  })

  const withheldText = new Map<string, string>()
  for (const event of result.committed) withheldText.set(event.id, eventText(event))

  return {
    kind: 'turn',
    version: TRANSCRIPT_VERSION,
    sceneId: input.sceneId,
    mode: 'actor',
    turn: result.world.turn,
    at: input.at,
    playerAction: input.action.text,
    playerActionType: input.action.type,
    playerLocation: result.world.player.location,
    events,
    playerPerceived: [...result.publicLines],
    withheld: result.broadcast.withheldEventIds.map(id => withheldText.get(id) ?? id),
    privateEvents: [...result.broadcast.privateLines],
    actors,
    meters: input.state.meters.map(meter => ({ id: meter.id, label: meter.label, value: meter.value, max: meter.max, failAt: meter.failAt })),
    oocStrikes: input.state.oocStrikes,
    status: input.state.status,
    ...(input.state.ending === undefined ? {} : { ending: input.state.ending }),
  }
}

/** Bản ghi lượt cho chế độ một-model (không có actor). Cùng schema, `actors` rỗng. */
export function turnRecordFromSingleTurn(input: {
  readonly sceneId: string
  readonly at: string
  readonly state: RunState
  readonly action: PlayerAction
  readonly playerLocation: string
  readonly playerPerceived?: readonly string[]
}): TranscriptTurn {
  return {
    kind: 'turn',
    version: TRANSCRIPT_VERSION,
    sceneId: input.sceneId,
    mode: 'single',
    turn: input.state.turn,
    at: input.at,
    playerAction: input.action.text,
    playerActionType: input.action.type,
    playerLocation: input.playerLocation,
    events: [],
    playerPerceived: [...(input.playerPerceived ?? [])],
    withheld: [],
    privateEvents: [],
    actors: [],
    meters: input.state.meters.map(meter => ({ id: meter.id, label: meter.label, value: meter.value, max: meter.max, failAt: meter.failAt })),
    oocStrikes: input.state.oocStrikes,
    status: input.state.status,
    ...(input.state.ending === undefined ? {} : { ending: input.state.ending }),
  }
}

/** Ghi lời kể của Thiên Đạo. Không sửa dòng cũ: JSONL append-only. */
export function appendNarration(workspaceRoot: string, input: {
  readonly sceneId: string
  readonly turn: number
  readonly at: string
  readonly narration: string
  readonly outcome?: string
}): string {
  const record: TranscriptNarration = {
    kind: 'narration',
    version: TRANSCRIPT_VERSION,
    sceneId: input.sceneId,
    turn: input.turn,
    at: input.at,
    narration: input.narration,
    ...(input.outcome === undefined || input.outcome === '' ? {} : { outcome: input.outcome }),
  }
  return appendTranscript(workspaceRoot, input.sceneId, record)
}

/** Ghi một lượt (dùng cho cả `rp_turn` và `rp_actor_turn`). */
export function appendTurn(workspaceRoot: string, record: TranscriptTurn): string {
  return appendTranscript(workspaceRoot, record.sceneId, record)
}

// ── Đọc ───────────────────────────────────────────────────────────────────

/** Đọc thô, chịu được dòng hỏng (file append-only có thể bị cắt giữa chừng). */
export function readTranscript(workspaceRoot: string, sceneId: string): TranscriptRecord[] {
  const file = transcriptFileOf(workspaceRoot, sceneId)
  if (!fs.existsSync(file)) return []
  const out: TranscriptRecord[] = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const parsed = JSON.parse(trimmed) as TranscriptRecord
      if (parsed?.version === TRANSCRIPT_VERSION && (parsed.kind === 'turn' || parsed.kind === 'narration')) out.push(parsed)
    } catch {
      continue
    }
  }
  return out
}

/**
 * Lượt đã hợp nhất với lời kể.
 *
 * Lời kể gắn theo `turn`; nếu Thiên Đạo nộp muộn (sau khi lượt sau đã bắt đầu) thì nó vẫn gắn đúng lượt
 * của nó — vì hợp nhất theo số lượt, không theo thứ tự dòng.
 */
export function loadStoryTurns(workspaceRoot: string, sceneId: string): StoryTurn[] {
  const records = readTranscript(workspaceRoot, sceneId)
  const turns: StoryTurn[] = []
  const index = new Map<number, number>()

  for (const record of records) {
    if (record.kind === 'turn') {
      index.set(record.turn, turns.length)
      turns.push({ ...record })
    }
  }

  for (const record of records) {
    if (record.kind !== 'narration') continue
    const position = index.get(record.turn)
    if (position === undefined) continue
    const current = turns[position] as StoryTurn
    turns[position] = {
      ...current,
      narration: record.narration,
      ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
    }
  }

  return turns.sort((a, b) => a.turn - b.turn)
}

/** Tổng hợp nhanh, không chứa nội dung bí mật. */
export function transcriptSummary(turns: readonly StoryTurn[]): {
  readonly turns: number
  readonly narrated: number
  readonly events: number
  readonly privateEvents: number
  readonly withheld: number
  readonly actorTurns: number
  readonly modes: readonly StoryMode[]
} {
  return {
    turns: turns.length,
    narrated: turns.filter(turn => turn.narration !== undefined && turn.narration !== '').length,
    events: turns.reduce((sum, turn) => sum + turn.events.length, 0),
    privateEvents: turns.reduce((sum, turn) => sum + turn.privateEvents.length, 0),
    withheld: turns.reduce((sum, turn) => sum + turn.withheld.length, 0),
    actorTurns: turns.reduce((sum, turn) => sum + turn.actors.length, 0),
    modes: [...new Set(turns.map(turn => turn.mode))],
  }
}

/** World state hiện tại, để export biết ai đang ở đâu. */
export function worldLocationsLine(world: WorldState | undefined): string {
  if (world === undefined) return ''
  return Object.values(world.actors)
    .map(actor => `${actor.id}@${actor.location}`)
    .sort()
    .join(', ')
}

/** Danh sách ván đã có transcript, mới nhất trước (dựa trên lượt cuối ghi được). */
export function listStoryScenes(workspaceRoot: string, sceneIds: readonly string[]): string[] {
  return sceneIds.filter(sceneId => fs.existsSync(transcriptFileOf(workspaceRoot, sceneId)))
}

export type { CanonicalEvent }
