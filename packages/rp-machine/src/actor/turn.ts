/**
 * Pipeline một lượt của Multi-Actor-Agent Mode.
 *
 * Thứ tự các bước ở đây KHÔNG tuỳ tiện — nó là bản vẽ của spec §11–§15, và mỗi thứ tự đều có lý do:
 *
 *   1. định tuyến hành động người chơi  (ai thấy gì, ở mức nào)
 *   2. chọn actor thức                  (không gọi hết mọi actor mỗi lượt)
 *   3. dựng payload + kiểm cô lập       (trước khi ghi ký ức, để ký ức không lặp lại trong "vừa xảy ra")
 *   4. gọi actor song song              (mỗi đứa một session mới, không thấy nhau)
 *   5. ghi ký ức cho actor đã thức      (actor ngủ không nhận gì)
 *   6. Resolver: đề xuất → kiểm → commit (đây là chỗ duy nhất thế giới đổi)
 *   7. ghi niềm tin/kế hoạch riêng      (không phải canon, không bao giờ đồng bộ ngược)
 *   8. broadcast có chọn lọc            (ai được biết sự thật vừa sinh ra)
 *   9. kiểm điều kiện kết thúc          (code quyết, không phải model)
 *
 * Hai chốt kiến trúc nằm ở bước 3 và bước 8, và cả hai đều kiểm được mà không cần model.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CanonicalEvent } from './events'
import type { ActorDefinition, LocationSpec, WorldState } from './model'
import { buildActorPayload, buildForbiddenList, renderActorPrompt, type ActorOutput } from './payload'
import { listRuns, runDirOf } from '../runtime'
import {
  mergePerceptions,
  routePlayerAction,
  type Perception,
  type PerceptionMap,
  type PlayerAction,
} from './perception'
import { applyObservations, selectAwakeActors, type WakeDecision } from './wake'
import { routeCanonicalEvents, type BroadcastResult } from './broadcast'
import {
  commitActorBeliefs,
  commitEvents,
  evaluateEndConditions,
  proposeEvents,
  type EndCondition,
  type RejectedEvent,
} from './resolve'
import type { ActorRunner, ActorRunOutcome } from './session'

export interface ActorTurnIssue {
  readonly where: string
  readonly message: string
}

export interface ActorTurnInput {
  readonly world: WorldState
  readonly definitions: readonly ActorDefinition[]
  /** Hành động của người chơi ở lượt này. */
  readonly action: PlayerAction
  readonly turn: number
  /** Sự thật bị niêm phong — chỉ dùng để dựng danh sách cấm cho chốt chặn cô lập. */
  readonly secretFacts?: readonly string[]
  /**
   * Tri giác còn nợ từ lượt trước: actor đã nghe thấy nhưng chưa có dịp phản ứng. Không có tham số này
   * thì NPC chỉ phản ứng khi người chơi hành động, và một cuộc nói chuyện giữa hai NPC sẽ đứng im.
   */
  readonly pending?: PerceptionMap
}

export interface ActorTurnDeps {
  readonly runner: ActorRunner
  readonly seed?: string | number
  readonly maxAwake?: number
  /** Id bị đánh thức bắt buộc, bất kể tri giác (Thiên Đạo yêu cầu). */
  readonly force?: readonly string[]
  readonly endConditions?: readonly EndCondition[]
  readonly log?: (message: string) => void
}

export interface ActorTurnResult {
  readonly world: WorldState
  readonly decisions: readonly WakeDecision[]
  readonly awake: readonly string[]
  readonly sleeping: readonly string[]
  readonly outputs: readonly ActorOutput[]
  /** Event Resolver đề xuất từ output của actor. */
  readonly proposed: readonly CanonicalEvent[]
  readonly committed: readonly CanonicalEvent[]
  readonly rejected: readonly RejectedEvent[]
  readonly broadcast: BroadcastResult
  /** Thứ duy nhất narrator được kể. */
  readonly publicLines: readonly string[]
  /** Tri giác còn nợ cho lượt sau. */
  readonly pending: PerceptionMap
  readonly ended?: EndCondition
  readonly issues: readonly ActorTurnIssue[]
}

