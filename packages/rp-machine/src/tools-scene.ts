/**
 * Lớp tool mới cho DSH — chạy trên `card-schema` + `scene` + `runtime`.
 *
 * Thay hẳn bộ tool của MVP trước. Khác biệt cốt lõi:
 *  - Không còn "niêm phong thẻ ẩn" như một bước riêng: `hidden_truth` là một card trong pool, và tầng
 *    scene tự gom bí mật vào kênh GM.
 *  - Không còn một counter `suspicion`: có nhiều `tensionMeters` do card khai báo, cộng một thang OOC
 *    riêng.
 *  - Scene được sinh tất định theo seed và lưu lại, nên phục hồi được sau gián đoạn.
 *
 * Ranh giới bí mật vẫn là luật cứng: MỌI giá trị trả về từ tool đều có thể bị người chơi đọc. Vì vậy
 * không tool nào được trả `hiddenTruth`, mô tả bước thắng, hay luật Thiên Đạo. Những thứ đó chỉ đi qua
 * kênh `systemPrompt` (xem prompt.ts).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  CARD_TYPES,
  VISIBILITY_OPTIONS,
  cardsOfType,
  deleteCard,
  loadPool,
  normalizeCard,
  poolSummary,
  renderCardLine,
  writeCard,
  type Card,
  type CardType,
  type Visibility,
} from './card-schema'
import {
  COHERENCE_MODES,
  MODE_INFO,
  PLAY_MODES,
  SAMPLING_MODES,
  STRICTNESS_LEVELS,
  generateScene,
  listScenes,
  loadRecentCards,
  loadScene,
  recordRecentCards,
  renderPlayerBriefing,
  saveScene,
  sceneDirOf,
  type CardSource,
  type GeneratedScene,
  type PlayMode,
  type SceneSettings,
} from './scene'
import {
  RUN_SCHEMA_VERSION,
  adjustMeter,
  applyOocStrike,
  completeWinStep,
  detectPlayerSignals,
  findMeter,
  isEventDue,
  isTerminal,
  listRuns,
  loadRun,
  newRunState,
  recordTurn,
  renderEnding,
  renderPublicFrame,
  runDirOf,
  saveRun,
  setMeter,
  stepsDone,
  type RunState,
} from './runtime'
import type { PlayerAction } from './actor/perception'
import { neverWoken } from './actor/wake'
import { parseActorSetup, setupIsUsable } from './actor/setup'
import { createSpawnActorRunner, type SubagentRuntimeLike } from './actor/session'
import {
  ACTOR_SNAPSHOT_VERSION,
  buildActorReport,
  loadActorSnapshot,
  runActorTurn,
  saveActorSnapshot,
} from './actor/turn'
import {
  appendNarration,
  appendTurn,
  exportDirOf,
  loadStoryTurns,
  storyDirOf,
  transcriptFileOf,
  turnRecordFromActorTurn,
  turnRecordFromSingleTurn,
  withTurnOutcome,
  type StoryTurn,
} from './story/transcript'
import { POVS, buildStoryExport, povLabel, renderMaterial, type Pov, type StoryExport } from './story/export'
import { assertPovSafe, povForbidden, PovViolation } from './story/guard'
import {
  WRITER_LENGTHS,
  WRITER_OMIT,
  WRITER_STYLES,
  renderWriterPrompt,
  wordCount,
  type WriterBrief,
} from './story/brief'
import { createSpawnWriterRunner, type WriterRunner } from './story/session'
import type { ActorDefinition } from './actor/model'

export interface AgentLike {
  readonly id?: string
  readonly session?: {
    readonly header?: {
      readonly id?: string
      readonly cwd?: string
      /** `'subagent'` khi agent này là con của một lần delegate — actor mode dựa vào đó để cách ly. */
      readonly origin?: string
    }
  }
}

export interface ToolExecContext {
  readonly agent?: AgentLike
  readonly signal?: AbortSignal
}

export interface RpToolDeps {
  readonly workspaceRoot: (agent?: AgentLike) => string | undefined
  readonly now?: () => string
  /** Service `subagents` của DSH. Không có thì actor mode từ chối chạy, không chạy nửa vời. */
  readonly subagents?: SubagentRuntimeLike
  /** Provider cho actor. Mặc định `spawn`; `fork` bị từ chối vì kế thừa ngữ cảnh cha. */
  readonly actorProvider?: string
  readonly actorTimeoutMs?: number
  readonly log?: (message: string) => void
}

export interface RpToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => unknown }
  readonly execute: (args: Record<string, unknown>, exec?: ToolExecContext) => Promise<unknown> | unknown
}

export const RP_TOOL_NAMES: readonly string[] = [
  'rp_pool_status',
  'rp_list_cards',
  'rp_add_card',
  'rp_delete_card',
  'rp_new_scene',
  'rp_state',
  'rp_turn',
  'rp_step',
  'rp_meter',
  'rp_strike',
  'rp_grace',
  'rp_end',
  'rp_actor_cast',
  'rp_actor_turn',
  'rp_actor_state',
  'rp_log',
  'rp_export',
  'rp_write',
]

const SCENE_ID = { type: 'string', description: 'Định danh scene/ván (bỏ trống thì lấy ván mới nhất)' }

function jsonOutput(schema: Record<string, unknown>) {
  return {
    schema,
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}

/** Bỏ `readonly` để dựng dần từ tham số tool. */
type MutableSettings = { -readonly [K in keyof SceneSettings]: SceneSettings[K] }

/** Chuẩn hoá `settings` từ tham số tool, bỏ qua khoá lạ. */
function parseSettings(raw: unknown): Partial<SceneSettings> {
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const out: Partial<MutableSettings> = {}
  const pickEnum = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const value = record[key]
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
  }
  const coherence = pickEnum('coherence', COHERENCE_MODES)
  if (coherence !== undefined) out.coherence = coherence
  const sampling = pickEnum('samplingMode', SAMPLING_MODES)
  if (sampling !== undefined) out.samplingMode = sampling
  const strictness = pickEnum('strictness', STRICTNESS_LEVELS)
  if (strictness !== undefined) out.strictness = strictness
  for (const key of ['variety', 'compatibilityInfluence', 'cardWeightInfluence'] as const) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.min(100, Math.max(0, value))
  }
  if (typeof record['avoidRecentCards'] === 'boolean') out.avoidRecentCards = record['avoidRecentCards']
  if (typeof record['avoidSamePackClumping'] === 'boolean') out.avoidSamePackClumping = record['avoidSamePackClumping']
  return out
}

