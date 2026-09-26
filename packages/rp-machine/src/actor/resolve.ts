/**
 * World Resolver — nơi ý định trở thành sự thật, hoặc bị từ chối.
 *
 * Spec §10: "Actor intents are proposals, not reality." Chỉ event đã qua Resolver mới là canon.
 *
 * Hai luật của tầng này:
 *
 * 1. **Không event nào vào canon mà chưa qua `validateEvent`.** Mọi bất biến của thế giới nằm ở đó:
 *    không bịa trait mới, không nhảy qua phòng không kề, không xuyên cửa niêm phong, không lấy quá số
 *    đồ đang có.
 * 2. **Lời nói tự thành canon; mọi thứ khác thì không.** Một actor nói gì thì chuyện đó đã xảy ra —
 *    nhưng hệ quả của nó (ai bị thương, ai đổi lòng, cửa có mở) phải do Resolver đề xuất thành event
 *    riêng rồi qua kiểm. Đây là chỗ cưỡng chế "actor không tự declare kết quả".
 *
 * Niềm tin và kế hoạch của actor là chuyện khác: chúng thuộc sở hữu của actor, không phải canon, nên
 * được commit riêng và không bao giờ bị đồng bộ ngược thành sự thật (spec §18, §25).
 */

import { validateEvent, type CanonicalEvent, type EventIssue } from './events'
import type {
  ActorPlan,
  Belief,
  LocationSpec,
  Observation,
  WorldState,
} from './model'
import type { ActorOutput } from './payload'

export interface RejectedEvent {
  readonly event: CanonicalEvent
  readonly issues: readonly EventIssue[]
}

export interface ResolveResult {
  readonly world: WorldState
  readonly committed: readonly CanonicalEvent[]
  readonly rejected: readonly RejectedEvent[]
}

/**
 * Bản mutable của WorldState dùng trong lúc commit. Các interface ngoài đều `readonly` (để tầng actor
 * không vô tình sửa canon), nhưng commit thì buộc phải sửa — nên nới kiểu ở đây thay vì rải `as` khắp nơi.
 */
interface MutableActor {
  id: string
  location: string
  traits: Record<string, number>
  memory: Observation[]
  beliefs: Belief[]
  plans: ActorPlan[]
  awakeTurns: number[]
}

interface MutableWorld {
  sceneId: string
  turn: number
  locations: Record<string, LocationSpec>
  actors: Record<string, MutableActor>
  player: { location: string; inventory: string[]; oocStrikes: number }
  items: Record<string, { location: string; count: number }>
  flags: Record<string, boolean | number | string>
}

/** Nhân bản đủ sâu để commit không sửa vào state cũ. */
export function cloneWorld(world: WorldState): WorldState {
  const actors: Record<string, MutableActor> = {}
  for (const [id, state] of Object.entries(world.actors)) {
    actors[id] = {
      id: state.id,
      location: state.location,
      traits: { ...state.traits },
      memory: state.memory.map(entry => ({ ...entry })),
      beliefs: state.beliefs.map(belief => ({ ...belief })),
      plans: state.plans.map(plan => ({ ...plan })),
      awakeTurns: [...state.awakeTurns],
    }
  }
  const items: Record<string, { location: string; count: number }> = {}
  for (const [id, entry] of Object.entries(world.items)) items[id] = { ...entry }
  return {
    sceneId: world.sceneId,
    turn: world.turn,
    locations: { ...world.locations },
    actors,
    player: { ...world.player, inventory: [...world.player.inventory] },
    items,
    flags: { ...world.flags },
  }
}

function asMutable(world: WorldState): MutableWorld {
  return world as unknown as MutableWorld
}

function clampTrait(value: number): number {
  return Math.min(20, Math.max(0, value))
}