/**
 * Hành động VẬT LÝ mà chính người chơi tuyên bố, dựng thành event canonical.
 *
 * Vì sao pipeline phải làm việc này thay vì để Resolver đề xuất: người chơi không phải model — "tôi bước
 * sang bếp" là một tuyên bố về hành vi, không phải một ý định cần phán. Nhưng nó vẫn đi qua
 * `commitEvents`, nên bất biến của thế giới vẫn được giữ: bước sang phòng không kề, hay qua cửa đang
 * niêm phong, thì bị từ chối và đi vào `issues` để Thiên Đạo kể cho đúng.
 *
 * Không có bước này thì ở actor mode người chơi không bao giờ di chuyển được — lỗi tìm ra bằng chạy thật
 * trong DSH, không phải bằng test.
 */
export function playerDeclaredEvents(action: PlayerAction, world: WorldState, turn: number): CanonicalEvent[] {
  const events: CanonicalEvent[] = []

  const to = action.toLocation?.trim() ?? ''
  if (to !== '') {
    events.push({
      id: `evt_${turn}_player_move`,
      type: 'player_move',
      turn,
      source: 'player',
      location: world.player.location,
      toLocation: to,
      visibility: 'public',
    })
  }

  const item = action.item?.trim() ?? ''
  const itemTo = action.itemTo?.trim() ?? ''
  if (item !== '' && itemTo !== '') {
    const from = action.itemFrom?.trim() ?? ''
    const fromLocation = from !== '' ? from : 'player'
    // `location` của event phải là một địa điểm có thật: lấy chỗ xuất phát nếu đó là địa điểm, còn không
    // thì lấy chỗ người chơi đang đứng.
    const origin = fromLocation !== 'player' && world.locations[fromLocation] !== undefined
      ? fromLocation
      : world.player.location
    events.push({
      id: `evt_${turn}_player_item`,
      type: 'player_item',
      turn,
      source: 'player',
      location: origin,
      item: { item, count: Number.isInteger(action.itemCount) && (action.itemCount ?? 0) > 0 ? (action.itemCount as number) : 1, from: fromLocation, to: itemTo },
      visibility: 'public',
    })
  }

  return events
}

