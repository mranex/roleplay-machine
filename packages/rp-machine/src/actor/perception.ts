/**
 * Perception Router — ai được biết cái gì, và biết ở mức nào.
 *
 * Đây là tầng biến "một sự kiện" thành "phiên bản thực tại của từng actor". Spec §7 nói rõ: actor
 * KHÔNG được nhận cùng một payload. Mỗi actor nhận đúng những gì nó quan sát được.
 *
 * Mất mát thông tin là TẤT ĐỊNH theo (seed, lượt, actor): cùng một ván chạy lại cho cùng kết quả, nên
 * test được và ván chơi tái lập được. Bốn mức:
 *
 *   full      nghe rõ toàn bộ            loss 0
 *   muffled   nghe loáng thoáng          loss 0.35
 *   presence  biết có chuyện gì đó       loss 1   (không có ngữ nghĩa)
 *   none      không biết gì
 */

import { createRng } from '../rng'
import {
  areAdjacent,
  isBlocked,
  sameRoomWith,
  type ActorDefinition,
  type PerceptionScope,
  type WorldState,
} from './model'

export type Fidelity = 'full' | 'muffled' | 'presence' | 'none'

export type Volume = 'whisper' | 'normal' | 'loud'

export interface PlayerAction {
  /** Nguồn phát: `'player'`, `'world'`, hoặc id một actor. */
  readonly actor: string
  /** `speak` | `persuasion` | `move` | `item_transfer` | `observe` | bất kỳ nhãn nào Heaven đặt. */
  readonly type: string
  /** Nguyên văn lời/hành động của người chơi. Không bao giờ được phát đi nguyên vẹn cho người ngoài phòng. */
  readonly text: string
  readonly targetActorId?: string
  readonly item?: string
  /** Chuyển đồ: lấy từ đâu ('player' hoặc id địa điểm). */
  readonly itemFrom?: string
  /** Chuyển đồ: đưa tới đâu ('player' hoặc id địa điểm). */
  readonly itemTo?: string
  readonly itemCount?: number
  readonly toLocation?: string
  /**
   * Địa điểm phát ra hành động. Bỏ trống nghĩa là hành động của người chơi ở chỗ người chơi đang đứng;
   * event canonical thì luôn khai rõ vì nguồn có thể là một NPC ở phòng khác.
   */
  readonly fromLocation?: string
  readonly volume: Volume
  readonly claims?: readonly string[]
}

export interface Perception {
  readonly actorId: string
  readonly fidelity: Fidelity
  /** 0 = nghe rõ hoàn toàn; 1 = mất hết ngữ nghĩa. */
  readonly informationLoss: number
  /** Nội dung actor THỰC SỰ nhận. Chuỗi rỗng khi không nhận gì. */
  readonly received: string
}

export interface PerceptionMap {
  readonly entries: Readonly<Record<string, Perception>>
}

const LOSS: Readonly<Record<Fidelity, number>> = { full: 0, muffled: 0.35, presence: 1, none: 1 }

/** Thứ tự mạnh yếu của tri giác — dùng khi một actor nhận nhiều nguồn trong cùng một lượt. */
export const FIDELITY_RANK: Readonly<Record<Fidelity, number>> = { full: 3, muffled: 2, presence: 1, none: 0 }

export function lossOf(fidelity: Fidelity): number {
  return LOSS[fidelity]
}

/**
 * Hợp nhất hai bản đồ tri giác theo từng actor, giữ mức mạnh nhất và ghép nội dung.
 *
 * Cần vì một lượt có hai nguồn thông tin tới actor: hành động người chơi vừa làm, và những gì nó đã
 * tri giác ở lượt trước nhưng chưa có dịp phản ứng.
 */
export function mergePerceptions(base: PerceptionMap, extra: PerceptionMap | undefined): PerceptionMap {
  if (extra === undefined) return base
  const entries: Record<string, Perception> = { ...base.entries }
  for (const [actorId, added] of Object.entries(extra.entries)) {
    const current = entries[actorId]
    if (current === undefined) {
      entries[actorId] = added
      continue
    }
    if (added.fidelity === 'none') continue
    if (current.fidelity === 'none') {
      entries[actorId] = added
      continue
    }
    const strongest = FIDELITY_RANK[added.fidelity] > FIDELITY_RANK[current.fidelity] ? added.fidelity : current.fidelity
    const received = current.received === added.received
      ? current.received
      : `${current.received}\n${added.received}`
    entries[actorId] = { actorId, fidelity: strongest, informationLoss: LOSS[strongest], received }
  }
  return { entries }
}

/** Hành động được coi là "thay đổi vật lý" — actor môi trường chỉ cảm nhận được nhóm này. */
const PHYSICAL_ACTIONS = new Set(['move', 'item_transfer', 'lock', 'unlock', 'break', 'open', 'close'])

function has(definition: ActorDefinition, scope: PerceptionScope): boolean {
  return definition.perceive.includes(scope)
}

/**
 * Mức quan sát thô từ vị trí + âm lượng + phạm vi của actor. Thuần túy, không random.
 */