function applyEvent(raw: WorldState, event: CanonicalEvent): void {
  const world = asMutable(raw)

  switch (event.type) {
    case 'player_move':
      if (event.toLocation !== undefined) world.player.location = event.toLocation
      break

    case 'npc_move': {
      const state = world.actors[event.source]
      if (state !== undefined && event.toLocation !== undefined) state.location = event.toLocation
      break
    }

    case 'actor_trait': {
      const state = world.actors[event.source]
      if (state === undefined) break
      for (const [key, delta] of Object.entries(event.changes ?? {})) {
        state.traits[key] = clampTrait((state.traits[key] ?? 0) + delta)
      }
      break
    }

    case 'world_flag': {
      if (event.flag !== undefined) world.flags[event.flag.key] = event.flag.value
      break
    }

    case 'environment': {
      const flag = event.flag
      if (flag === undefined) break
      // `sealed` là thuộc tính của địa điểm chứ không phải cờ thế giới — nó đổi bản đồ tri giác.
      if (flag.key === 'sealed') {
        const spec = world.locations[event.location]
        if (spec !== undefined) {
          world.locations[event.location] = { ...spec, sealed: flag.value === true || flag.value === 1 }
        }
      } else {
        world.flags[flag.key] = flag.value
      }
      break
    }

    case 'player_item': {
      const transfer = event.item
      if (transfer === undefined) break

      if (transfer.from === 'player') {
        let removed = 0
        world.player.inventory = world.player.inventory.filter(id => {
          if (id === transfer.item && removed < transfer.count) {
            removed++
            return false
          }
          return true
        })
      } else {
        const source = world.items[transfer.item]
        if (source !== undefined) {
          source.count -= transfer.count
          if (source.count <= 0) delete world.items[transfer.item]
        }
      }

      if (transfer.to === 'player') {
        for (let index = 0; index < transfer.count; index++) world.player.inventory.push(transfer.item)
      } else {
        const existing = world.items[transfer.item]
        if (existing === undefined || existing.location === transfer.to) {
          world.items[transfer.item] = { location: transfer.to, count: (existing?.count ?? 0) + transfer.count }
        } else {
          // Cùng tên đồ ở hai chỗ khác nhau: giữ bản cũ và ghi bản mới dưới khoá có hậu tố, thay vì
          // âm thầm chuyển cả chồng đồ từ chỗ này sang chỗ kia.
          world.items[`${transfer.item}@${transfer.to}`] = { location: transfer.to, count: transfer.count }
        }
      }
      break
    }

    case 'npc_dialogue':
    case 'observation':
      // Lời nói và ghi nhận không đổi state: chúng là sự thật để kể, không phải để tính.
      break
  }
}

/**
 * Commit một lô event theo thứ tự.
 *
 * Event sau được kiểm trên state đã cập nhật bởi event trước — nhờ vậy chuỗi nhiều bước trong một lượt
 * (người chơi chạy sang phòng X, rồi NPC đuổi theo tới X) kiểm đúng, thay vì kiểm trên state cũ. Event
 * hỏng bị từ chối và KHÔNG để lại dấu vết nào.
 */
export function commitEvents(world: WorldState, events: readonly CanonicalEvent[]): ResolveResult {
  let next = cloneWorld(world)
  const committed: CanonicalEvent[] = []
  const rejected: RejectedEvent[] = []

  for (const event of events) {
    const issues = validateEvent(event, next)
    if (issues.length > 0) {
      rejected.push({ event, issues })
      continue
    }
    applyEvent(next, event)
    committed.push(event)
  }

  return { world: next, committed, rejected }
}

/**
 * Đề xuất event từ output của actor.
 *
 * Cố tình bảo thủ:
 *  - `dialogue` / `question` / `command` → một `npc_dialogue` công khai. Nói ra là chuyện đã xảy ra.
 *  - mọi ý định khác → một `observation` **riêng tư**, không đổi state. Muốn nó thành chuyện thật thì
 *    Resolver phải đề xuất event tương ứng (đổi trait, di chuyển, chuyển đồ) và event đó phải qua kiểm.
 */
export function proposeEvents(input: {
  readonly world: WorldState
  readonly outputs: readonly ActorOutput[]
  readonly turn: number
}): CanonicalEvent[] {
  const events: CanonicalEvent[] = []
  const speech = new Set(['dialogue', 'question', 'command'])

  for (const output of input.outputs) {
    const state = input.world.actors[output.actorId]
    if (state === undefined) continue
    const content = output.intent.content.trim()
    if (content === '') continue

    const target =
      output.intent.target !== undefined &&
      (output.intent.target === 'player' || input.world.actors[output.intent.target] !== undefined)
        ? output.intent.target
        : undefined

    if (speech.has(output.intent.type)) {
      events.push({
        id: `evt_${input.turn}_${output.actorId}_say`,
        type: 'npc_dialogue',
        turn: input.turn,
        source: output.actorId,
        location: state.location,
        ...(target === undefined ? {} : { target }),
        content,
        visibility: 'public',
      })
      continue
    }

    events.push({
      id: `evt_${input.turn}_${output.actorId}_intent`,
      type: 'observation',
      turn: input.turn,
      source: output.actorId,
      location: state.location,
      content: `${output.actorId} muốn ${output.intent.type}${target === undefined ? '' : ` nhắm ${target}`}: ${content}. Dự định này chưa được thực hiện.`,
      visibility: 'private',
    })
  }

  return events
}

