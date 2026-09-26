/**
 * Selective Broadcast — từ canon tới từng người, và tới người kể chuyện.
 *
 * Resolver đã quyết cái gì là thật. Tầng này quyết **ai được biết điều đó**, và ở mức nào. Đây là nửa
 * còn lại của cô lập thông tin: `perception.ts` lọc hành động người chơi, còn file này lọc mọi event
 * canonical — kể cả event do NPC sinh ra.
 *
 * Ba đầu ra tách bạch, và sự tách bạch đó chính là yêu cầu của spec:
 *
 *   perceptions   → chỉ những actor tri giác được event, đúng mức của mình
 *   publicLines   → chỉ event mà NGƯỜI CHƠI tri giác được, để narrator kể
 *   privateEventIds → không bao giờ tới tay narrator, không bao giờ tới tay actor khác
 *
 * Một event công khai mà người chơi không tri giác được (tiếng hét trong phòng niêm phong) đi vào
 * `withheldEventIds`: narrator biết là có chuyện đó để không kể sai, nhưng không được kể nội dung.
 */

import { createRng } from '../rng'
import {
  areAdjacent,
  isBlocked,
  sameRoomWith,
  type ActorDefinition,
  type WorldState,
} from './model'
import {
  defaultVolume,
  eventText,
  eventToPerceptionSource,
  type CanonicalEvent,
} from './events'
import {
  FIDELITY_RANK,
  lossOf,
  muffle,
  routePlayerAction,
  type Fidelity,
  type Perception,
  type PerceptionMap,
} from './perception'

/** Một mẩu thực tại mà một actor nhận được. */
export interface BroadcastEntry {
  readonly eventId: string
  readonly actorId: string
  readonly fidelity: Fidelity
  readonly informationLoss: number
  readonly received: string
}

export interface BroadcastResult {
  /** Mọi cặp (event, actor) có tri giác — không có entry nào cho fidelity 'none'. */
  readonly entries: readonly BroadcastEntry[]
  /** Hợp nhất theo actor, dùng trực tiếp cho `selectAwakeActors`. */
  readonly perceptions: PerceptionMap
  /** Chỉ event công khai VÀ người chơi tri giác được. Đây là thứ duy nhất narrator được kể. */
  readonly publicLines: readonly string[]
  readonly publicEventIds: readonly string[]
  /** Công khai nhưng người chơi không tri giác được: không được kể nội dung. */
  readonly withheldEventIds: readonly string[]
  /** Riêng tư: không tới narrator, không tới actor. Nội dung chỉ dành cho Thiên Đạo. */
  readonly privateEventIds: readonly string[]
  readonly privateLines: readonly string[]
}

/** Thứ tự mạnh yếu của tri giác, dùng khi một actor nhận nhiều event trong cùng một lượt. */
const RANK = FIDELITY_RANK

/**
 * Người chơi tri giác một event tới mức nào.
 *
 * Người chơi là một actor đặc biệt không có `ActorDefinition`, nên ma trận được viết thẳng ở đây theo
 * cùng bốn mức. Tất định, không random: ván chơi phải tái lập được.
 */
export function playerPerception(event: CanonicalEvent, world: WorldState): Perception {
  const actorId = 'player'
  const origin = event.location
  const playerLocation = world.player.location
  const full = (): Perception => ({ actorId, fidelity: 'full', informationLoss: 0, received: eventText(event) })
  const none = (): Perception => ({ actorId, fidelity: 'none', informationLoss: 1, received: '' })

  // Việc người chơi tự làm thì họ luôn biết.
  if (event.source === 'player') return full()

  if (sameRoomWith(world, playerLocation, origin)) return full()
  if (isBlocked(world, playerLocation, origin)) return none()
  if (!areAdjacent(world, playerLocation, origin)) return none()

  const volume = event.volume ?? defaultVolume(event)
  if (volume === 'whisper') return none()

  if (volume === 'loud') {
    const rng = createRng(`player:${world.turn}:${event.id}`)
    return { actorId, fidelity: 'muffled', informationLoss: lossOf('muffled'), received: muffle(eventText(event), lossOf('muffled'), rng.next) }
  }

  return {
    actorId,
    fidelity: 'presence',
    informationLoss: 1,
    received: `Có chuyện gì đó vừa xảy ra ở ${origin}, không rõ là gì.`,
  }
}