export function createRpTools(deps: RpToolDeps): RpToolDefinition[] {
  const now = (): string => (deps.now ?? (() => new Date().toISOString()))()

  const requireWorkspace = (exec?: ToolExecContext): string => {
    const root = deps.workspaceRoot(exec?.agent)
    if (root === undefined || root === '') {
      throw new Error('Chưa xác định được workspace của phiên — Roleplay Machine cần một workspace hợp lệ để lưu pool, scene và ván.')
    }
    return root
  }

  const poolDir = (root: string): string => path.join(root, 'roleplay-machine', 'pool')

  const sourcesOf = (packs: readonly { id: string; title: string; cards: readonly Card[] }[]): CardSource[] =>
    packs.map(pack => ({ id: pack.id, title: pack.title, cards: pack.cards }))

  /** Ván mới nhất, kèm scene của nó. Ném lỗi rõ ràng nếu chưa có. */
  const resolveRun = (root: string, args: Record<string, unknown>): { state: RunState; scene: GeneratedScene } => {
    const requested = typeof args['sceneId'] === 'string' ? args['sceneId'].trim() : ''
    const sceneId = requested !== '' ? requested : listRuns(root)[0]?.sceneId
    if (sceneId === undefined) throw new Error('Chưa có ván nào. Gọi rp_new_scene trước.')
    const state = loadRun(root, sceneId)
    if (state === undefined) throw new Error(`Không thấy ván "${sceneId}" trong ${runDirOf(root, sceneId)}`)
    const scene = loadScene(root, sceneId)
    if (scene === undefined) throw new Error(`Ván "${sceneId}" có nhưng thiếu file scene trong ${sceneDirOf(root)}`)
    return { state, scene }
  }

  const tools: RpToolDefinition[] = [
    {
      name: 'rp_pool_status',
      description: 'Xem tình trạng thư viện card, bộ nguồn (pack), scene và ván đang có trong workspace. Gọi khi bắt đầu một phiên.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          poolDir: { type: 'string' },
          total: { type: 'number' },
          byType: { type: 'object', additionalProperties: true },
          gmOnly: { type: 'number' },
          packs: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          scenes: { type: 'array', items: { type: 'object', additionalProperties: true } },
          runs: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      }),
      execute: (_args, exec) => {
        const root = requireWorkspace(exec)
        const dir = poolDir(root)
        const loaded = loadPool(dir)
        const summary = poolSummary(loaded.cards)
        return {
          ok: true,
          poolDir: dir,
          total: summary.total,
          byType: summary.byType,
          gmOnly: summary.gmOnly,
          packs: loaded.packs.length,
          issues: loaded.issues.map(issue => `${issue.where}: ${issue.message}`),
          scenes: listScenesSafe(root),
          runs: listRuns(root),
        }
      },
    },
    {
      name: 'rp_list_cards',
      description: 'Liệt kê card trong thư viện, lọc theo loại, mức hiển thị hoặc tag. Dùng khi người dùng muốn xem hoặc chọn card cụ thể.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...CARD_TYPES] },
          visibility: { type: 'string', enum: [...VISIBILITY_OPTIONS] },
          tag: { type: 'string' },
          limit: { type: 'number', description: 'Số card tối đa (mặc định 40)' },
        },
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          count: { type: 'number' },
          cards: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const loaded = loadPool(poolDir(root))
        const typeFilter = typeof args['type'] === 'string' ? args['type'] : undefined
        const visFilter = typeof args['visibility'] === 'string' ? args['visibility'] : undefined
        const tagFilter = typeof args['tag'] === 'string' ? args['tag'] : undefined
        const limit = Number.isFinite(Number(args['limit'])) ? Math.max(1, Number(args['limit'])) : 40
        const filtered = loaded.cards
          .filter(card => typeFilter === undefined || card.type === typeFilter)
          .filter(card => visFilter === undefined || card.visibility === visFilter)
          .filter(card => tagFilter === undefined || card.tags.includes(tagFilter))
          .slice(0, limit)
        return {
          ok: true,
          count: filtered.length,
          cards: filtered.map(card => ({
            id: card.id,
            type: card.type,
            title: card.title,
            chaos: card.chaos,
            visibility: card.visibility,
            weight: card.weight,
            tags: card.tags,
            line: renderCardLine(card),
          })),
        }
      },
    },
    {
      name: 'rp_add_card',
      description:
        'Thêm hoặc cập nhật một card theo schema rsm-card-v1 (8 loại, 5 fragment, visibility, weight, compatibility). Đây là chức năng "Tạo card".',
      parameters: {
        type: 'object',
        properties: {
          card: { type: 'object', additionalProperties: true, description: 'Card theo schema rsm-card-v1' },
          replace: { type: 'boolean', description: 'Cho phép ghi đè card cùng id' },
        },
        required: ['card'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          id: { type: 'string' },
          file: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const dir = poolDir(root)
        const result = normalizeCard(args['card'], 'card mới')
        if (result.card === undefined || result.issues.length > 0) {
          return { ok: false, issues: result.issues.map(issue => `${issue.where}: ${issue.message}`) }
        }
        const existing = loadPool(dir).cards.find(card => card.id === result.card?.id)
        if (existing !== undefined && args['replace'] !== true) {
          return { ok: false, id: result.card.id, issues: [`Card id "${result.card.id}" đã tồn tại; đặt id khác hoặc truyền replace=true`] }
        }
        const file = writeCard(dir, result.card)
        return { ok: true, id: result.card.id, file, issues: [] }
      },
    },
    {
      name: 'rp_delete_card',
      description: 'Xoá một card khỏi thư viện theo id. Không hoàn tác được.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: { ok: { type: 'boolean' }, id: { type: 'string' } },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const id = String(args['id'] ?? '').trim()
        return { ok: deleteCard(poolDir(root), id), id }
      },
    },
    {
      name: 'rp_new_scene',
      description:
        'Mở một ván mới: sinh scene tất định từ thư viện theo mode, chốt luật Thiên Đạo, khởi tạo trạng thái ván và trả về bản tóm tắt CÔNG KHAI cho người chơi.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: [...PLAY_MODES], description: PLAY_MODES.map(mode => `${mode} = "${MODE_INFO[mode].label}"`).join('; ') },
          seed: { type: 'string', description: 'Seed tuỳ chọn; cùng seed + cùng thư viện cho cùng scene' },
          picks: { type: 'object', additionalProperties: true, description: 'Card người chơi tự chọn theo loại, ví dụ {"world":"world_crimson_fang_castle"}' },
          settings: { type: 'object', additionalProperties: true, description: `Tuỳ chọn: coherence (${COHERENCE_MODES.join('|')}), samplingMode (${SAMPLING_MODES.join('|')}), strictness (${STRICTNESS_LEVELS.join('|')}), variety, compatibilityInfluence, cardWeightInfluence, avoidRecentCards, avoidSamePackClumping` },
        },
        required: ['mode'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          mode: { type: 'string' },
          source: { type: 'object', additionalProperties: true },
          chaos: { type: 'object', additionalProperties: true },
          briefing: { type: 'string' },
          meters: { type: 'array', items: { type: 'object', additionalProperties: true } },
          winSteps: { type: 'number' },
          frame: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
          next: { type: 'string' },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const mode = args['mode']
        if (typeof mode !== 'string' || !(PLAY_MODES as readonly string[]).includes(mode)) {
          throw new Error(`mode phải là một trong ${PLAY_MODES.join(', ')}`)
        }
        const dir = poolDir(root)
        const loaded = loadPool(dir)
        if (loaded.cards.length === 0) throw new Error(`Thư viện rỗng (${dir}). Hãy tạo card trước bằng rp_add_card.`)

        const stamp = now()
        const seed = typeof args['seed'] === 'string' && args['seed'].trim() !== '' ? args['seed'].trim() : stamp
        const picksRaw = typeof args['picks'] === 'object' && args['picks'] !== null ? (args['picks'] as Record<string, unknown>) : {}
        const picks: Partial<Record<CardType, string>> = {}
        for (const type of CARD_TYPES) {
          const value = picksRaw[type]
          if (typeof value === 'string' && value.trim() !== '') picks[type] = value.trim()
        }

        const outcome = generateScene(loaded.cards, {
          seed,
          mode: mode as PlayMode,
          picks,
          settings: parseSettings(args['settings']),
          sources: sourcesOf(loaded.packs),
          recentCardIds: loadRecentCards(root),
          now: stamp,
        })
        const scene = outcome.scene
        saveScene(root, scene)

        const state = newRunState(scene, stamp)
        saveRun(root, state)
        recordRecentCards(root, CARD_TYPES.map(type => scene.cards[type].id))

        return {
          ok: true,
          sceneId: scene.id,
          mode: scene.mode.id,
          source: scene.source,
          chaos: { total: scene.chaos.total, level: scene.chaos.level, eventEvery: scene.chaos.eventEvery },
          briefing: renderPlayerBriefing(scene),
          meters: state.meters,
          winSteps: state.winSteps.length,
          frame: renderPublicFrame(state),
          notes: outcome.notes,
          next: 'Kể mở màn theo briefing. Mỗi lượt gọi rp_turn TRƯỚC khi viết. Bí mật chỉ có trong kênh ngầm — không bao giờ nói thẳng.',
        }
      },
    },
    {
      name: 'rp_state',
      description: 'Đọc khung trạng thái CÔNG KHAI của ván (lượt, thanh căng thẳng, cảnh cáo, tiến độ dạng số). Gọi khi cần phục hồi sau gián đoạn.',
      parameters: { type: 'object', properties: { sceneId: SCENE_ID }, additionalProperties: false },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          status: { type: 'string' },
          frame: { type: 'string' },
          runs: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const runs = listRuns(root)
        if (runs.length === 0) return { ok: false, frame: 'Chưa có ván nào.', runs: [] }
        const { state } = resolveRun(root, args)
        return { ok: true, sceneId: state.sceneId, status: state.status, frame: renderPublicFrame(state), runs }
      },
    },
    {
      name: 'rp_turn',
      description:
        'Mở một lượt chơi: tăng số lượt, nhận diện tín hiệu OOC và tín hiệu "bí", và báo biến cố hỗn loạn nếu tới hạn. Gọi TRƯỚC khi kể lượt đó.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          playerAction: { type: 'string', description: 'Tóm tắt hành động/lời nói của người chơi trong lượt này' },
        },
        required: ['playerAction'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          turn: { type: 'number' },
          signals: { type: 'object', additionalProperties: true },
          eventDue: { type: 'boolean' },
          frame: { type: 'string' },
          instructions: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state, scene } = resolveRun(root, args)
        if (isTerminal(state.status)) {
          return { ok: false, turn: state.turn, eventDue: false, frame: renderPublicFrame(state), instructions: [renderEnding(state)] }
        }

        const action = String(args['playerAction'] ?? '').trim()
        const signals = detectPlayerSignals(action)
        const stamp = now()
        const next = recordTurn(state, action, '', stamp)
        const eventDue = isEventDue(next, scene.chaos.eventEvery)
        saveRun(root, next)

        // Ghi transcript cho cả chế độ một-model: export và writer phải chạy được ở cả hai chế độ.
        appendTurn(root, turnRecordFromSingleTurn({
          sceneId: next.sceneId,
          at: stamp,
          state: next,
          action: { actor: 'player', type: 'speak', text: action, volume: 'normal' },
          playerLocation: '',
        }))

        const instructions: string[] = []
        if (signals.bailout) {
          instructions.push('Người chơi tỏ ra bí: được phép gọi rp_grace để Thiên Đạo ban ơn (có giá: một thanh căng thẳng tăng 1).')
        }
        if (signals.meta) {
          instructions.push(`Có dấu hiệu nói ngoài truyện (${signals.reasons.join('; ')}). Phán theo danh sách điều bị cấm trong kênh ngầm: đúng là vi phạm thì gọi rp_strike; chỉ là câu hỏi trong vai thì bỏ qua.`)
        }
        if (eventDue) {
          instructions.push(`Lượt ${next.turn} tới hạn biến cố (chaos ${scene.chaos.level}): PHẢI đưa một biến cố đúng chất vào lượt này, không được bỏ qua.`)
        }
        if (stepsDone(next) === next.winSteps.length && next.status === 'won') {
          instructions.push('Máy trạng thái báo đã xong toàn bộ bước thắng: kể cái kết thật rồi gọi rp_end.')
        }
        if (next.meters.some(meter => meter.value >= meter.failAt - 1)) {
          instructions.push('Có thanh căng thẳng đang sát ngưỡng thua: để thế giới siết lại rõ rệt trong lượt này.')
        }

        return { ok: true, turn: next.turn, signals, eventDue, frame: renderPublicFrame(next), instructions }
      },
    },
    {
      name: 'rp_step',
      description: 'Đánh dấu một bước thắng đã hoàn thành trong truyện. Chỉ gọi khi hành động thực sự đã xảy ra.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          step: { type: 'string', description: 'Số thứ tự 1-based của bước thắng' },
          evidence: { type: 'string', description: 'Câu trong truyện chứng minh bước này đã xong' },
        },
        required: ['step'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          finished: { type: 'boolean' },
          stepsDone: { type: 'number' },
          stepsTotal: { type: 'number' },
          frame: { type: 'string' },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state } = resolveRun(root, args)
        const index = Number(args['step'])
        const result = completeWinStep(state, Number.isFinite(index) ? index : String(args['step'] ?? ''), now())
        if (result.ok) saveRun(root, result.state)
        return {
          ok: result.ok,
          message: result.text,
          finished: result.finished,
          stepsDone: stepsDone(result.state),
          stepsTotal: result.state.winSteps.length,
          frame: renderPublicFrame(result.state),
        }
      },
    },
    {
      name: 'rp_meter',
      description:
        'Đổi một thanh căng thẳng TRONG TRUYỆN (NPC bắt đầu ngờ, thời gian trôi, thân phận hao mòn...). Đây KHÔNG phải hình phạt OOC — vi phạm OOC dùng rp_strike.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          meterId: { type: 'string', description: 'Id thanh, lấy từ trường meters của rp_new_scene' },
          delta: { type: 'number', description: 'Mức thay đổi, ví dụ 1 hoặc -1' },
          value: { type: 'number', description: 'Hoặc đặt thẳng giá trị tuyệt đối' },
          reason: { type: 'string', description: 'Vì sao thanh này đổi' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          meters: { type: 'array', items: { type: 'object', additionalProperties: true } },
          failed: { type: 'boolean' },
          text: { type: 'string' },
          frame: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state } = resolveRun(root, args)
        const reason = String(args['reason'] ?? 'diễn biến trong truyện')
        const requested = typeof args['meterId'] === 'string' && args['meterId'].trim() !== '' ? args['meterId'].trim() : state.meters[0]?.id
        if (requested === undefined) {
          return { ok: false, issues: ['Ván này không có thanh căng thẳng nào.'], frame: renderPublicFrame(state) }
        }
        const result = typeof args['value'] === 'number'
          ? setMeter(state, requested, Number(args['value']), reason, now())
          : adjustMeter(state, requested, Number.isFinite(Number(args['delta'])) ? Number(args['delta']) : 1, reason, now())
        if (result.ok) saveRun(root, result.state)
        return { ok: result.ok, meters: result.state.meters, failed: result.failed, text: result.text, frame: renderPublicFrame(result.state), issues: result.ok ? [] : [result.text] }
      },
    },
    {
      name: 'rp_strike',
      description:
        'Cảnh cáo OOC khi người chơi phá khung: tự định nghĩa nhân vật chính, godmoding, nói ngoài truyện, dùng kiến thức ngoài thế giới. Đủ trần là bị trục xuất.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          reason: { type: 'string', description: 'Vi phạm cụ thể, ví dụ: tự nhận mình có kiếm bạc' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          strikes: { type: 'number' },
          max: { type: 'number' },
          ejected: { type: 'boolean' },
          text: { type: 'string' },
          frame: { type: 'string' },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state } = resolveRun(root, args)
        const result = applyOocStrike(state, String(args['reason'] ?? 'phá luật thế giới'), now())
        if (result.ok) saveRun(root, result.state)
        return {
          ok: result.ok,
          strikes: result.state.oocStrikes,
          max: result.state.maxOocStrikes,
          ejected: result.ejected,
          text: result.text,
          frame: renderPublicFrame(result.state),
        }
      },
    },
    {
      name: 'rp_grace',
      description:
        'Thiên Đạo ban ơn khi người chơi bí: mở một cánh cửa để ván đi tiếp. Có giá — một thanh căng thẳng tăng 1.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          meterId: { type: 'string', description: 'Thanh nào phải trả giá (mặc định thanh đầu)' },
          request: { type: 'string', description: 'Người chơi đang bí ở đâu' },
        },
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          meterId: { type: 'string' },
          cost: { type: 'string' },
          text: { type: 'string' },
          failed: { type: 'boolean' },
          frame: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state, scene } = resolveRun(root, args)
        const requested = typeof args['meterId'] === 'string' && args['meterId'].trim() !== '' ? args['meterId'].trim() : state.meters[0]?.id
        if (requested === undefined) {
          return { ok: false, issues: ['Ván này không có thanh căng thẳng nào để tính giá.'], frame: renderPublicFrame(state) }
        }
        const result = adjustMeter(state, requested, 1, 'nhận ơn của Thiên Đạo', now())
        if (result.ok) saveRun(root, result.state)
        const meter = findMeter(result.state, requested)
        return {
          ok: result.ok,
          meterId: requested,
          cost: `${meter?.label ?? requested} +1`,
          text: `【Thiên Đạo】Ngươi lạc lối. Ta ban cho ngươi một cánh cửa — nhưng cánh cửa nào cũng để lại dấu vết. Hãy mở đường bằng một sự kiện đúng chất "${scene.chaos.level}".`,
          failed: result.failed,
          frame: renderPublicFrame(result.state),
          issues: result.ok ? [] : [result.text],
        }
      },
    },
    {
      name: 'rp_end',
      description: 'Chốt ván và ghi epilogue. Chỉ gọi được khi máy trạng thái đã xác nhận kết thúc (thắng / thua / bị trục xuất).',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          epilogue: { type: 'string', description: 'Đoạn kết thật, viết theo những gì đã thực sự xảy ra trong ván' },
        },
        required: ['epilogue'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          status: { type: 'string' },
          reason: { type: 'string' },
          path: { type: 'string' },
          ending: { type: 'string' },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state, scene } = resolveRun(root, args)
        if (!isTerminal(state.status)) {
          return { ok: false, status: state.status, reason: 'Ván chưa kết thúc: máy trạng thái chưa xác nhận.', ending: renderEnding(state) }
        }
        const dir = runDirOf(root, state.sceneId)
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, 'ending.md')
        const body = [
          `# Kết ván ${state.sceneId}`,
          '',
          `- Trạng thái: ${state.status}`,
          `- Lý do: ${state.ending ?? ''}`,
          `- Số lượt: ${state.turn}`,
          `- Bước thắng: ${stepsDone(state)}/${state.winSteps.length}`,
          `- Cảnh cáo OOC: ${state.oocStrikes}/${state.maxOocStrikes}`,
          ...state.meters.map(meter => `- ${meter.label}: ${meter.value}/${meter.max} (thua ở ${meter.failAt})`),
          `- Chaos: ${scene.chaos.total}/40 (${scene.chaos.level})`,
          `- Nguồn: ${scene.source?.title ?? '(trộn từ toàn pool)'}`,
          '',
          '## Epilogue',
          '',
          String(args['epilogue'] ?? '').trim(),
          '',
        ].join('\n')
        fs.writeFileSync(file, body, 'utf8')
        return { ok: true, status: state.status, reason: state.ending ?? '', path: file, ending: renderEnding(state) }
      },
    },
    {
      name: 'rp_actor_cast',
      description:
        'Khai báo dàn actor cho Multi-Actor-Agent Mode: mỗi NPC là một agent riêng, chỉ biết những gì được khai trong allowedKnowledge của nó. Gọi một lần sau rp_new_scene, trước rp_actor_turn.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          cast: {
            type: 'array',
            description: 'Danh sách actor. Mỗi phần tử: id, kind, name, location, allowedKnowledge, perceive (và tuỳ chọn personality, goals, traits, act, watches, initialBeliefs).',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'snake_case, ví dụ npc_lucien' },
                kind: { type: 'string', enum: ['npc', 'faction', 'environment'] },
                name: { type: 'string' },
                role: { type: 'string' },
                location: { type: 'string' },
                personality: { type: 'object', description: 'trait → 0..5, chỉ ảnh hưởng cách nhập vai' },
                goals: { type: 'array', items: { type: 'string' } },
                allowedKnowledge: { type: 'array', items: { type: 'string' }, description: 'TOÀN BỘ những gì actor này được biết. Không có gì khác vào prompt của nó.' },
                initialBeliefs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { claim: { type: 'string' }, confidence: { type: 'number' } },
                    required: ['claim'],
                  },
                },
                traits: { type: 'object', description: 'trait → số. Chỉ đổi được trait đã khai ở đây.' },
                perceive: {
                  type: 'array',
                  items: { type: 'string', enum: ['same_room', 'addressed', 'loud_nearby', 'adjacent_presence', 'physical_change'] },
                },
                act: { type: 'array', items: { type: 'string' } },
                watches: { type: 'array', items: { type: 'string' }, description: 'id actor khác mà nó để mắt tới' },
              },
              required: ['id', 'kind', 'name', 'location', 'allowedKnowledge', 'perceive'],
            },
          },
          locations: {
            type: 'object',
            description: 'id địa điểm → { adjacent: [id...], sealed?: boolean, sameRoomAs?: id }. Quan hệ kề nên khai cả hai chiều.',
          },
          playerLocation: { type: 'string' },
          playerInventory: { type: 'array', items: { type: 'string' } },
          secretFacts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sự thật bị niêm phong, dùng làm danh sách cấm cho chốt chặn cô lập. Sự thật của scene đã được nạp sẵn; khai thêm ở đây nếu cần.',
          },
          endConditions: {
            type: 'array',
            description: 'Điều kiện kết thúc có cấu trúc: { id, outcome: won|lost|ejected, allOf: [{ kind: trait|flag|boolFlag|inventory|actorAlive, ... }] }',
            items: { type: 'object', additionalProperties: true },
          },
        },
        required: ['cast', 'locations'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          actors: { type: 'array', items: { type: 'object', additionalProperties: true } },
          locations: { type: 'array', items: { type: 'string' } },
          playerLocation: { type: 'string' },
          endConditions: { type: 'array', items: { type: 'string' } },
          issues: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state, scene } = resolveRun(root, args)
        const setup = parseActorSetup({
          sceneId: state.sceneId,
          cast: args['cast'],
          locations: args['locations'],
          playerLocation: args['playerLocation'],
          playerInventory: args['playerInventory'],
          endConditions: args['endConditions'],
          // Sự thật bị niêm phong của scene tự động vào danh sách cấm, khỏi phải khai tay.
          secretFacts: [scene.sceneCore.hiddenTruth, ...(Array.isArray(args['secretFacts']) ? (args['secretFacts'] as string[]) : [])],
        })

        if (!setupIsUsable(setup)) {
          return {
            ok: false,
            sceneId: state.sceneId,
            actors: [],
            locations: [],
            playerLocation: setup.playerLocation,
            endConditions: [],
            issues: ['Khai báo chưa dùng được: cần ít nhất một địa điểm và một actor hợp lệ.', ...setup.issues.map(issue => `${issue.where}: ${issue.message}`)],
          }
        }

        saveActorSnapshot(root, {
          schemaVersion: ACTOR_SNAPSHOT_VERSION,
          sceneId: state.sceneId,
          turn: state.turn,
          cast: setup.cast,
          locations: setup.locations,
          secretFacts: setup.secretFacts,
          endConditions: setup.endConditions,
          world: setup.world,
          notes: setup.issues.map(issue => `${issue.where}: ${issue.message}`),
        })

        return {
          ok: true,
          sceneId: state.sceneId,
          // Chỉ trả phần công khai: người chơi được biết có những ai, không được biết họ tin gì.
          actors: setup.cast.map(definition => ({
            id: definition.id,
            name: definition.name,
            role: definition.role,
            location: definition.location,
            perceives: definition.perceive,
            traits: Object.keys(definition.traits),
          })),
          locations: Object.keys(setup.locations),
          playerLocation: setup.playerLocation,
          endConditions: setup.endConditions.map(condition => `${condition.id} (${condition.outcome})`),
          issues: setup.issues.map(issue => `${issue.where}: ${issue.message}`),
        }
      },
    },
    {
      name: 'rp_actor_turn',
      description:
        'Chạy một lượt ở Multi-Actor-Agent Mode: agent NPC tự quyết định, Resolver chốt cái gì thành sự thật, rồi chỉ phát sự thật cho ai tri giác được nó. Gọi TRƯỚC khi kể lượt. Diễn biến riêng của từng actor đi qua kênh ngầm.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          playerAction: { type: 'string', description: 'Nguyên văn hành động/lời nói của người chơi trong lượt này' },
          actionType: { type: 'string', description: 'speak | persuasion | move | item_transfer | observe | ...' },
          volume: { type: 'string', enum: ['whisper', 'normal', 'loud'] },
          targetActorId: { type: 'string' },
          toLocation: { type: 'string', description: 'Địa điểm đích nếu người chơi di chuyển. Pipeline tự dựng event player_move và vẫn kiểm kề/niêm phong.' },
          item: { type: 'string', description: 'Tên món đồ nếu người chơi chuyển đồ' },
          itemFrom: { type: 'string', description: "'player' hoặc id địa điểm" },
          itemTo: { type: 'string', description: "'player' hoặc id địa điểm" },
          itemCount: { type: 'number' },
          maxAwake: { type: 'number', description: 'Trần số actor được gọi model trong lượt này (mặc định 4)' },
          force: { type: 'array', items: { type: 'string' }, description: 'Id actor bắt buộc đánh thức' },
        },
        required: ['playerAction'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          turn: { type: 'number' },
          signals: { type: 'object', additionalProperties: true },
          awake: { type: 'array', items: { type: 'string' } },
          awakeIds: { type: 'array', items: { type: 'string' } },
          publicLines: { type: 'array', items: { type: 'string' } },
          frame: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
          withheld: { type: 'number' },
          ended: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: async (args, exec) => {
        const root = requireWorkspace(exec)
        const { state } = resolveRun(root, args)
        if (isTerminal(state.status)) {
          return { ok: false, turn: state.turn, awake: [], publicLines: [], frame: renderPublicFrame(state), facts: [], withheld: 0, issues: [renderEnding(state)] }
        }
        const snapshot = loadActorSnapshot(root, state.sceneId)
        if (snapshot === undefined) {
          throw new Error('Ván này chưa ở Multi-Actor-Agent Mode. Gọi rp_actor_cast để khai dàn actor trước.')
        }

        const action: PlayerAction = {
          actor: 'player',
          type: typeof args['actionType'] === 'string' && args['actionType'].trim() !== '' ? args['actionType'].trim() : 'speak',
          text: String(args['playerAction'] ?? '').trim(),
          volume: args['volume'] === 'whisper' || args['volume'] === 'loud' ? args['volume'] : 'normal',
          ...(typeof args['targetActorId'] === 'string' && args['targetActorId'].trim() !== '' ? { targetActorId: args['targetActorId'].trim() } : {}),
          ...(typeof args['toLocation'] === 'string' && args['toLocation'].trim() !== '' ? { toLocation: args['toLocation'].trim() } : {}),
          ...(typeof args['item'] === 'string' && args['item'].trim() !== '' ? { item: args['item'].trim() } : {}),
          ...(typeof args['itemFrom'] === 'string' && args['itemFrom'].trim() !== '' ? { itemFrom: args['itemFrom'].trim() } : {}),
          ...(typeof args['itemTo'] === 'string' && args['itemTo'].trim() !== '' ? { itemTo: args['itemTo'].trim() } : {}),
          ...(Number.isFinite(Number(args['itemCount'])) ? { itemCount: Number(args['itemCount']) } : {}),
        }

        // Số lượt của ván nằm ở RunState, không nằm ở world state của actor. Không ghi vào đây thì mỗi
        // lượt actor đều là "lượt 1", và mọi thứ phụ thuộc số lượt (chaos event, ký ức, RNG) đều lệch.
        const signals = detectPlayerSignals(action.text)
        const recorded = recordTurn(state, action.text, '', now())

        const runner = createSpawnActorRunner({
          subagents: deps.subagents,
          ...(deps.actorProvider === undefined ? {} : { providerName: deps.actorProvider }),
          parent: exec?.agent,
          ...(deps.actorTimeoutMs === undefined ? {} : { timeoutMs: deps.actorTimeoutMs }),
          log: message => deps.log?.(`[rp-machine] ${message}`),
        })

        const turn = recorded.turn
        const result = await runActorTurn(
          {
            world: snapshot.world,
            definitions: snapshot.cast,
            action,
            turn,
            secretFacts: snapshot.secretFacts,
            ...(snapshot.pending === undefined ? {} : { pending: snapshot.pending }),
          },
          {
            runner,
            seed: state.seed,
            ...(Number.isFinite(Number(args['maxAwake'])) ? { maxAwake: Number(args['maxAwake']) } : {}),
            ...(Array.isArray(args['force'])
              ? { force: (args['force'] as unknown[]).filter((id): id is string => typeof id === 'string') }
              : {}),
            endConditions: snapshot.endConditions,
          },
        )

        // Điều kiện kết thúc của actor mode do code đánh giá, nên nó phải chốt được ván thật — nếu không
        // thì rp_actor_turn báo "đã kết thúc" mà rp_state/rp_end lại tưởng ván còn đang chơi.
        if (result.ended !== undefined) {
          recorded.status = result.ended.outcome === 'won' ? 'won' : result.ended.outcome === 'ejected' ? 'ejected' : 'lost'
          recorded.ending = `${result.ended.id}: ${result.ended.outcome}`
          recorded.endedAt = now()
        }
        saveRun(root, recorded)

        const report = buildActorReport({ sceneId: state.sceneId, result, definitions: snapshot.cast })
        saveActorSnapshot(root, {
          ...snapshot,
          turn,
          world: result.world,
          report,
          pending: result.pending,
          notes: [...snapshot.notes, ...result.issues.map(issue => `${issue.where}: ${issue.message}`)],
        })

        // Transcript là nguyên liệu của export/writer, và được ghi bằng CODE từ chính những gì pipeline đã
        // tính: ai tri giác được gì, actor hiểu gì, cái gì thành canon. Không tốn model call nào.
        appendTurn(root, turnRecordFromActorTurn({
          sceneId: state.sceneId,
          at: now(),
          state: recorded,
          definitions: snapshot.cast,
          action,
          result,
        }))

        return {
          ok: true,
          sceneId: state.sceneId,
          turn,
          signals,
          awake: result.awake.map(id => snapshot.cast.find(entry => entry.id === id)?.name ?? id),
          awakeIds: result.awake,
          publicLines: result.publicLines,
          frame: result.publicLines.length === 0
            ? `Không có gì mới trong tầm tri giác của người chơi ở ${result.world.player.location}.`
            : result.publicLines.join('\n'),
          facts: report.committed,
          withheld: result.broadcast.withheldEventIds.length,
          ...(result.ended === undefined ? {} : { ended: `${result.ended.id} (${result.ended.outcome})` }),
          issues: result.issues.map(issue => `${issue.where}: ${issue.message}`),
        }
      },
    },
    {
      name: 'rp_actor_state',
      description: 'Đọc trạng thái CÔNG KHAI của Multi-Actor-Agent Mode: ai đang ở đâu, ai đã từng được đánh thức, còn ai chưa từng nói. Không trả niềm tin hay ý định riêng.',
      parameters: { type: 'object', properties: { sceneId: SCENE_ID }, additionalProperties: false },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          turn: { type: 'number' },
          playerLocation: { type: 'string' },
          actors: { type: 'array', items: { type: 'object', additionalProperties: true } },
          neverWoken: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state } = resolveRun(root, args)
        const snapshot = loadActorSnapshot(root, state.sceneId)
        if (snapshot === undefined) return { ok: false, sceneId: state.sceneId, turn: state.turn, playerLocation: '', actors: [], neverWoken: [], notes: ['Ván này chưa ở Multi-Actor-Agent Mode.'] }

        return {
          ok: true,
          sceneId: state.sceneId,
          turn: snapshot.turn,
          playerLocation: snapshot.world.player.location,
          actors: snapshot.cast.map(definition => {
            const actorState = snapshot.world.actors[definition.id]
            return {
              id: definition.id,
              name: definition.name,
              role: definition.role,
              location: actorState?.location ?? definition.location,
              awakeTurns: actorState?.awakeTurns.length ?? 0,
              lastTurnAwake: actorState?.awakeTurns[actorState.awakeTurns.length - 1] ?? null,
            }
          }),
          neverWoken: neverWoken(snapshot.world).map(id => snapshot.cast.find(entry => entry.id === id)?.name ?? id),
          notes: snapshot.notes,
        }
      },
    },
    {
      name: 'rp_log',
      description:
        'Nộp lời kể bạn vừa viết cho lượt này để lưu vào transcript, và ghi lại HỆ QUẢ thật của lượt. Gọi NGAY SAU khi kể xong. Lời kể được dán nhãn "rendering, không phải canon" vì nó có thể chứa chi tiết bạn tự thêm.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          narration: { type: 'string', description: 'Nguyên văn lời kể của lượt này' },
          outcome: { type: 'string', description: 'Một câu: việc gì đã THỰC SỰ thay đổi trong lượt (không phải điều lẽ ra phải xảy ra)' },
          turn: { type: 'number', description: 'Số lượt; bỏ trống thì lấy lượt mới nhất' },
        },
        required: ['narration'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          turn: { type: 'number' },
          turns: { type: 'number' },
          narrated: { type: 'number' },
          outcome: { type: 'string' },
          transcript: { type: 'string' },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state } = resolveRun(root, args)
        const narration = String(args['narration'] ?? '').trim()
        if (narration === '') throw new Error('rp_log cần nội dung lời kể.')
        const turn = Number.isFinite(Number(args['turn'])) ? Number(args['turn']) : state.turn
        if (turn < 1) throw new Error('Chưa có lượt nào để gắn lời kể. Gọi rp_turn hoặc rp_actor_turn trước.')

        const outcome = String(args['outcome'] ?? '').trim()
        appendNarration(root, { sceneId: state.sceneId, turn, at: now(), narration, ...(outcome === '' ? {} : { outcome }) })

        // Vá `outcome` trong state.json: trước đây nó luôn rỗng vì hệ quả chỉ biết được sau khi kể.
        if (outcome !== '') saveRun(root, withTurnOutcome(state, turn, outcome))

        const turns = loadStoryTurns(root, state.sceneId)
        return {
          ok: true,
          sceneId: state.sceneId,
          turn,
          turns: turns.length,
          narrated: turns.filter(entry => entry.narration !== undefined && entry.narration !== '').length,
          outcome,
          transcript: transcriptFileOf(root, state.sceneId),
        }
      },
    },
    {
      name: 'rp_export',
      description:
        'Xuất toàn bộ ván thành hồ sơ lưu trữ: dòng thời gian sự thật, bản đồ ai biết gì, nội tâm actor, lời kể, và nguyên liệu cắt sẵn theo từng góc nhìn. Không gọi model. Trả về đường dẫn và số liệu, không trả nội dung bí mật.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          pov: { type: 'string', enum: [...POVS], description: 'Cắt thêm một tệp nguyên liệu cho góc nhìn này' },
          actorId: { type: 'string', description: 'Bắt buộc khi pov = npc' },
          allPovs: { type: 'boolean', description: 'Cắt nguyên liệu cho mọi góc nhìn của ván này' },
        },
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          dir: { type: 'string' },
          markdown: { type: 'string' },
          json: { type: 'string' },
          materials: { type: 'array', items: { type: 'object', additionalProperties: true } },
          summary: { type: 'object', additionalProperties: true },
          sections: { type: 'array', items: { type: 'string' } },
          issues: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: (args, exec) => {
        const root = requireWorkspace(exec)
        const { state, scene } = resolveRun(root, args)
        const turns = loadStoryTurns(root, state.sceneId)
        if (turns.length === 0) {
          throw new Error('Ván này chưa có lượt nào trong transcript. Transcript được ghi tự động ở mỗi lượt; hãy chơi ít nhất một lượt.')
        }
        const snapshot = loadActorSnapshot(root, state.sceneId)
        const definitions = snapshot?.cast ?? []
        const exp = buildStoryExport({
          sceneId: state.sceneId,
          generatedAt: now(),
          turns,
          scene,
          state,
          definitions,
          ...(snapshot === undefined ? {} : { world: snapshot.world }),
        })

        const dir = exportDirOf(root, state.sceneId)
        fs.mkdirSync(dir, { recursive: true })
        const markdownPath = path.join(dir, 'story.md')
        const jsonPath = path.join(dir, 'story.json')
        fs.writeFileSync(markdownPath, exp.markdown, 'utf8')
        fs.writeFileSync(jsonPath, `${JSON.stringify(exp.json, null, 2)}\n`, 'utf8')

        const materials: Array<{ pov: string; label: string; path: string; bytes: number }> = []
        const jobs: Array<{ pov: Pov; actorId?: string }> = []
        if (args['allPovs'] === true) {
          jobs.push({ pov: 'player' }, { pov: 'kami' }, { pov: 'omniscient' })
          // Mỗi actor một tệp nguyên liệu riêng: đây là chỗ POV3 trở thành cụ thể.
          for (const definition of definitions) jobs.push({ pov: 'npc', actorId: definition.id })
        }
        const single = typeof args['pov'] === 'string' ? args['pov'].trim() : ''
        if (single !== '') {
          if (!(POVS as readonly string[]).includes(single)) {
            throw new Error(`pov không hợp lệ: ${single}. Chọn một trong ${POVS.join(', ')}.`)
          }
          if (single === 'npc') {
            const actorId = typeof args['actorId'] === 'string' ? args['actorId'].trim() : ''
            if (actorId === '') throw new Error('pov = npc cần actorId.')
            if (!definitions.some(definition => definition.id === actorId)) {
              throw new Error(`Không có actor "${actorId}". Cast: ${definitions.map(definition => definition.id).join(', ') || '(rỗng)'}`)
            }
            jobs.push({ pov: 'npc', actorId })
          } else {
            jobs.push({ pov: single as Pov })
          }
        }

        for (const job of jobs) {
          const material = renderMaterial(exp, job.pov, job.actorId)
          const slug = job.actorId === undefined ? job.pov : `npc-${job.actorId}`
          const file = path.join(dir, `material-${slug}.md`)
          fs.writeFileSync(file, material, 'utf8')
          materials.push({ pov: job.pov, label: povLabel(job.pov, job.actorId, definitions), path: file, bytes: material.length })
        }

        return {
          ok: true,
          sceneId: state.sceneId,
          dir,
          markdown: markdownPath,
          json: jsonPath,
          materials,
          summary: exp.summary,
          sections: exp.sections.map(section => `${section.id}:${section.classification}`),
          issues: [],
        }
      },
    },
    {
      name: 'rp_write',
      description:
        'Viết lại ván thành truyện ngắn theo một góc nhìn, bằng một subagent writer có context sạch: nó CHỈ nhận hồ sơ đã cắt theo góc nhìn đó, không đọc được gì khác. Lưu vào runs/<id>/stories/. Trả về tiêu đề + đường dẫn + số từ; chỉ trả nội dung truyện khi góc nhìn là người chơi, hoặc khi reveal = true (người chơi đã đồng ý có spoil).',
      parameters: {
        type: 'object',
        properties: {
          sceneId: SCENE_ID,
          view: { type: 'string', enum: [...POVS], description: 'player = POV1 người chơi · npc = POV3 một nhân vật · kami = POV2 Thiên Đạo · omniscient = toàn tri' },
          actorId: { type: 'string', description: 'Bắt buộc khi view = npc' },
          length: { type: 'string', enum: [...WRITER_LENGTHS] },
          style: { type: 'string', enum: [...WRITER_STYLES] },
          focus: { type: 'string', description: 'Dặn thêm, ví dụ "tập trung vào quan hệ giữa đầu bếp và quản gia"' },
          omit: { type: 'array', items: { type: 'string' }, description: `Nhãn lược bỏ: ${WRITER_OMIT.join(', ')} — hoặc câu tự do` },
          language: { type: 'string' },
          allViews: { type: 'boolean', description: 'Viết song song POV1 + POV2 + POV3 cho mọi actor trong cast (tốn nhiều model call)' },
          reveal: { type: 'boolean', description: 'Trả cả nội dung truyện về kết quả tool. Chỉ dùng khi người chơi đã yêu cầu có spoil.' },
        },
        required: ['view'],
        additionalProperties: false,
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          sceneId: { type: 'string' },
          stories: { type: 'array', items: { type: 'object', additionalProperties: true } },
          body: { type: 'string' },
          title: { type: 'string' },
          guard: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      }),
      execute: async (args, exec) => {
        const root = requireWorkspace(exec)
        const { state, scene } = resolveRun(root, args)
        const turns = loadStoryTurns(root, state.sceneId)
        if (turns.length === 0) throw new Error('Ván này chưa có lượt nào trong transcript, nên chưa có gì để viết.')

        const snapshot = loadActorSnapshot(root, state.sceneId)
        const definitions = snapshot?.cast ?? []
        const exp = buildStoryExport({
          sceneId: state.sceneId,
          generatedAt: now(),
          turns,
          scene,
          state,
          definitions,
          ...(snapshot === undefined ? {} : { world: snapshot.world }),
        })

        const requests = planWriterRequests(args, definitions)
        const briefBase = {
          length: (WRITER_LENGTHS as readonly string[]).includes(String(args['length'])) ? (String(args['length']) as WriterBrief['length']) : 'medium' as const,
          style: (WRITER_STYLES as readonly string[]).includes(String(args['style'])) ? (String(args['style']) as WriterBrief['style']) : 'plain' as const,
          ...(typeof args['focus'] === 'string' && args['focus'].trim() !== '' ? { focus: args['focus'].trim() } : {}),
          ...(Array.isArray(args['omit']) ? { omit: (args['omit'] as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') } : {}),
          ...(typeof args['language'] === 'string' && args['language'].trim() !== '' ? { language: args['language'].trim() } : {}),
        }

        const runner = createSpawnWriterRunner({
          subagents: deps.subagents,
          ...(deps.actorProvider === undefined ? {} : { providerName: deps.actorProvider }),
          parent: exec?.agent,
          log: message => deps.log?.(`[rp-machine] ${message}`),
        })

        const storiesDir = storyDirOf(root, state.sceneId)
        fs.mkdirSync(storiesDir, { recursive: true })

        const results = await Promise.all(
          requests.map(request => writeOneStory({ exp, scene, turns, definitions, request, briefBase, runner, storiesDir, at: now() })),
        )

        const ok = results.every(entry => entry.written)
        const issues = results.flatMap(entry => entry.issues)
        const first = results.find(entry => entry.written && entry.body !== undefined)
        const reveal = args['reveal'] === true
        // Chỉ trả nội dung khi an toàn để người chơi đọc: POV1, hoặc khi họ đã đồng ý có spoil.
        const canReveal = reveal || requests.length === 1 && requests[0]?.pov === 'player'

        return {
          ok,
          sceneId: state.sceneId,
          stories: results.map(entry => ({
            view: entry.request.pov,
            ...(entry.request.actorId === undefined ? {} : { actorId: entry.request.actorId }),
            label: povLabel(entry.request.pov, entry.request.actorId, definitions),
            title: entry.title ?? '',
            path: entry.path ?? '',
            words: entry.words ?? 0,
            notes: entry.notes,
            guard: entry.guard,
          })),
          guard: results.every(entry => entry.guard === 'pass') ? 'pass' : 'violation',
          ...(canReveal && first?.body !== undefined ? { body: first.body, title: first.title ?? '' } : {}),
          issues,
        }
      },
    },
  ]

  return tools
}

