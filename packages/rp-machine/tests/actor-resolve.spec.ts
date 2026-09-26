import { describe, expect, it } from 'vitest'
import { commitEvents, commitActorBeliefs, evaluateEndConditions, proposeEvents, validateEndConditions } from '../src/actor/resolve'
import type { CanonicalEvent } from '../src/actor/events'
import { routeCanonicalEvents, playerPerception } from '../src/actor/broadcast'
import { selectAwakeActors } from '../src/actor/wake'
import type { ActorDefinition, WorldState } from '../src/actor/model'
import { ALL_ACTORS, makeCastleWorld, relocate, seal } from './fixtures/actors'

/**
 * M2 — Resolver và Selective Broadcast.
 *
 * Trọng tâm: ý định của model không được tự động thành sự thật, và một sự thật chỉ tới tay người tri
 * giác được nó. Cả hai đều kiểm được bằng event dựng tay, không cần model.
 */

function world(): WorldState {
  return makeCastleWorld()
}

function event(over: Partial<CanonicalEvent> & Pick<CanonicalEvent, 'type' | 'source' | 'location'>): CanonicalEvent {
  return { id: 'e1', turn: 1, visibility: 'public', ...over } as CanonicalEvent
}

describe('commitEvents — cổng duy nhất vào canon', () => {
  it('commit chuyển đồ trong kho, trừ đúng số lượng', () => {
    const current = world()
    current.items['garlic'] = { location: 'pantry', count: 3 }

    const result = commitEvents(current, [
      event({ id: 'e1', type: 'player_item', source: 'world', location: 'pantry', item: { item: 'garlic', count: 2, from: 'pantry', to: 'player' } }),
    ])

    expect(result.rejected).toEqual([])
    expect(result.committed).toHaveLength(1)
    expect(result.world.player.inventory.filter(id => id === 'garlic')).toHaveLength(2)
    expect(result.world.items['garlic']?.count).toBe(1)
  })

  it('từ chối lấy quá số đồ đang có, và KHÔNG để lại dấu vết', () => {
    const current = world()
    current.items['garlic'] = { location: 'pantry', count: 1 }

    const result = commitEvents(current, [
      event({ id: 'e1', type: 'player_item', source: 'world', location: 'pantry', item: { item: 'garlic', count: 3, from: 'pantry', to: 'player' } }),
    ])

    expect(result.committed).toEqual([])
    expect(result.rejected[0]?.issues.map(i => i.message).join(' ')).toMatch(/không đủ 3/)
    expect(result.world.items['garlic']).toEqual({ location: 'pantry', count: 1 })
    expect(result.world.player.inventory).not.toContain('garlic')
  })

  it('từ chối nguồn không tồn tại', () => {
    const result = commitEvents(world(), [
      event({ id: 'e1', type: 'npc_dialogue', source: 'npc_ghost', location: 'kitchen', content: 'Ta là ai?' }),
    ])
    expect(result.rejected[0]?.issues.map(i => i.message).join(' ')).toMatch(/source không tồn tại: npc_ghost/)
  })

  it('từ chối trait bịa ra — trait là thứ đã khai trong định nghĩa actor', () => {
    const result = commitEvents(world(), [
      event({ id: 'e1', type: 'actor_trait', source: 'npc_lucien', location: 'dining_room', changes: { immortality: 5 } }),
    ])
    expect(result.rejected[0]?.issues.map(i => i.message).join(' ')).toMatch(/không được bịa trait mới/)
  })

  it('từ chối delta vượt trần một lượt', () => {
    const result = commitEvents(world(), [
      event({ id: 'e1', type: 'actor_trait', source: 'npc_lucien', location: 'dining_room', changes: { suspicion: 5 } }),
    ])
    expect(result.rejected[0]?.issues.map(i => i.message).join(' ')).toMatch(/vượt 3 trong một lượt/)
  })

  it('từ chối nhảy sang phòng không kề', () => {
    const current = world()
    current.player.location = 'pantry'
    const result = commitEvents(current, [
      event({ id: 'e1', type: 'player_move', source: 'player', location: 'pantry', toLocation: 'dining_room' }),
    ])
    expect(result.rejected[0]?.issues.map(i => i.message).join(' ')).toMatch(/không kề/)
    expect(result.world.player.location).toBe('pantry')
  })

  it('từ chối đi xuyên cửa niêm phong', () => {
    const current = world()
    seal(current, 'kitchen')
    const result = commitEvents(current, [
      event({ id: 'e1', type: 'player_move', source: 'player', location: 'kitchen', toLocation: 'pantry' }),
    ])
    expect(result.rejected[0]?.issues.map(i => i.message).join(' ')).toMatch(/niêm phong/)
  })

  it('commit KHÔNG sửa vào state gốc — Resolver là hàm thuần', () => {
    const current = world()
    const before = JSON.stringify(current)
    current.items['garlic'] = { location: 'pantry', count: 3 }
    const snapshot = JSON.stringify(current)

    const result = commitEvents(current, [
      event({ id: 'e1', type: 'npc_move', source: 'npc_lucien', location: 'dining_room', toLocation: 'kitchen' }),
      event({ id: 'e2', type: 'actor_trait', source: 'world_castle', location: 'kitchen', changes: { front_door_locked: 2 } }),
      event({ id: 'e3', type: 'world_flag', source: 'world', location: 'kitchen', flag: { key: 'alarm', value: true } }),
    ])

    expect(result.committed).toHaveLength(3)
    expect(JSON.stringify(current)).toBe(snapshot)
    expect(JSON.stringify(current)).not.toBe(before)
    expect(current.actors['npc_lucien']?.location).toBe('dining_room')
    expect(result.world.actors['npc_lucien']?.location).toBe('kitchen')
    expect(result.world.actors['world_castle']?.traits['front_door_locked']).toBe(2)
    expect(result.world.flags['alarm']).toBe(true)
  })

  it('event sau được kiểm trên state đã đổi bởi event trước', () => {
    const current = world()
    // Nếu kiểm trên state gốc thì bước 2 sẽ hợp lệ (bếp kề phòng ăn), nhưng người chơi đã ở kho rồi.
    const result = commitEvents(current, [
      event({ id: 'e1', type: 'player_move', source: 'player', location: 'kitchen', toLocation: 'pantry' }),
      event({ id: 'e2', type: 'player_move', source: 'player', location: 'kitchen', toLocation: 'dining_room' }),
    ])

    expect(result.committed.map(e => e.id)).toEqual(['e1'])
    expect(result.rejected.map(r => r.event.id)).toEqual(['e2'])
    expect(result.world.player.location).toBe('pantry')
  })

  it('chuỗi di chuyển hợp lệ trong cùng một lượt vẫn đi hết', () => {
    const result = commitEvents(world(), [
      event({ id: 'e1', type: 'player_move', source: 'player', location: 'kitchen', toLocation: 'dining_room' }),
      event({ id: 'e2', type: 'player_move', source: 'player', location: 'dining_room', toLocation: 'kitchen' }),
    ])
    expect(result.committed).toHaveLength(2)
    expect(result.world.player.location).toBe('kitchen')
  })

  it('environment với khoá sealed đổi bản đồ tri giác, không đổi cờ thế giới', () => {
    const result = commitEvents(world(), [
      event({ id: 'e1', type: 'environment', source: 'world_castle', location: 'basement', flag: { key: 'sealed', value: true } }),
    ])
    expect(result.committed).toHaveLength(1)
    expect(result.world.locations['basement']?.sealed).toBe(true)
    expect(result.world.flags['sealed']).toBeUndefined()
  })
})