export function rawFidelity(
  definition: ActorDefinition,
  state: { readonly location: string },
  action: PlayerAction,
  playerLocation: string,
  world: WorldState,
): Fidelity {
  const sameRoom = sameRoomWith(world, state.location, playerLocation)
  const addressed = action.targetActorId === definition.id

  // Cùng phòng (kể cả đứng ở ngưỡng cửa): thấy tận mắt.
  if (sameRoom) {
    if (has(definition, 'same_room') || has(definition, 'addressed')) return 'full'
    // Actor môi trường không "nghe" nội dung, nhưng biết là có chuyện xảy ra trong phòng nó trông coi.
    if (has(definition, 'physical_change')) return 'presence'
    return 'none'
  }

  // Được gọi tên trực tiếp, kể cả khác phòng.
  if (addressed && has(definition, 'addressed')) return 'full'

  // Actor môi trường cảm nhận thay đổi vật lý ở bất kỳ đâu nó trông coi.
  if (has(definition, 'physical_change') && PHYSICAL_ACTIONS.has(action.type)) return 'presence'

  const adjacent = areAdjacent(world, state.location, playerLocation)
  if (!adjacent) return 'none'
  // Cửa niêm phong chặn mọi thứ trừ cùng phòng.
  if (isBlocked(world, state.location, playerLocation)) return 'none'
  // Thì thầm không xuyên phòng.
  if (action.volume === 'whisper') return 'none'

  if (action.volume === 'loud' && has(definition, 'loud_nearby')) return 'muffled'
  if (has(definition, 'adjacent_presence')) return 'presence'
  return 'none'
}

/**
 * Cắt xén nghe loáng thoáng: bỏ dần từ theo mất mát, tất định theo (seed, lượt, actor).
 * Từ ngắn bị bỏ trước vì chúng ít mang nghĩa; số và từ dài sống sót lâu hơn.
 */
export function muffle(text: string, loss: number, rng: () => number): string {
  const words = text.split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return ''
  const kept: string[] = []
  for (const word of words) {
    const bare = word.replace(/[.,;:!?"'«»“”()]/g, '')
    const isNumeric = /^\d+$/.test(bare)
    const long = bare.length >= 4
    // Từ dài và số có cơ hội sống sót cao hơn; hư từ gần như bị nuốt.
    const survival = (isNumeric ? 0.85 : long ? 0.5 : 0.2) * (1 - loss) + (isNumeric || long ? 0.15 : 0)
    if (rng() < survival) kept.push(word)
  }
  if (kept.length === 0) return '…'
  return `… ${kept.join(' … ')} …`
}

function presenceText(
  definition: ActorDefinition,
  action: PlayerAction,
  playerLocation: string,
  sameRoom: boolean,
): string {
  if (has(definition, 'physical_change') && !sameRoom) {
    return `Có một thay đổi vật lý ở ${playerLocation}. Không rõ là gì.`
  }
  if (PHYSICAL_ACTIONS.has(action.type)) {
    return `Có chuyện gì đó vừa xảy ra ở ${playerLocation}, nghe như có đồ vật bị di chuyển.`
  }
  return `Có tiếng nói ở ${playerLocation}. Không nghe rõ nội dung.`
}

/**
 * Định tuyến một hành động của người chơi tới mọi actor đã biết.
 * Trả về cả entry `fidelity: 'none'` để tầng wake biết ai PHẢI ngủ.
 */
export function routePlayerAction(
  action: PlayerAction,
  world: WorldState,
  definitions: readonly ActorDefinition[],
  options?: { readonly seed?: string | number; readonly turn?: number },
): PerceptionMap {
  const turn = options?.turn ?? world.turn
  const seed = options?.seed ?? 'actor'
  const origin = action.fromLocation ?? world.player.location
  const entries: Record<string, Perception> = {}

  for (const definition of definitions) {
    const state = world.actors[definition.id]
    if (state === undefined) {
      entries[definition.id] = { actorId: definition.id, fidelity: 'none', informationLoss: 1, received: '' }
      continue
    }
    // Không ai tri giác được chính hành vi của mình; việc nó vừa làm được ghi vào ký ức ở tầng wake.
    if (definition.id === action.actor) {
      entries[definition.id] = { actorId: definition.id, fidelity: 'none', informationLoss: 1, received: '' }
      continue
    }
    const fidelity = rawFidelity(definition, state, action, origin, world)
    const rng = createRng(`${seed}:${turn}:${definition.id}`)
    const received = fidelity === 'full'
      ? action.text
      : fidelity === 'muffled'
        ? muffle(action.text, LOSS.muffled, rng.next)
        : fidelity === 'presence'
          ? presenceText(definition, action, origin, state.location === origin)
          : ''
    entries[definition.id] = { actorId: definition.id, fidelity, informationLoss: LOSS[fidelity], received }
  }

  return { entries }
}

/** Actor có nhận được gì ở lượt này không. */
export function perceivesSomething(perception: Perception | undefined): boolean {
  return perception !== undefined && perception.fidelity !== 'none'
}
