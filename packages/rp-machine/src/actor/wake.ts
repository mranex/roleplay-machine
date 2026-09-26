/**
 * Chọn actor nào được đánh thức ở lượt này (spec §15), và ghi quan sát CHỈ cho những actor đó.
 *
 * Vì sao phải có tầng này thay vì gọi hết mọi actor mỗi lượt: spec §14 nói rõ "không phải mọi actor đều
 * chạy mỗi turn", và §15 liệt kê tiêu chí. Actor ngủ thì không tốn model call, không được thông tin
 * thêm, nhưng session/state của nó vẫn còn nguyên để đánh thức sau.
 *
 * Năm điều kiện, đúng theo spec:
 *   1. trực tiếp quan sát sự kiện hiện tại
 *   2. sự kiện đụng tới mục tiêu đang theo đuổi của nó
 *   3. sự kiện đụng tới state thuộc sở hữu của nó
 *   4. nó đang có kế hoạch/dự định chờ sẵn
 *   5. Thiên Đạo hoặc Resolver yêu cầu đánh thức
 */

import type { ActorDefinition, ActorState, WorldState } from './model'
import type { PerceptionMap, PlayerAction } from './perception'

export interface WakeDecision {
  readonly actorId: string
  readonly wake: boolean
  readonly reason: string
  readonly priority: number
  readonly informationLoss: number
  /** Điều actor nhận được ở lượt này. Rỗng khi ngủ. */
  readonly received: string
}

export interface WakeResult {
  readonly decisions: readonly WakeDecision[]
  readonly awake: readonly string[]
  readonly sleeping: readonly string[]
}

/** Khớp trigger của kế hoạch với hành động. Tất định và cố tình thô. */
export function triggerMatches(trigger: string, action: PlayerAction, world: WorldState): boolean {
  const haystack = trigger.toLowerCase()
  const tokens = [
    action.type,
    action.targetActorId,
    action.toLocation,
    action.item,
    action.fromLocation ?? world.player.location,
  ]
  return tokens.some(token => token !== undefined && token !== '' && haystack.includes(token.toLowerCase()))
}

export function selectAwakeActors(input: {
  readonly action: PlayerAction
  readonly world: WorldState
  readonly definitions: readonly ActorDefinition[]
  readonly perceptions: PerceptionMap
  /** Trần số actor được gọi model trong một lượt. Mặc định 4. */
  readonly maxAwake?: number
  /** Id do Thiên Đạo/Resolver yêu cầu đánh thức, bất kể quan sát. */
  readonly force?: readonly string[]
}): WakeResult {
  const maxAwake = input.maxAwake ?? 4
  const forced = new Set(input.force ?? [])
  const scored: WakeDecision[] = []

  for (const definition of input.definitions) {
    const state: ActorState | undefined = input.world.actors[definition.id]
    const perception = input.perceptions.entries[definition.id]
    if (state === undefined || perception === undefined) {
      scored.push({ actorId: definition.id, wake: false, reason: 'không có state', priority: 0, informationLoss: 1, received: '' })
      continue
    }
    let priority = 0
    let reason = ''
    // Actor không quan sát được gì vẫn có thể bị đánh thức bởi kế hoạch riêng hoặc bởi mục tiêu nó
    // đang để mắt tới (spec §15, điều kiện 2 và 4). Vì vậy không được thoát sớm ở đây.
    let planReceived = ''
    if (forced.has(definition.id)) {
      priority = 100
      reason = 'Thiên Đạo yêu cầu đánh thức'
    } else if (input.action.targetActorId === definition.id && definition.perceive.includes('addressed')) {
      priority = 95
      reason = 'được gọi tên trực tiếp'
    } else if (perception.fidelity === 'full') {
      priority = 80
      reason = 'trực tiếp chứng kiến'
    } else if (perception.fidelity === 'muffled') {
      priority = 60
      reason = 'nghe loáng thoáng'
    } else if (perception.fidelity === 'presence') {
      priority = 40
      reason = 'cảm nhận có chuyện xảy ra'
    } else {
      const plan = state.plans.find(entry => triggerMatches(entry.trigger, input.action, input.world))
      if (plan !== undefined) {
        priority = 30
        reason = `kế hoạch tới hạn: ${plan.goal}`
        // Không tiết lộ gì về thế giới: chỉ nói rằng điều kiện nó đang chờ đã tới.
        planReceived = `Điều kiện cho kế hoạch "${plan.goal}" của bạn dường như vừa xảy ra.`
      } else if ((definition.watches ?? []).includes(input.action.targetActorId ?? '')) {
        priority = 25
        reason = 'đang để mắt tới mục tiêu'
        planReceived = 'Bạn để mắt tới một người, và vừa có chuyện liên quan tới họ.'
      }
    }

    if (priority === 0) {
      scored.push({ actorId: definition.id, wake: false, reason: 'không quan sát được gì', priority: 0, informationLoss: 1, received: '' })
      continue
    }

    scored.push({
      actorId: definition.id,
      wake: true,
      reason,
      priority,
      informationLoss: perception.informationLoss,
      received: planReceived !== '' ? planReceived : perception.received,
    })
  }

  scored.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.actorId < b.actorId ? -1 : 1))

  const decisions: WakeDecision[] = []
  let used = 0
  for (const decision of scored) {
    if (!decision.wake) {
      decisions.push(decision)
      continue
    }
    if (used >= maxAwake) {
      decisions.push({ ...decision, wake: false, reason: `vượt trần ${maxAwake} actor mỗi lượt` })
      continue
    }
    used++
    decisions.push(decision)
  }

  const awake = decisions.filter(decision => decision.wake).map(decision => decision.actorId)
  return { decisions, awake, sleeping: decisions.filter(decision => !decision.wake).map(decision => decision.actorId) }
}

/**
 * Ghi quan sát vào ký ức actor.
 *
 * Chỉ actor được đánh thức mới nhận ký ức mới. Actor ngủ giữ nguyên memory, state và số lượt — đây là
 * cơ chế bảo đảm "actor ngủ không được thông tin thêm" của spec §15/§28-Test 7.
 */
export function applyObservations(
  world: WorldState,
  decisions: readonly WakeDecision[],
  turn: number,
): WorldState {
  const actors: Record<string, ActorState> = {}
  for (const [id, state] of Object.entries(world.actors)) {
    actors[id] = { ...state, memory: [...state.memory], beliefs: [...state.beliefs], plans: [...state.plans], awakeTurns: [...state.awakeTurns] }
  }

  for (const decision of decisions) {
    if (!decision.wake) continue
    const state = actors[decision.actorId]
    if (state === undefined) continue
    state.awakeTurns.push(turn)
    if (decision.received !== '') {
      state.memory.push({ turn, text: decision.received, fidelity: 1 - decision.informationLoss })
      if (state.memory.length > 200) state.memory.splice(0, state.memory.length - 200)
    }
  }

  return { ...world, actors }
}

/** Actor có state nhưng chưa từng được đánh thức — dùng để kiểm chi phí của một ván. */
export function neverWoken(world: WorldState): string[] {
  return Object.values(world.actors)
    .filter(state => state.awakeTurns.length === 0)
    .map(state => state.id)
    .sort()
}