export async function runActorTurn(input: ActorTurnInput, deps: ActorTurnDeps): Promise<ActorTurnResult> {
  const seed = deps.seed ?? 'actor'
  const turn = input.turn
  const issues: ActorTurnIssue[] = []
  // Số lượt nằm trong chính world: nếu không ghi vào đây thì `WorldState.turn` đứng yên ở 0 và mọi thứ
  // phụ thuộc nó (bản ghi, RNG tất định, ký ức) đều lệch.
  let world: WorldState = { ...input.world, turn }

  // 1. Định tuyến hành động người chơi, hợp nhất với tri giác còn nợ từ lượt trước.
  const routed = routePlayerAction(input.action, world, input.definitions, { seed, turn })
  const perceptions = mergePerceptions(routed, input.pending)

  // 2. Chọn actor thức.
  const wake = selectAwakeActors({
    action: input.action,
    world,
    definitions: input.definitions,
    perceptions,
    ...(deps.maxAwake === undefined ? {} : { maxAwake: deps.maxAwake }),
    ...(deps.force === undefined ? {} : { force: deps.force }),
  })

  // 3. Dựng payload TRƯỚC khi ghi ký ức: nếu ghi trước, câu người chơi vừa nói sẽ xuất hiện hai lần
  //    trong prompt (một lần ở "Ký ức", một lần ở "Vừa xảy ra trước mắt bạn").
  const prepared = wake.awake.flatMap(actorId => {
    const definition = input.definitions.find(entry => entry.id === actorId)
    const state = world.actors[actorId]
    const perception = perceptions.entries[actorId]
    if (definition === undefined || state === undefined || perception === undefined) {
      issues.push({ where: actorId, message: 'actor được chọn nhưng thiếu định nghĩa, state hoặc tri giác' })
      return []
    }
    const payload = buildActorPayload({ definition, state, perception })
    const forbidden = buildForbiddenList({
      actorId,
      definitions: input.definitions,
      world,
      secretFacts: input.secretFacts ?? [],
    })
    return [{ definition, payload, prompt: renderActorPrompt(payload), forbidden }]
  })

  // 4. Gọi song song. Mỗi actor một session riêng, không đứa nào thấy prompt của đứa khác.
  const outcomes = await Promise.all(
    prepared.map(entry =>
      deps.runner
        .run({ definition: entry.definition, payload: entry.payload, prompt: entry.prompt, turn, forbidden: entry.forbidden })
        .catch((error): ActorRunOutcome => ({
          issues: [`${entry.definition.id}: ${error instanceof Error ? error.message : String(error)}`],
        })),
    ),
  )

  const outputs: ActorOutput[] = []
  for (const [index, outcome] of outcomes.entries()) {
    const actorId = prepared[index]?.definition.id ?? '(không rõ)'
    for (const message of outcome.issues) issues.push({ where: actorId, message })
    if (outcome.output !== undefined) outputs.push(outcome.output)
  }

  // 5. Ký ức chỉ cho actor đã thức.
  world = applyObservations(world, wake.decisions, turn)

  // 6. Resolver. Hai lượt commit: hành động người chơi tự tuyên bố trước, rồi tới hệ quả từ output actor.
  const declared = playerDeclaredEvents(input.action, world, turn)
  const firstPass = commitEvents(world, declared)
  world = firstPass.world

  const proposedByActors = proposeEvents({ world, outputs, turn })
  const secondPass = commitEvents(world, proposedByActors)
  world = secondPass.world

  const proposed = [...declared, ...proposedByActors]
  const committed = [...firstPass.committed, ...secondPass.committed]
  const rejected = [...firstPass.rejected, ...secondPass.rejected]
  for (const entry of rejected) {
    issues.push({
      where: entry.event.id,
      message: `Event bị từ chối: ${entry.issues.map(issue => issue.message).join('; ')}`,
    })
  }

  // 7. Niềm tin/kế hoạch riêng của actor — không phải canon.
  world = commitActorBeliefs(world, outputs, turn)

  // 8. Broadcast có chọn lọc trên những gì ĐÃ THÀNH CANON.
  const broadcast = routeCanonicalEvents({ events: committed, world, definitions: input.definitions, seed, turn })

  // 9. Điều kiện kết thúc do code quyết.
  const ended = deps.endConditions === undefined ? undefined : evaluateEndConditions(world, deps.endConditions)

  // Tri giác còn nợ: chỉ actor NGỦ mà vừa tri giác được gì đó. Actor đã thức thì đã có lượt phản ứng
  // của nó ở lượt này; cho nó nhận lại cùng thông tin ở lượt sau là cách tạo vòng lặp NPC vô tận.
  const awakeSet = new Set(wake.awake)
  const pendingEntries: Record<string, Perception> = {}
  for (const [actorId, perception] of Object.entries(broadcast.perceptions.entries)) {
    if (perception.fidelity === 'none' || awakeSet.has(actorId)) continue
    pendingEntries[actorId] = perception
  }

  return {
    world,
    decisions: wake.decisions,
    awake: wake.awake,
    sleeping: wake.sleeping,
    outputs,
    proposed,
    committed,
    rejected,
    broadcast,
    publicLines: broadcast.publicLines,
    pending: { entries: pendingEntries },
    ...(ended === undefined ? {} : { ended }),
    issues,
  }
}

// ── Bản ghi riêng cho Thiên Đạo ───────────────────────────────────────────

/**
 * Diễn biến riêng của một lượt.
 *
 * Không bao giờ được trả về trong kết quả tool: kết quả tool nằm trong transcript mà người chơi đọc
 * được. Bản ghi này đi qua kênh kín (`systemPrompt`) do `prompt.ts` gắn, đúng như `hiddenTruth`.
 */
