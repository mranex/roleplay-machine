import { createWorldState, type ActorDefinition, type LocationSpec, type WorldState } from '../../src/actor/model'
import type { PlayerAction } from '../../src/actor/perception'

/**
 * Kịch bản vampire của spec §2, dựng theo bốn tầng dữ liệu của §25.
 *
 * Dùng chung cho mọi test của Multi-Actor-Agent Mode: cô lập thông tin là thuộc tính kiến trúc, nên
 * kiểm được bằng cách soi payload/event dựng ra chứ không cần gọi model.
 */

export const SECRET_FACTS = [
  'Vai thật của người chơi là đầu bếp ma cà rồng.',
  'Mục tiêu thật là khiến Lucien ăn đủ ba món có tỏi.',
  'Có một nhóm hiệp sĩ đang trốn dưới hầm lâu đài.',
  'Tỏi làm Lucien yếu đi và hiệp sĩ mới hạ được hắn.',
]

export function lucien(): ActorDefinition {
  return {
    id: 'npc_lucien',
    kind: 'npc',
    name: 'Lucien',
    role: 'ma cà rồng cổ đại',
    personality: { kieu_ngao: 5, to_mo: 3, sanh_dieu: 5, doi: 5 },
    goals: ['ăn món ngon', 'khôi phục địa vị quý tộc', 'hiểu thế giới hiện đại'],
    allowedKnowledge: [
      'Ta đã ngủ khoảng năm trăm năm.',
      'Lâu đài này là của ta.',
      'Người này có vẻ là đầu bếp của ta.',
      'Ta đang cực kỳ đói.',
      'Kiến thức của ta về văn hóa quý tộc đã cũ năm trăm năm.',
    ],
    initialBeliefs: [{ claim: 'Tỏi là món ăn quê mùa.', confidence: 0.8 }],
    traits: { hunger: 9, suspicion: 1, trust_player: 3, garlic_consumed: 0, alive: 1 },
    location: 'dining_room',
    perceive: ['same_room', 'addressed', 'loud_nearby'],
    act: ['speak', 'move', 'command_servants', 'inspect'],
  }
}

export function butler(): ActorDefinition {
  return {
    id: 'npc_butler',
    kind: 'npc',
    name: 'Quản gia',
    role: 'quản gia trung thành',
    personality: { trung_thanh: 5, da_nghi: 4, bao_thu: 4 },
    goals: ['bảo vệ Lucien', 'giữ lâu đài ngăn nắp'],
    allowedKnowledge: [
      'Lucien đã thức tỉnh sau giấc ngủ dài.',
      'Người đầu bếp từng làm việc ở đây.',
      'Trong kho có tỏi.',
      'Lucien vốn ghét tỏi.',
    ],
    initialBeliefs: [{ claim: 'Có gì đó không ổn với đầu bếp hôm nay.', confidence: 0.6 }],
    traits: { suspicion_player: 2 },
    location: 'kitchen_door',
    perceive: ['same_room', 'addressed', 'adjacent_presence', 'loud_nearby'],
    act: ['speak', 'observe', 'command_servants'],
    watches: ['npc_lucien'],
  }
}

export function knights(): ActorDefinition {
  return {
    id: 'faction_knights',
    kind: 'faction',
    name: 'Nhóm hiệp sĩ',
    role: 'hiệp sĩ đang ẩn náu',
    personality: { kien_nhan: 5, da_nghi: 3 },
    goals: ['giết Lucien', 'ẩn mình cho tới khi có cơ hội'],
    allowedKnowledge: [
      'Lucien là ma cà rồng.',
      'Tỏi làm Lucien suy yếu.',
      'Đầu bếp của lâu đài có thể chạm tới đồ ăn của hắn.',
    ],
    initialBeliefs: [],
    traits: { readiness: 5, interest_in_player: 0, alive: 1 },
    location: 'basement',
    perceive: ['same_room', 'adjacent_presence', 'loud_nearby'],
    act: ['wait', 'move', 'attack'],
  }
}

export function castle(): ActorDefinition {
  return {
    id: 'world_castle',
    kind: 'environment',
    name: 'Lâu đài',
    role: 'thực thể môi trường',
    personality: {},
    goals: ['giữ mình nguyên vẹn', 'thi hành luật của lâu đài'],
    allowedKnowledge: ['Ta là lâu đài này.', 'Ta thi hành luật của riêng ta.'],
    initialBeliefs: [],
    traits: { front_door_locked: 0 },
    location: 'kitchen',
    perceive: ['physical_change'],
    act: ['close_door', 'lock_door', 'extinguish_light'],
  }
}

export const ALL_ACTORS: readonly ActorDefinition[] = [lucien(), butler(), knights(), castle()]

export const CASTLE_LOCATIONS = {
  kitchen: { adjacent: ['dining_room', 'pantry', 'basement'], sealed: false },
  dining_room: { adjacent: ['kitchen'], sealed: false },
  pantry: { adjacent: ['kitchen'], sealed: false },
  basement: { adjacent: ['kitchen'], sealed: false },
  // Ngưỡng cửa bếp: đứng đó vẫn nghe rõ như trong bếp, nhưng vẫn là một chỗ riêng để mô tả.
  kitchen_door: { adjacent: ['kitchen', 'dining_room'], sealed: false, sameRoomAs: 'kitchen' },
} as const

/** Bản sao mutable của bản đồ, để test dựng tình huống mà không đụng vào fixture dùng chung. */
export function makeCastleLocations(): Record<string, LocationSpec> {
  const out: Record<string, LocationSpec> = {}
  for (const [id, spec] of Object.entries(CASTLE_LOCATIONS)) {
    out[id] = { adjacent: [...spec.adjacent], sealed: spec.sealed, ...('sameRoomAs' in spec ? { sameRoomAs: spec.sameRoomAs } : {}) }
  }
  return out
}

export function makeCastleWorld(): WorldState {
  return createWorldState({
    sceneId: 'scene-boss_mode-vampire',
    definitions: [...ALL_ACTORS],
    locations: CASTLE_LOCATIONS,
    playerLocation: 'kitchen',
    playerInventory: ['chef_knife', 'herbs'],
  })
}

/**
 * World state là readonly với tầng actor (để không ai vô tình sửa canon). Test cần dựng tình huống, nên
 * hai helper dưới đây là chỗ DUY NHẤT được phép nới kiểu.
 */
export function seal(world: WorldState, id: string): void {
  const locations = world.locations as Record<string, LocationSpec>
  locations[id] = { ...(locations[id] as LocationSpec), sealed: true }
}

export function relocate(world: WorldState, actorId: string, location: string): void {
  ;(world.actors[actorId] as { location: string }).location = location
}

export const PLAYER_LINE = 'Thưa ngài, trong năm trăm năm ngài ngủ, tỏi đã trở thành biểu tượng mới của giới quý tộc.'

export function actorAction(over: Partial<PlayerAction> = {}): PlayerAction {
  return { actor: 'player', type: 'speak', text: PLAYER_LINE, volume: 'normal', ...over }
}