// ── Niềm tin và kế hoạch: tài sản riêng của actor, không phải canon ─────────

export const MAX_BELIEFS = 20
export const MAX_PLANS = 6

/**
 * Ghi niềm tin và kế hoạch mà actor tự khai vào state CỦA CHÍNH NÓ.
 *
 * Đây không phải canon và không bao giờ được đồng bộ ngược thành sự thật: nếu quản gia tin người chơi
 * lấy hành trong khi túi có tỏi, niềm tin đó ở lại nguyên (spec §18).
 */
export function commitActorBeliefs(
  world: WorldState,
  outputs: readonly ActorOutput[],
  turn: number,
): WorldState {
  const next = asMutable(cloneWorld(world))

  for (const output of outputs) {
    const state = next.actors[output.actorId]
    if (state === undefined) continue

    for (const claim of output.beliefClaims) {
      const existing = state.beliefs.find(belief => belief.claim === claim.claim)
      if (existing !== undefined) {
        ;(existing as { confidence: number }).confidence = claim.confidence
        continue
      }
      state.beliefs.push({ claim: claim.claim, confidence: claim.confidence, source: output.actorId, turn })
    }
    if (state.beliefs.length > MAX_BELIEFS) state.beliefs.splice(0, state.beliefs.length - MAX_BELIEFS)

    const plan = output.plan
    if (plan !== undefined) {
      const exists = state.plans.some(entry => entry.goal === plan.goal && entry.trigger === plan.trigger)
      if (!exists) state.plans.push({ goal: plan.goal, trigger: plan.trigger, createdTurn: turn })
    }
    if (state.plans.length > MAX_PLANS) state.plans.splice(0, state.plans.length - MAX_PLANS)
  }

  return next
}

// ── Điều kiện kết thúc ─────────────────────────────────────────────────────

export type CompareOp = '>=' | '<=' | '=='

export type Predicate =
  | { readonly kind: 'trait'; readonly actor: string; readonly key: string; readonly op: CompareOp; readonly value: number }
  | { readonly kind: 'flag'; readonly key: string; readonly op: CompareOp; readonly value: number }
  | { readonly kind: 'boolFlag'; readonly key: string; readonly value: boolean }
  | { readonly kind: 'inventory'; readonly item: string; readonly count: number }
  | { readonly kind: 'actorAlive'; readonly actor: string }

export interface EndCondition {
  readonly id: string
  readonly outcome: 'won' | 'lost' | 'ejected'
  readonly allOf: readonly Predicate[]
}

export interface EndConditionIssue {
  readonly where: string
  readonly message: string
}

const OPS: readonly CompareOp[] = ['>=', '<=', '==']