describe('proposeEvents — ý định không phải canon', () => {
  function output(over: Record<string, unknown> = {}) {
    return {
      actorId: 'npc_lucien',
      interpretation: 'Người đầu bếp vừa xúc phạm ta.',
      emotion: 'phẫn nộ',
      intent: { type: 'attack' as const, target: 'player', content: 'Ta sẽ tóm lấy cổ hắn.' },
      beliefClaims: [],
      ...over,
    } as unknown as Parameters<typeof proposeEvents>[0]['outputs'][number]
  }

  it('ý định tấn công chỉ sinh một observation riêng tư, không đổi state', () => {
    const current = world()
    const events = proposeEvents({ world: current, outputs: [output()], turn: 3 })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('observation')
    expect(events[0]?.visibility).toBe('private')
    expect(events[0]?.content).toContain('Dự định này chưa được thực hiện')

    const result = commitEvents(current, events)
    expect(result.committed).toHaveLength(1)
    expect(JSON.stringify(result.world.actors['npc_lucien'])).toBe(JSON.stringify(current.actors['npc_lucien']))
    expect(result.world.player.inventory).toEqual(current.player.inventory)
  })

  it('lời nói thì thành canon ngay — nói ra là chuyện đã xảy ra', () => {
    const events = proposeEvents({
      world: world(),
      outputs: [output({ intent: { type: 'dialogue', target: 'player', content: 'Ngươi dám?' } })],
      turn: 3,
    })
    expect(events[0]?.type).toBe('npc_dialogue')
    expect(events[0]?.visibility).toBe('public')
    expect(events[0]?.target).toBe('player')
  })

  it('target không tồn tại bị bỏ, không làm hỏng event', () => {
    const events = proposeEvents({
      world: world(),
      outputs: [output({ intent: { type: 'dialogue', target: 'npc_ghost', content: 'Ngươi dám?' } })],
      turn: 3,
    })
    expect(events[0]?.target).toBeUndefined()
    expect(commitEvents(world(), events).rejected).toEqual([])
  })

  it('actor không có trong world bị bỏ qua, và nội dung rỗng không sinh event', () => {
    const events = proposeEvents({
      world: world(),
      outputs: [
        output({ actorId: 'npc_ghost' }),
        output({ intent: { type: 'dialogue', content: '   ' } }),
      ],
      turn: 3,
    })
    expect(events).toEqual([])
  })

  it('hai actor nói trong cùng lượt có id khác nhau', () => {
    const events = proposeEvents({
      world: world(),
      outputs: [
        output({ intent: { type: 'dialogue', content: 'A' } }),
        output({ actorId: 'npc_butler', intent: { type: 'dialogue', content: 'B' } }),
      ],
      turn: 4,
    })
    expect(events.map(e => e.id)).toEqual(['evt_4_npc_lucien_say', 'evt_4_npc_butler_say'])
    expect(commitEvents(world(), events).rejected).toEqual([])
  })
})