export interface ActorTurnReport {
  readonly sceneId: string
  readonly turn: number
  readonly awake: readonly string[]
  readonly sleeping: readonly string[]
  readonly actors: readonly {
    readonly id: string
    readonly name: string
    readonly interpretation: string
    readonly emotion: string
    readonly intent: string
    readonly target?: string
    readonly plan?: string
    readonly beliefs: readonly string[]
  }[]
  readonly committed: readonly string[]
  readonly rejected: readonly { readonly eventId: string; readonly messages: readonly string[] }[]
  readonly privateEvents: readonly string[]
  readonly withheld: number
  readonly ended?: { readonly id: string; readonly outcome: string }
  readonly issues: readonly ActorTurnIssue[]
}

export function buildActorReport(input: {
  readonly sceneId: string
  readonly result: ActorTurnResult
  readonly definitions: readonly ActorDefinition[]
}): ActorTurnReport {
  const nameOf = (id: string): string => input.definitions.find(entry => entry.id === id)?.name ?? id
  const actors = input.result.outputs.map(output => ({
    id: output.actorId,
    name: nameOf(output.actorId),
    interpretation: output.interpretation,
    emotion: output.emotion,
    intent: output.intent.type,
    ...(output.intent.target === undefined ? {} : { target: output.intent.target }),
    ...(output.plan === undefined ? {} : { plan: `${output.plan.goal} — chờ: ${output.plan.trigger}` }),
    beliefs: output.beliefClaims.map(claim => `${claim.claim} (${Math.round(claim.confidence * 100)}%)`),
  }))

  return {
    sceneId: input.sceneId,
    turn: input.result.world.turn,
    awake: input.result.awake,
    sleeping: input.result.sleeping.map(nameOf),
    actors,
    committed: input.result.committed.map(event => describeEvent(event, nameOf)),
    rejected: input.result.rejected.map(entry => ({
      eventId: entry.event.id,
      messages: entry.issues.map(issue => issue.message),
    })),
    privateEvents: input.result.broadcast.privateLines,
    withheld: input.result.broadcast.withheldEventIds.length,
    ...(input.result.ended === undefined ? {} : { ended: { id: input.result.ended.id, outcome: input.result.ended.outcome } }),
    issues: input.result.issues,
  }
}

function describeEvent(event: CanonicalEvent, nameOf: (id: string) => string): string {
  switch (event.type) {
    case 'npc_dialogue':
      return `${nameOf(event.source)} nói: "${event.content ?? ''}"`
    case 'npc_move':
      return `${nameOf(event.source)} di chuyển ${event.location} → ${event.toLocation ?? '?'}`
    case 'player_move':
      return `Người chơi di chuyển ${event.location} → ${event.toLocation ?? '?'}`
    case 'actor_trait':
      return `${nameOf(event.source)} đổi: ${Object.entries(event.changes ?? {}).map(([key, delta]) => `${key} ${delta > 0 ? '+' : ''}${delta}`).join(', ')}`
    case 'player_item':
      return event.item === undefined ? 'đồ vật di chuyển' : `${event.item.count}× ${event.item.item}: ${event.item.from} → ${event.item.to}`
    case 'world_flag':
      return `cờ ${event.flag?.key ?? '?'} = ${String(event.flag?.value)}`
    case 'environment':
      return `môi trường ${event.flag?.key ?? '?'} = ${String(event.flag?.value)}`
    case 'observation':
      return `riêng: ${event.content ?? ''}`
  }
}