// ── Writer: lập kế hoạch và chạy ──────────────────────────────────────────

interface WriterRequest {
  readonly pov: Pov
  readonly actorId?: string
}

/** Góc nhìn nào sẽ được viết trong lần gọi này. */
export function planWriterRequests(args: Record<string, unknown>, definitions: readonly ActorDefinition[]): WriterRequest[] {
  const castHint = definitions.map(definition => definition.id).join(', ') || '(rỗng)'

  if (args['allViews'] === true) {
    const requests: WriterRequest[] = [{ pov: 'player' }, { pov: 'kami' }]
    // Trần 3 actor: mỗi góc nhìn là một model call, và một ván 6 actor sẽ thành 8 call cho một lần bấm.
    for (const definition of definitions.slice(0, 3)) requests.push({ pov: 'npc', actorId: definition.id })
    return requests
  }

  const view = String(args['view'] ?? '').trim()
  if (!(POVS as readonly string[]).includes(view)) {
    throw new Error(`view không hợp lệ: "${view}". Chọn một trong ${POVS.join(', ')}.`)
  }
  if (view === 'npc') {
    const actorId = typeof args['actorId'] === 'string' ? args['actorId'].trim() : ''
    if (actorId === '') throw new Error('view = npc cần actorId.')
    if (!definitions.some(definition => definition.id === actorId)) {
      throw new Error(`Không có actor "${actorId}". Cast: ${castHint}`)
    }
    return [{ pov: 'npc', actorId }]
  }
  return [{ pov: view as Pov }]
}