describe('niềm tin và kế hoạch — tài sản riêng, không phải canon', () => {
  const butlerOutput = {
    actorId: 'npc_butler',
    interpretation: 'Đầu bếp đang toan tính.',
    emotion: 'cảnh giác',
    intent: { type: 'inspect' as const, target: 'player', content: '' },
    beliefClaims: [{ claim: 'Đầu bếp đang toan tính.', confidence: 0.8 }],
    plan: { goal: 'lục phòng người chơi', trigger: 'player_leaves_kitchen' },
  } as unknown as Parameters<typeof commitActorBeliefs>[1][number]

  it('ghi belief và plan vào state của chính actor đó', () => {
    const after = commitActorBeliefs(world(), [butlerOutput], 2)
    const beliefs = after.actors['npc_butler']?.beliefs ?? []
    expect(beliefs.map(b => b.claim)).toContain('Đầu bếp đang toan tính.')
    expect(after.actors['npc_butler']?.plans[0]?.goal).toBe('lục phòng người chơi')
    // Không actor nào khác bị đụng tới.
    expect(after.actors['npc_lucien']?.beliefs.map(b => b.claim)).not.toContain('Đầu bếp đang toan tính.')
  })

  it('belief mới không sửa canon: người chơi vẫn giữ tỏi trong túi', () => {
    const current = world()
    current.player.inventory.push('garlic')
    const after = commitActorBeliefs(current, [butlerOutput], 2)
    expect(after.player.inventory).toContain('garlic')
    expect(JSON.stringify(after.player)).toBe(JSON.stringify(current.player))
  })

  it('belief trùng thì cập nhật confidence chứ không nhân bản; plan trùng thì bỏ', () => {
    const once = commitActorBeliefs(world(), [butlerOutput], 2)
    const twice = commitActorBeliefs(once, [
      { ...butlerOutput, beliefClaims: [{ claim: 'Đầu bếp đang toan tính.', confidence: 0.95 }] },
    ], 3)

    const beliefs = twice.actors['npc_butler']?.beliefs.filter(b => b.claim === 'Đầu bếp đang toan tính.') ?? []
    expect(beliefs).toHaveLength(1)
    expect(beliefs[0]?.confidence).toBe(0.95)
    expect(twice.actors['npc_butler']?.plans).toHaveLength(1)
  })

  it('ký ức actor có trần, để một ván dài không phình vô hạn', () => {
    const flood = Array.from({ length: 30 }, (_, index) => ({
      ...butlerOutput,
      beliefClaims: [{ claim: `nghi ngờ số ${index}`, confidence: 0.5 }],
    })) as unknown as Parameters<typeof commitActorBeliefs>[1]
    const after = commitActorBeliefs(world(), flood, 5)
    const beliefs = after.actors['npc_butler']?.beliefs ?? []
    expect(beliefs.length).toBeLessThanOrEqual(20)
    // Giữ cái mới nhất, bỏ cái cũ nhất.
    expect(beliefs.map(b => b.claim)).toContain('nghi ngờ số 29')
    expect(beliefs.map(b => b.claim)).not.toContain('nghi ngờ số 0')
  })
})

