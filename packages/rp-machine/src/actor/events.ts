/**
 * Canonical events — từ vựng của sự thật.
 *
 * Spec §10: "Actor intents are proposals, not reality." Chỉ event đã qua Resolver mới là canon. File này
 * định nghĩa *hình dạng* của một sự thật, còn `resolve.ts` quyết cái nào được commit.
 *
 * Một event luôn có nguồn (`player`, `world`, hoặc một actor id) và một địa điểm, vì đó là hai thứ mà
 * định tuyến tri giác cần để biết ai thấy được nó.
 */

import type { WorldState } from './model'
import type { PlayerAction, Volume } from './perception'

export const EVENT_TYPES = [
  'player_move',
  'player_item',
  'npc_dialogue',
  'npc_move',
  'actor_trait',
  'world_flag',
  'environment',
  'observation',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface ItemTransfer {
  readonly item: string
  readonly count: number
  /** 'player' hoặc id địa điểm. */
  readonly from: string
  /** 'player' hoặc id địa điểm. */
  readonly to: string
}

export interface CanonicalEvent {
  readonly id: string
  readonly type: EventType
  readonly turn: number
  /** 'player' | 'world' | actor id. */
  readonly source: string
  readonly location: string
  readonly target?: string
  readonly content?: string
  /** Chỉ được đổi trait ĐÃ TỒN TẠI trên chính actor nguồn; giá trị là delta. */
  readonly changes?: Readonly<Record<string, number>>
  readonly item?: ItemTransfer
  readonly toLocation?: string
  readonly flag?: { readonly key: string; readonly value: boolean | number | string }
  /** Âm lượng của event, dùng cho định tuyến tri giác. Mặc định suy ra từ loại event. */
  readonly volume?: Volume
  /** `private` = không bao giờ tới tay người chơi; `public` = narrator được thấy. */
  readonly visibility: 'public' | 'private'
}

export interface EventIssue {
  readonly eventId: string
  readonly message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Trần ký tự cho một câu thoại. Actor là model, nó có thể trả về cả một chương. */
export const DIALOGUE_MAX = 600
/** Delta lớn nhất cho một trait trong một lượt. Chặn việc đổi state bằng một câu. */
export const TRAIT_DELTA_MAX = 3
export const TRAIT_MIN = 0
export const TRAIT_MAX = 20

function isActorSource(world: WorldState, source: string): boolean {
  return source !== 'player' && source !== 'world' && world.actors[source] !== undefined
}

/**
 * Kiểm một event. Trả danh sách lỗi; rỗng nghĩa là hợp lệ và được phép commit.
 *
 * Đây là hàng rào duy nhất giữa "model đề xuất" và "thế giới đổi". Mọi bất biến của canon nằm ở đây.
 */
export function validateEvent(event: CanonicalEvent, world: WorldState): EventIssue[] {
  const issues: EventIssue[] = []
  const fail = (message: string): void => {
    issues.push({ eventId: event.id, message })
  }

  if (event.id.trim() === '') fail('thiếu id')
  if (!(EVENT_TYPES as readonly string[]).includes(event.type)) fail(`type không hợp lệ: ${String(event.type)}`)
  if (event.visibility !== 'public' && event.visibility !== 'private') fail(`visibility không hợp lệ: ${String(event.visibility)}`)
  if (!Number.isInteger(event.turn) || event.turn < 0) fail('turn phải là số nguyên không âm')
  if (event.source !== 'player' && event.source !== 'world' && !isActorSource(world, event.source)) {
    fail(`source không tồn tại: ${event.source}`)
  }
  if (world.locations[event.location] === undefined) fail(`địa điểm không tồn tại: ${event.location}`)
  if (event.target !== undefined && event.target !== 'player' && !isActorSource(world, event.target)) {
    fail(`target không tồn tại: ${event.target}`)
  }

  const sourceState = world.actors[event.source]

  switch (event.type) {
    case 'npc_dialogue': {
      if (sourceState === undefined) fail('npc_dialogue phải có nguồn là một actor')
      const content = event.content ?? ''
      if (content.trim() === '') fail('npc_dialogue thiếu content')
      if (content.length > DIALOGUE_MAX) fail(`content vượt ${DIALOGUE_MAX} ký tự (${content.length})`)
      break
    }
    case 'observation': {
      const content = event.content ?? ''
      if (content.trim() === '') fail('observation thiếu content')
      if (content.length > DIALOGUE_MAX) fail(`content vượt ${DIALOGUE_MAX} ký tự`)
      break
    }
    case 'npc_move':
    case 'player_move': {
      const to = event.toLocation
      if (to === undefined || to === '') {
        fail('thiếu toLocation')
        break
      }
      if (world.locations[to] === undefined) {
        fail(`địa điểm đích không tồn tại: ${to}`)
        break
      }
      const current = event.type === 'player_move' ? world.player.location : sourceState?.location
      if (current === undefined) {
        fail('không xác định được vị trí hiện tại của nguồn')
        break
      }
      if (current === to) {
        fail('đích trùng vị trí hiện tại')
        break
      }
      const spec = world.locations[current]
      const adjacent = (spec?.adjacent ?? []).includes(to) || (world.locations[to]?.adjacent ?? []).includes(current)
      if (!adjacent) {
        fail(`${current} không kề ${to} — không đi thẳng được trong một lượt`)
        break
      }
      if (spec?.sealed === true || world.locations[to]?.sealed === true) {
        fail(`cửa giữa ${current} và ${to} đang niêm phong`)
      }
      break
    }
    case 'actor_trait': {
      if (sourceState === undefined) fail('actor_trait phải có nguồn là một actor')
      const changes = event.changes ?? {}
      if (Object.keys(changes).length === 0) fail('actor_trait không có changes')
      for (const [key, delta] of Object.entries(changes)) {
        if (sourceState !== undefined && sourceState.traits[key] === undefined) {
          // Không cho phép bịa ra trait mới: trait là thứ đã được khai trong định nghĩa actor.
          fail(`trait "${key}" không tồn tại trên ${event.source} — không được bịa trait mới`)
          continue
        }
        if (!Number.isFinite(delta)) {
          fail(`delta của "${key}" không phải số`)
          continue
        }
        if (Math.abs(delta) > TRAIT_DELTA_MAX) {
          fail(`delta của "${key}" vượt ${TRAIT_DELTA_MAX} trong một lượt (${delta})`)
        }
      }
      break
    }
    case 'world_flag': {
      const key = event.flag?.key ?? ''
      if (key.trim() === '') fail('world_flag thiếu flag.key')
      break
    }
    case 'environment': {
      const key = event.flag?.key ?? ''
      if (key.trim() === '') fail('environment thiếu flag.key')
      break
    }
    case 'player_item': {
      const item = event.item
      if (item === undefined) {
        fail('player_item thiếu item')
        break
      }
      if (item.item.trim() === '') fail('item.item rỗng')
      if (!Number.isInteger(item.count) || item.count < 1) fail('item.count phải là số nguyên >= 1')
      if (item.from !== 'player' && world.locations[item.from] === undefined) fail(`item.from không tồn tại: ${item.from}`)
      if (item.to !== 'player' && world.locations[item.to] === undefined) fail(`item.to không tồn tại: ${item.to}`)
      if (item.from === item.to) fail('item.from trùng item.to')
      if (item.from === 'player') {
        const held = world.player.inventory.filter(id => id === item.item).length
        if (held < item.count) fail(`người chơi chỉ có ${held} "${item.item}", không đủ ${item.count}`)
      } else {
        const available = world.items[item.item]
        if (available === undefined || available.location !== item.from) {
          fail(`"${item.item}" không có ở ${item.from}`)
        } else if (available.count < item.count) {
          fail(`ở ${item.from} chỉ có ${available.count} "${item.item}", không đủ ${item.count}`)
        }
      }
      break
    }
  }

  return issues
}

/** Kiểm cả lô. Id trùng trong cùng một lô cũng bị coi là lỗi. */
export function validateEvents(events: readonly CanonicalEvent[], world: WorldState): EventIssue[] {
  const issues: EventIssue[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (seen.has(event.id)) {
      issues.push({ eventId: event.id, message: 'id trùng trong cùng một lô' })
      continue
    }
    seen.add(event.id)
    issues.push(...validateEvent(event, world))
  }
  return issues
}

/** Âm lượng mặc định của một event khi Resolver không khai. */
export function defaultVolume(event: CanonicalEvent): Volume {
  switch (event.type) {
    case 'npc_dialogue':
      return /[!]/.test(event.content ?? '') ? 'loud' : 'normal'
    case 'observation':
      return 'whisper'
    case 'player_item':
    case 'npc_move':
    case 'player_move':
      return 'normal'
    case 'actor_trait':
    case 'world_flag':
    case 'environment':
      return 'loud'
  }
}

/** Loại hành động tương ứng trong ma trận tri giác của perception router. */
export function eventActionType(event: CanonicalEvent): string {
  switch (event.type) {
    case 'player_move':
    case 'npc_move':
      return 'move'
    case 'player_item':
      return 'item_transfer'
    case 'environment':
      return 'lock'
    case 'world_flag':
      return 'lock'
    default:
      return 'speak'
  }
}

/**
 * Biến một event thành "nguồn phát" để dùng lại đúng ma trận tri giác của perception router.
 * Event và hành động của người chơi đều là "có gì đó xảy ra ở một địa điểm, với một âm lượng".
 *
 * `actor` giữ nguyên nguồn thật (`player`, `world`, hoặc id actor) và `fromLocation` giữ địa điểm phát,
 * nên `routeCanonicalEvents` định tuyến được event của NPC mà không phải giả nó là hành động người chơi.
 */
export function eventToPerceptionSource(event: CanonicalEvent): PlayerAction {
  return {
    actor: event.source,
    type: eventActionType(event),
    text: eventText(event),
    volume: event.volume ?? defaultVolume(event),
    fromLocation: event.location,
    ...(event.target === undefined || event.target === 'player' ? {} : { targetActorId: event.target }),
  }
}

/** Câu mô tả trung tính cho một event — dùng cho cả broadcast lẫn narrator. */
export function eventText(event: CanonicalEvent): string {
  switch (event.type) {
    case 'npc_dialogue':
      return event.content ?? ''
    case 'observation':
      return event.content ?? ''
    case 'npc_move':
      return `${event.source} rời ${event.location} tới ${event.toLocation ?? '(không rõ)'}.`
    case 'player_move':
      return `Người chơi rời ${event.location} tới ${event.toLocation ?? '(không rõ)'}.`
    case 'player_item':
      return event.item === undefined
        ? 'Có đồ vật được di chuyển.'
        : `${event.item.count} "${event.item.item}" được chuyển từ ${event.item.from} tới ${event.item.to}.`
    case 'actor_trait':
      return `${event.source} đổi trạng thái.`
    case 'world_flag':
      return `Thế giới đổi trạng thái: ${event.flag?.key ?? '?'}.`
    case 'environment':
      return `Môi trường đổi: ${event.flag?.key ?? '?'}.`
  }
}

export function isPrivate(event: CanonicalEvent): boolean {
  return event.visibility === 'private'
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}