/** Khối chữ đi vào kênh kín cho Thiên Đạo. */
export function renderActorGmText(report: ActorTurnReport): string {
  const lines: string[] = [`【Diễn biến riêng — lượt ${report.turn}】`, `Thức: ${report.awake.length === 0 ? '(không ai)' : report.awake.join(', ')}`]
  for (const actor of report.actors) {
    lines.push(`- ${actor.name} (${actor.id}) hiểu: ${actor.interpretation}`)
    lines.push(`  cảm xúc: ${actor.emotion}`)
    lines.push(`  ý định: ${actor.intent}${actor.target === undefined ? '' : ` → ${actor.target}`}`)
    if (actor.plan !== undefined) lines.push(`  kế hoạch riêng: ${actor.plan}`)
    if (actor.beliefs.length > 0) lines.push(`  tin: ${actor.beliefs.join(' | ')}`)
  }
  if (report.privateEvents.length > 0) lines.push(`Ý định chưa thực hiện (không phải sự thật): ${report.privateEvents.join(' / ')}`)
  if (report.committed.length > 0) lines.push(`Đã thành sự thật: ${report.committed.join('; ')}`)
  if (report.rejected.length > 0) {
    lines.push(`Bị từ chối (không xảy ra): ${report.rejected.map(entry => `${entry.eventId} — ${entry.messages.join('; ')}`).join(' / ')}`)
  }
  if (report.ended !== undefined) lines.push(`KẾT THÚC: ${report.ended.id} (${report.ended.outcome})`)
  lines.push(`Sự việc ngoài tầm tri giác người chơi: ${report.withheld}. Chỉ kể nếu có dấu hiệu gián tiếp.`)
  return lines.join('\n')
}

// ── Lưu trữ trạng thái actor mode ─────────────────────────────────────────

export const ACTOR_SNAPSHOT_VERSION = 'rp-actors-v1'

/**
 * Toàn bộ trạng thái của Multi-Actor-Agent Mode cho một ván: dàn actor, bản đồ địa điểm, world state,
 * và bản ghi riêng của lượt gần nhất.
 *
 * `world` chứa niềm tin và ký ức riêng của từng actor, nên file này cùng mức tin cậy với kênh GM:
 * người chơi không mở nó ra. Nó KHÔNG đi vào kết quả tool.
 */
export interface ActorSnapshot {
  readonly schemaVersion: string
  readonly sceneId: string
  readonly turn: number
  readonly cast: readonly ActorDefinition[]
  readonly locations: Readonly<Record<string, LocationSpec>>
  /** Sự thật bị niêm phong — dùng cho chốt chặn cô lập, không bao giờ vào payload actor. */
  readonly secretFacts: readonly string[]
  readonly endConditions: readonly EndCondition[]
  readonly world: WorldState
  readonly report?: ActorTurnReport
  /** Tri giác còn nợ: actor đã nghe thấy nhưng chưa có dịp phản ứng. */
  readonly pending?: PerceptionMap
  /** Cảnh báo cấu hình/kỹ thuật tích luỹ, để Thiên Đạo biết ván có đang chạy đúng không. */
  readonly notes: readonly string[]
}

export function actorFileOf(workspaceRoot: string, sceneId: string): string {
  return path.join(runDirOf(workspaceRoot, sceneId), 'actors.json')
}

export function saveActorSnapshot(workspaceRoot: string, snapshot: ActorSnapshot): string {
  const file = actorFileOf(workspaceRoot, snapshot.sceneId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return file
}

export function loadActorSnapshot(workspaceRoot: string, sceneId: string): ActorSnapshot | undefined {
  const file = actorFileOf(workspaceRoot, sceneId)
  if (!fs.existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ActorSnapshot
    return parsed?.schemaVersion === ACTOR_SNAPSHOT_VERSION ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Danh sách ván đang chạy ở actor mode, mới nhất trước. */
export function listActorScenes(workspaceRoot: string): string[] {
  return listRuns(workspaceRoot)
    .map(run => run.sceneId)
    .filter(sceneId => fs.existsSync(actorFileOf(workspaceRoot, sceneId)))
}

/** Bản ghi riêng của lượt gần nhất, dạng chữ, cho kênh kín. Rỗng khi ván không ở actor mode. */
export function activeActorText(workspaceRoot: string | undefined): string {
  if (workspaceRoot === undefined) return ''
  try {
    const latest = listActorScenes(workspaceRoot)[0]
    if (latest === undefined) return ''
    const snapshot = loadActorSnapshot(workspaceRoot, latest)
    if (snapshot?.report === undefined) return ''
    return renderActorGmText(snapshot.report)
  } catch {
    return ''
  }
}