describe('điều kiện kết thúc', () => {
  const conditions = validateEndConditions([
    { id: 'end_win', outcome: 'won', allOf: [{ kind: 'inventory', item: 'garlic', count: 3 }, { kind: 'trait', actor: 'npc_lucien', key: 'garlic_consumed', op: '>=', value: 3 }] },
    { id: 'end_lucien_down', outcome: 'lost', allOf: [{ kind: 'trait', actor: 'npc_lucien', key: 'hunger', op: '<=', value: 0 }] },
    { id: 'end_revealed', outcome: 'ejected', allOf: [{ kind: 'boolFlag', key: 'knights_revealed', value: true }] },
  ])

  it('nạp được ba điều kiện hợp lệ', () => {
    expect(conditions.issues).toEqual([])
    expect(conditions.conditions).toHaveLength(3)
  })

  it('điều kiện chưa khớp thì chưa có kết thúc', () => {
    expect(evaluateEndConditions(world(), conditions.conditions)).toBeUndefined()
  })

  it('khớp điều kiện thắng khi đủ tỏi và Lucien đã ăn đủ', () => {
    const current = world()
    current.player.inventory.push('garlic', 'garlic', 'garlic')
    current.actors['npc_lucien']!.traits['garlic_consumed'] = 3
    expect(evaluateEndConditions(current, conditions.conditions)?.outcome).toBe('won')
  })

  it('thứ tự trong danh sách là thứ tự ưu tiên', () => {
    const current = world()
    current.player.inventory.push('garlic', 'garlic', 'garlic')
    current.actors['npc_lucien']!.traits['garlic_consumed'] = 3
    current.actors['npc_lucien']!.traits['hunger'] = 0
    expect(evaluateEndConditions(current, conditions.conditions)?.id).toBe('end_win')
  })

  it('điều kiện hỏng bị báo chứ không bị bỏ im lặng', () => {
    const bad = validateEndConditions([
      { id: '', outcome: 'thắng', allOf: [] },
      { id: 'x', outcome: 'won', allOf: [{ kind: 'trait', actor: 'npc_lucien' }] },
      { id: 'y', outcome: 'won', allOf: [{ kind: 'mana', value: 1 }] },
    ])
    const messages = bad.issues.map(i => `${i.where}: ${i.message}`).join('\n')
    expect(messages).toMatch(/thiếu id/)
    expect(messages).toMatch(/outcome phải là won \| lost \| ejected/)
    expect(messages).toMatch(/allOf rỗng/)
    expect(messages).toMatch(/trait cần actor, key, op/)
    expect(messages).toMatch(/kind không hợp lệ: mana/)
  })

  it('không phải array thì báo, không ném', () => {
    expect(validateEndConditions(undefined).issues[0]?.message).toMatch(/phải là array/)
  })

  it('boolFlag và flag số hoạt động', () => {
    const parsed = validateEndConditions([
      { id: 'a', outcome: 'won', allOf: [{ kind: 'boolFlag', key: 'alarm', value: true }] },
      { id: 'b', outcome: 'lost', allOf: [{ kind: 'flag', key: 'danger', op: '>=', value: 3 }] },
    ])
    expect(parsed.issues).toEqual([])
    const current = world()
    expect(evaluateEndConditions(current, parsed.conditions)).toBeUndefined()
    current.flags['danger'] = 4
    expect(evaluateEndConditions(current, parsed.conditions)?.id).toBe('b')
    current.flags['alarm'] = true
    expect(evaluateEndConditions(current, parsed.conditions)?.id).toBe('a')
  })

  it('actorAlive dùng trait alive, mặc định còn sống khi actor không khai trait đó', () => {
    const parsed = validateEndConditions([
      { id: 'ritual', outcome: 'won', allOf: [{ kind: 'boolFlag', key: 'ritual_done', value: true }, { kind: 'actorAlive', actor: 'faction_knights' }] },
    ])
    const current = world()
    current.flags['ritual_done'] = true
    expect(evaluateEndConditions(current, parsed.conditions)?.id).toBe('ritual')

    current.actors['faction_knights']!.traits['alive'] = 0
    expect(evaluateEndConditions(current, parsed.conditions)).toBeUndefined()

    // Actor không khai trait alive: mặc định là còn sống, không phải "không rõ nên thôi".
    const noTrait = validateEndConditions([{ id: 'x', outcome: 'lost', allOf: [{ kind: 'actorAlive', actor: 'npc_butler' }] }])
    expect(evaluateEndConditions(world(), noTrait.conditions)?.id).toBe('x')
  })
})