interface WriteOutcome {
  readonly request: WriterRequest
  readonly written: boolean
  readonly path?: string
  readonly title?: string
  readonly words?: number
  readonly body?: string
  readonly notes: readonly string[]
  readonly guard: 'pass' | 'violation' | 'skipped'
  readonly issues: readonly string[]
}

function renderStoryFile(input: {
  readonly sceneId: string
  readonly label: string
  readonly brief: WriterBrief
  readonly title: string
  readonly body: string
  readonly notes: readonly string[]
  readonly words: number
  readonly at: string
}): string {
  const front = [
    '---',
    `scene: ${input.sceneId}`,
    `view: ${input.label}`,
    `length: ${input.brief.length}`,
    `style: ${input.brief.style}`,
    `words: ${input.words}`,
    `generated: ${input.at}`,
    'guard: không có chuỗi rò rỉ ngoài góc nhìn',
    '---',
    '',
    `# ${input.title}`,
    '',
    input.body,
  ].join('\n')
  if (input.notes.length === 0) return `${front}\n`
  return [
    front,
    '',
    '## Chi tiết người viết tự thêm (không có trong hồ sơ)',
    '',
    ...input.notes.map(note => `- ${note}`),
    '',
  ].join('\n')
}

async function writeOneStory(input: {
  readonly exp: StoryExport
  readonly scene: GeneratedScene
  readonly turns: readonly StoryTurn[]
  readonly definitions: readonly ActorDefinition[]
  readonly request: WriterRequest
  readonly briefBase: Omit<WriterBrief, 'pov' | 'actorId'>
  readonly runner: WriterRunner
  readonly storiesDir: string
  readonly at: string
}): Promise<WriteOutcome> {
  const { request } = input
  const brief: WriterBrief = {
    pov: request.pov,
    ...(request.actorId === undefined ? {} : { actorId: request.actorId }),
    ...input.briefBase,
  }

  const material = renderMaterial(input.exp, request.pov, request.actorId)
  const forbidden = povForbidden({
    pov: request.pov,
    ...(request.actorId === undefined ? {} : { actorId: request.actorId }),
    scene: input.scene,
    definitions: input.definitions,
    turns: input.turns,
    material,
  })
  const prompt = renderWriterPrompt({ exp: input.exp, brief, definitions: input.definitions })
  const label = request.actorId === undefined ? `writer:${request.pov}` : `writer:${request.pov}:${request.actorId}`

  const outcome = await input.runner.run({
    pov: request.pov,
    ...(request.actorId === undefined ? {} : { actorId: request.actorId }),
    label,
    prompt,
    forbidden,
  })
  const issues = [...outcome.issues]

  if (outcome.output === undefined) {
    return {
      request,
      written: false,
      notes: [],
      guard: 'skipped',
      issues: issues.length === 0 ? ['Writer không trả nội dung dùng được.'] : issues,
    }
  }

  const { title, body, notes } = outcome.output
  try {
    // Chốt chặn cuối, ngay trước khi ghi đĩa: một truyện rò rỉ thì KHÔNG bao giờ được lưu.
    assertPovSafe(`${title}\n${body}`, forbidden, request.pov)
  } catch (error) {
    const detail = error instanceof PovViolation
      ? error.leaked.map(entry => `${entry.source}: ${entry.text.slice(0, 80)}`).join(' | ')
      : String(error)
    return { request, written: false, notes, guard: 'violation', issues: [...issues, `Truyện bị chặn vì rò rỉ: ${detail}`] }
  }

  const slug = request.actorId === undefined ? request.pov : `${request.pov}-${request.actorId}`
  const file = path.join(input.storiesDir, `${slug}.md`)
  const words = wordCount(body)
  fs.writeFileSync(file, renderStoryFile({
    sceneId: input.exp.sceneId,
    label: povLabel(request.pov, request.actorId, input.definitions),
    brief,
    title,
    body,
    notes,
    words,
    at: input.at,
  }), 'utf8')

  return { request, written: true, path: file, title, words, body, notes, guard: 'pass', issues }
}

/** Liệt kê scene, chịu lỗi đọc file. */
function listScenesSafe(root: string): { id: string; mode: string; chaosTotal: number }[] {  try {
    return listScenes(root).map(scene => ({ id: scene.id, mode: scene.mode, chaosTotal: scene.chaosTotal }))
  } catch {
    return []
  }
}

export { RUN_SCHEMA_VERSION }