function isOp(value: unknown): value is CompareOp {
  return typeof value === 'string' && (OPS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Kiểm điều kiện kết thúc lúc nạp vào. Điều kiện hỏng phải báo ngay — im lặng bỏ qua nghĩa là một
 * điều kiện thắng không bao giờ khớp và ván chơi không có kết thúc, đúng loại lỗi khó truy nhất.
 */
export function validateEndConditions(raw: unknown): { conditions: EndCondition[]; issues: EndConditionIssue[] } {
  const issues: EndConditionIssue[] = []
  if (!Array.isArray(raw)) return { conditions: [], issues: [{ where: 'endConditions', message: 'phải là array' }] }
  const conditions: EndCondition[] = []

  for (const [index, entry] of raw.entries()) {
    const where = `endConditions[${index}]`
    if (!isRecord(entry)) {
      issues.push({ where, message: 'phải là object' })
      continue
    }
    const id = typeof entry['id'] === 'string' ? entry['id'].trim() : ''
    const outcome = entry['outcome']
    if (id === '') issues.push({ where, message: 'thiếu id' })
    if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'ejected') {
      issues.push({ where, message: 'outcome phải là won | lost | ejected' })
    }
    const allOf = Array.isArray(entry['allOf']) ? entry['allOf'] : []
    if (allOf.length === 0) issues.push({ where, message: 'allOf rỗng — điều kiện sẽ không bao giờ khớp' })

    const predicates: Predicate[] = []
    for (const [pIndex, rawPredicate] of allOf.entries()) {
      const predicateWhere = `${where}.allOf[${pIndex}]`
      if (!isRecord(rawPredicate)) {
        issues.push({ where: predicateWhere, message: 'phải là object' })
        continue
      }
      const kind = rawPredicate['kind']

      if (kind === 'trait') {
        if (typeof rawPredicate['actor'] !== 'string' || typeof rawPredicate['key'] !== 'string' || !isOp(rawPredicate['op']) || typeof rawPredicate['value'] !== 'number') {
          issues.push({ where: predicateWhere, message: 'trait cần actor, key, op (>= | <= | ==), value' })
          continue
        }
        predicates.push({
          kind: 'trait',
          actor: rawPredicate['actor'],
          key: rawPredicate['key'],
          op: rawPredicate['op'],
          value: rawPredicate['value'],
        })
        continue
      }

      if (kind === 'flag') {
        if (typeof rawPredicate['key'] !== 'string' || !isOp(rawPredicate['op']) || typeof rawPredicate['value'] !== 'number') {
          issues.push({ where: predicateWhere, message: 'flag cần key, op (>= | <= | ==), value' })
          continue
        }
        predicates.push({ kind: 'flag', key: rawPredicate['key'], op: rawPredicate['op'], value: rawPredicate['value'] })
        continue
      }

      if (kind === 'boolFlag') {
        if (typeof rawPredicate['key'] !== 'string' || typeof rawPredicate['value'] !== 'boolean') {
          issues.push({ where: predicateWhere, message: 'boolFlag cần key và value boolean' })
          continue
        }
        predicates.push({ kind: 'boolFlag', key: rawPredicate['key'], value: rawPredicate['value'] })
        continue
      }

      if (kind === 'inventory') {
        if (typeof rawPredicate['item'] !== 'string' || typeof rawPredicate['count'] !== 'number') {
          issues.push({ where: predicateWhere, message: 'inventory cần item và count' })
          continue
        }
        predicates.push({ kind: 'inventory', item: rawPredicate['item'], count: rawPredicate['count'] })
        continue
      }

      if (kind === 'actorAlive') {
        if (typeof rawPredicate['actor'] !== 'string') {
          issues.push({ where: predicateWhere, message: 'actorAlive cần actor' })
          continue
        }
        predicates.push({ kind: 'actorAlive', actor: rawPredicate['actor'] })
        continue
      }

      issues.push({ where: predicateWhere, message: `kind không hợp lệ: ${String(kind)}` })
    }

    conditions.push({
      id,
      outcome: outcome === 'won' || outcome === 'lost' || outcome === 'ejected' ? outcome : 'lost',
      allOf: predicates,
    })
  }

  return { conditions, issues }
}

function compare(left: number, op: CompareOp, right: number): boolean {
  return op === '>=' ? left >= right : op === '<=' ? left <= right : left === right
}

export function predicateHolds(world: WorldState, predicate: Predicate): boolean {
  switch (predicate.kind) {
    case 'trait': {
      const value = world.actors[predicate.actor]?.traits[predicate.key]
      return value !== undefined && compare(value, predicate.op, predicate.value)
    }
    case 'flag': {
      const value = world.flags[predicate.key]
      return typeof value === 'number' && compare(value, predicate.op, predicate.value)
    }
    case 'boolFlag':
      return world.flags[predicate.key] === predicate.value
    case 'inventory':
      return world.player.inventory.filter(id => id === predicate.item).length >= predicate.count
    case 'actorAlive':
      // `alive` là trait 0/1; actor không khai trait này thì mặc định còn sống.
      return (world.actors[predicate.actor]?.traits['alive'] ?? 1) >= 1
  }
}

/** Điều kiện đầu tiên khớp, hoặc undefined. Thứ tự trong danh sách là thứ tự ưu tiên. */
export function evaluateEndConditions(
  world: WorldState,
  conditions: readonly EndCondition[],
): EndCondition | undefined {
  return conditions.find(condition => condition.allOf.every(predicate => predicateHolds(world, predicate)))
}