/** Các event mà người chơi thực sự nhận được nội dung (không tính 'presence', vì nó không có ngữ nghĩa). */
export function playerVisibleEvents(event: CanonicalEvent, world: WorldState): boolean {
  return playerPerception(event, world).fidelity !== 'none'
}

function mergeInto(
  merged: Map<string, BroadcastEntry>,
  entry: BroadcastEntry,
): void {
  const existing = merged.get(entry.actorId)
  if (existing === undefined) {
    merged.set(entry.actorId, entry)
    return
  }
  // Giữ mức tri giác mạnh nhất, nhưng ghép nội dung của mọi event: actor ở cùng phòng nghe rõ câu nói
  // và vẫn cảm nhận được tiếng động ở phòng kề trong cùng lượt.
  const stronger = RANK[entry.fidelity] > RANK[existing.fidelity] ? entry.fidelity : existing.fidelity
  const received = existing.received === '' ? entry.received : entry.received === '' ? existing.received : `${existing.received}\n${entry.received}`
  merged.set(entry.actorId, {
    eventId: existing.eventId,
    actorId: entry.actorId,
    fidelity: stronger,
    informationLoss: lossOf(stronger),
    received,
  })
}

/**
 * Định tuyến một lô event canonical.
 *
 * `private` bị chặn ở đây và chỉ ở đây — nên nếu event riêng tư rò rỉ ra narrator, lỗi nằm gọn trong
 * một hàm thay vì rải khắp pipeline.
 */
export function routeCanonicalEvents(input: {
  readonly events: readonly CanonicalEvent[]
  readonly world: WorldState
  readonly definitions: readonly ActorDefinition[]
  readonly seed?: string | number
  readonly turn?: number
}): BroadcastResult {
  const seed = input.seed ?? 'actor'
  const turn = input.turn ?? input.world.turn
  const entries: BroadcastEntry[] = []
  const merged = new Map<string, BroadcastEntry>()
  const publicLines: string[] = []
  const publicEventIds: string[] = []
  const withheldEventIds: string[] = []
  const privateEventIds: string[] = []
  const privateLines: string[] = []

  for (const event of input.events) {
    if (event.visibility === 'private') {
      privateEventIds.push(event.id)
      privateLines.push(eventText(event))
      continue
    }

    const player = playerPerception(event, input.world)
    if (player.fidelity === 'none') {
      withheldEventIds.push(event.id)
    } else {
      publicEventIds.push(event.id)
      publicLines.push(player.fidelity === 'full' ? eventText(event) : player.received)
    }

    const routed = routePlayerAction(eventToPerceptionSource(event), input.world, input.definitions, { seed, turn })
    for (const definition of input.definitions) {
      const perception = routed.entries[definition.id]
      if (perception === undefined || perception.fidelity === 'none') continue
      const entry: BroadcastEntry = {
        eventId: event.id,
        actorId: definition.id,
        fidelity: perception.fidelity,
        informationLoss: perception.informationLoss,
        received: perception.received,
      }
      entries.push(entry)
      mergeInto(merged, entry)
    }
  }

  const perceptions: Record<string, Perception> = {}
  for (const definition of input.definitions) {
    const entry = merged.get(definition.id)
    perceptions[definition.id] = entry === undefined
      ? { actorId: definition.id, fidelity: 'none', informationLoss: 1, received: '' }
      : { actorId: definition.id, fidelity: entry.fidelity, informationLoss: entry.informationLoss, received: entry.received }
  }

  return {
    entries,
    perceptions: { entries: perceptions },
    publicLines,
    publicEventIds,
    withheldEventIds,
    privateEventIds,
    privateLines,
  }
}

/**
 * Lời kể công khai gắn với địa điểm người chơi đang đứng.
 *
 * Narrator cần biết điều này để không kể chuyện xảy ra ở phòng khác như thể người chơi đang nhìn thấy —
 * và để không bao giờ nhận được nội dung `private`.
 */
export function renderPublicFrame(result: BroadcastResult, world: WorldState): string {
  const lines = [...result.publicLines]
  if (result.withheldEventIds.length > 0) {
    lines.push(`(${result.withheldEventIds.length} sự việc xảy ra ngoài tầm tri giác của người chơi — chỉ kể nếu có dấu hiệu gián tiếp.)`)
  }
  if (lines.length === 0) return `Không có gì mới trong tầm tri giác của người chơi ở ${world.player.location}.`
  return lines.join('\n')
}