describe('selective broadcast — ai được biết gì', () => {
  function shout(): CanonicalEvent {
    return event({ id: 'e1', type: 'npc_dialogue', source: 'npc_lucien', location: 'dining_room', content: 'Ai đó dưới hầm?!', volume: 'loud' })
  }

  it('event riêng tư không tới narrator và không tới bất kỳ actor nào', () => {
    const result = routeCanonicalEvents({
      events: [event({ id: 'e1', type: 'observation', source: 'npc_lucien', location: 'dining_room', content: 'Ta sẽ tóm lấy cổ hắn.', visibility: 'private' })],
      world: world(),
      definitions: ALL_ACTORS,
      turn: 1,
    })

    expect(result.privateEventIds).toEqual(['e1'])
    expect(result.publicLines).toEqual([])
    expect(result.entries).toEqual([])
    expect(JSON.stringify(result.perceptions)).not.toContain('tóm lấy cổ')
    // Không actor nào được đánh thức vì nó.
    const wake = selectAwakeActors({ action: { actor: 'player', type: 'speak', text: '', volume: 'normal' }, world: world(), definitions: ALL_ACTORS, perceptions: result.perceptions })
    expect(wake.awake).toEqual([])
  })

  it('mỗi actor nhận một mức khác nhau cho cùng một event', () => {
    const current = world()
    const result = routeCanonicalEvents({ events: [shout()], world: current, definitions: ALL_ACTORS, turn: 1 })
    const fidelity = (id: string): string => result.perceptions.entries[id]?.fidelity ?? 'missing'

    expect(fidelity('npc_lucien')).toBe('none') // không ai tri giác được chính hành vi của mình
    expect(fidelity('npc_butler')).toBe('muffled') // ngưỡng cửa bếp + nghe được âm thanh lớn từ phòng kề
    expect(fidelity('faction_knights')).toBe('none') // hầm không kề phòng ăn: không biết gì
    expect(fidelity('world_castle')).toBe('none') // không có scope nào nhận được lời nói
    expect(result.publicLines.join(' ')).not.toContain('Ai đó dưới hầm')

    // Cùng câu đó, hét trong bếp: hiệp sĩ dưới hầm nghe loáng thoáng nhưng không nhận nguyên văn.
    const inKitchen = event({ id: 'e2', type: 'npc_dialogue', source: 'npc_lucien', location: 'kitchen', content: 'Ai đó dưới hầm?!', volume: 'loud' })
    const nearby = routeCanonicalEvents({ events: [inKitchen], world: current, definitions: ALL_ACTORS, turn: 1 })
    const knights = nearby.perceptions.entries['faction_knights']
    expect(knights?.fidelity).toBe('muffled')
    expect(knights?.received).not.toContain('Ai đó dưới hầm')
    expect(knights?.received.startsWith('…')).toBe(true)
  })

  it('actor chỉ có adjacent_presence thì biết có chuyện nhưng không nhận nội dung', () => {
    const current = world()
    // Cất hết scope nghe lén của quản gia: chỉ còn nhận biết sự hiện diện ở phòng kề.
    const deaf: ActorDefinition = { ...ALL_ACTORS[1]!, perceive: ['same_room', 'adjacent_presence'] }
    const result = routeCanonicalEvents({
      events: [event({ id: 'e1', type: 'npc_dialogue', source: 'npc_lucien', location: 'dining_room', content: 'Ai đó dưới hầm?!', volume: 'normal' })],
      world: current,
      definitions: [deaf],
      turn: 1,
    })

    const entry = result.perceptions.entries['npc_butler']
    expect(entry?.fidelity).toBe('presence')
    expect(entry?.received).not.toContain('dưới hầm')
  })

  it('người chơi ở phòng kề nghe loáng thoáng, không bao giờ nhận nguyên văn', () => {
    const current = world()
    const player = playerPerception(shout(), current)
    expect(player.fidelity).toBe('muffled')
    expect(player.received).not.toBe('Ai đó dưới hầm?!')
    expect(player.received.startsWith('…')).toBe(true)
  })

  it('người chơi tự làm gì thì biết đủ', () => {
    const current = world()
    const mine = event({ id: 'e1', type: 'player_item', source: 'player', location: 'kitchen', visibility: 'private', item: { item: 'herbs', count: 1, from: 'player', to: 'pantry' } })
    expect(playerPerception(mine, current).fidelity).toBe('full')
  })

  it('sự thật mà người chơi không tri giác được thì bị giữ lại khỏi narrator, nhưng người trong phòng vẫn biết', () => {
    const current = world()
    current.player.location = 'dining_room'
    relocate(current, 'npc_lucien', 'basement')
    seal(current, 'basement')

    const hidden = event({ id: 'e1', type: 'npc_dialogue', source: 'npc_lucien', location: 'basement', content: 'Các ngươi ra đây.', volume: 'loud' })
    const result = routeCanonicalEvents({ events: [hidden], world: current, definitions: ALL_ACTORS, turn: 1 })

    expect(result.withheldEventIds).toEqual(['e1'])
    expect(result.publicEventIds).toEqual([])
    expect(result.publicLines.join(' ')).not.toContain('Các ngươi ra đây')
    // Hiệp sĩ cùng hầm vẫn nghe rõ: giữ lại khỏi người chơi không có nghĩa là không ai biết.
    expect(result.perceptions.entries['faction_knights']?.fidelity).toBe('full')
    expect(result.perceptions.entries['faction_knights']?.received).toBe('Các ngươi ra đây.')
  })

  it('actor không tri giác được thì không có entry, nên không bị đánh thức', () => {
    const current = world()
    relocate(current, 'npc_lucien', 'basement')
    seal(current, 'basement')

    // Lucien nói từ hầm đã niêm phong: quản gia ở ngưỡng cửa bếp không nghe được gì.
    const fromCellar = event({ id: 'e1', type: 'npc_dialogue', source: 'npc_lucien', location: 'basement', content: 'Các ngươi ra đây.', volume: 'loud' })
    const result = routeCanonicalEvents({ events: [fromCellar], world: current, definitions: ALL_ACTORS, turn: 1 })
    const wake = selectAwakeActors({
      action: { actor: 'player', type: 'speak', text: '', volume: 'normal' },
      world: current,
      definitions: ALL_ACTORS,
      perceptions: result.perceptions,
    })

    expect(result.perceptions.entries['npc_butler']?.fidelity).toBe('none')
    expect(wake.awake).not.toContain('npc_butler')
    expect(wake.awake).not.toContain('npc_lucien')
  })

  it('nhiều event trong một lượt được hợp nhất theo actor, giữ mức mạnh nhất', () => {
    const current = world()
    // Lucien đứng ở ngưỡng cửa bếp (cùng phòng với người chơi) và nói to.
    relocate(current, 'npc_lucien', 'kitchen_door')

    const result = routeCanonicalEvents({
      events: [
        event({ id: 'e1', type: 'npc_dialogue', source: 'npc_lucien', location: 'kitchen_door', content: 'Ngươi dám?', volume: 'whisper' }),
        event({ id: 'e2', type: 'npc_move', source: 'npc_lucien', location: 'kitchen_door', toLocation: 'dining_room' }),
      ],
      world: current,
      definitions: ALL_ACTORS,
      turn: 1,
    })

    const butler = result.perceptions.entries['npc_butler']
    expect(butler?.fidelity).toBe('full')
    expect(butler?.received).toContain('Ngươi dám?')
    expect(butler?.received).toContain('dining_room')
    expect(result.entries.filter(e => e.actorId === 'npc_butler')).toHaveLength(2)
  })

  it('không có event nào thì không ai được đánh thức, narrator không có gì để kể', () => {
    const result = routeCanonicalEvents({ events: [], world: world(), definitions: ALL_ACTORS, turn: 1 })
    expect(result.publicLines).toEqual([])
    expect(result.entries).toEqual([])
    expect(Object.values(result.perceptions.entries).every(entry => entry.fidelity === 'none')).toBe(true)
  })

  it('định tuyến tất định: cùng seed cho cùng kết quả', () => {
    const a = routeCanonicalEvents({ events: [shout()], world: world(), definitions: ALL_ACTORS, seed: 's', turn: 7 })
    const b = routeCanonicalEvents({ events: [shout()], world: world(), definitions: ALL_ACTORS, seed: 's', turn: 7 })
    expect(JSON.stringify(a.perceptions)).toBe(JSON.stringify(b.perceptions))
  })

  it('định nghĩa actor không có state không làm vỡ định tuyến', () => {
    const phantom: ActorDefinition = { ...ALL_ACTORS[0]!, id: 'npc_phantom' }
    const result = routeCanonicalEvents({ events: [shout()], world: world(), definitions: [...ALL_ACTORS, phantom], turn: 1 })
    expect(result.perceptions.entries['npc_phantom']?.fidelity).toBe('none')
  })
})
