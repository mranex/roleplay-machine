import { describe, expect, it } from 'vitest'
import { validateActorDefinition, validateCast, type ActorDefinition, type WorldState } from '../src/actor/model'
import { muffle, rawFidelity, routePlayerAction, type PlayerAction } from '../src/actor/perception'
import {
  IsolationError,
  assertIsolated,
  buildActorPayload,
  buildForbiddenList,
  parseActorOutput,
  renderActorPrompt,
} from '../src/actor/payload'
import { applyObservations, neverWoken, selectAwakeActors, triggerMatches } from '../src/actor/wake'
import {
  ALL_ACTORS,
  SECRET_FACTS,
  actorAction as action,
  butler,
  castle,
  knights,
  lucien,
  makeCastleWorld as world,
} from './fixtures/actors'

const ALL = ALL_ACTORS

function promptFor(world: WorldState, id: string, action: PlayerAction, seed = 'kiem-chung') {
  const definition = ALL.find(entry => entry.id === id) as ActorDefinition
  const perceptions = routePlayerAction(action, world, ALL, { seed, turn: world.turn })
  const payload = buildActorPayload({
    definition,
    state: world.actors[id] as NonNullable<WorldState['actors'][string]>,
    perception: perceptions.entries[id] as NonNullable<typeof perceptions.entries[string]>,
  })
  return { prompt: renderActorPrompt(payload), payload, perceptions }
}

function forbiddenFor(id: string, current: WorldState): string[] {
  return buildForbiddenList({ actorId: id, definitions: ALL, world: current, secretFacts: SECRET_FACTS })
}

describe('định nghĩa actor', () => {
  it('nhận định nghĩa hợp lệ và giữ đúng ranh giới kiến thức', () => {
    const result = validateActorDefinition(lucien())
    expect(result.issues).toEqual([])
    expect(result.definition?.allowedKnowledge).toHaveLength(5)
  })

  it('từ chối actor không biết gì hoặc không quan sát được gì', () => {
    const blank = validateActorDefinition({ ...lucien(), allowedKnowledge: [] })
    expect(blank.definition).toBeUndefined()
    expect(blank.issues.map(i => i.message).join(' ')).toMatch(/allowedKnowledge rỗng/)

    const blind = validateActorDefinition({ ...lucien(), perceive: [] })
    expect(blind.issues.map(i => i.message).join(' ')).toMatch(/perceive rỗng/)

    const badScope = validateActorDefinition({ ...lucien(), perceive: ['telepathy'] })
    expect(badScope.issues.map(i => i.message).join(' ')).toMatch(/perceive không hợp lệ/)
  })

  it('validateCast loại actor hỏng và id trùng, giữ phần còn lại', () => {
    const result = validateCast([lucien(), { ...butler(), id: 'npc_lucien' }, { id: 'x' }, knights()])
    expect(result.definitions.map(d => d.id)).toEqual(['npc_lucien', 'faction_knights'])
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('state khởi tạo KHÔNG copy allowedKnowledge — nó là hằng số của định nghĩa, không phải state', () => {
    const current = world()
    expect(current.actors['npc_lucien']?.memory).toEqual([])
    expect(JSON.stringify(current.actors['npc_lucien'])).not.toContain('năm trăm năm')
    expect(current.actors['npc_lucien']?.beliefs[0]?.claim).toBe('Tỏi là món ăn quê mùa.')
  })
})

describe('perception router', () => {
  it('cùng phòng thì thấy tận mắt', () => {
    const current = world()
    current.player.location = 'dining_room'
    expect(rawFidelity(lucien(), { location: 'dining_room' }, action(), 'dining_room', current)).toBe('full')
  })

  it('phòng kề + âm lượng thường thì không nghe thấy gì', () => {
    const current = world()
    expect(rawFidelity(lucien(), { location: 'dining_room' }, action(), 'kitchen', current)).toBe('none')
  })

  it('phòng kề + nói to thì nghe loáng thoáng', () => {
    const current = world()
    expect(rawFidelity(lucien(), { location: 'dining_room' }, action({ volume: 'loud' }), 'kitchen', current)).toBe('muffled')
  })

  it('được gọi tên thì nghe rõ dù khác phòng', () => {
    const current = world()
    expect(rawFidelity(lucien(), { location: 'dining_room' }, action({ targetActorId: 'npc_lucien' }), 'kitchen', current)).toBe('full')
  })

  it('thì thầm không xuyên phòng', () => {
    const current = world()
    expect(rawFidelity(lucien(), { location: 'dining_room' }, action({ volume: 'whisper' }), 'kitchen', current)).toBe('none')
  })

  it('cửa niêm phong chặn mọi thứ trừ cùng phòng', () => {
    const current = world()
    const sealedWorld: WorldState = {
      ...current,
      locations: { ...current.locations, kitchen: { ...(current.locations['kitchen'] as NonNullable<WorldState['locations'][string]>), sealed: true } },
    }
    expect(rawFidelity(lucien(), { location: 'dining_room' }, action({ volume: 'loud' }), 'kitchen', sealedWorld)).toBe('none')
    expect(rawFidelity(lucien(), { location: 'kitchen' }, action(), 'kitchen', sealedWorld)).toBe('full')
  })

  it('actor môi trường biết có chuyện xảy ra nhưng không nhận nội dung', () => {
    const current = world()
    // Nói trong phòng nó trông coi: biết là có chuyện (spec §8: "speech_occurred"), không có ngữ nghĩa.
    expect(rawFidelity(castle(), { location: 'kitchen' }, action(), 'kitchen', current)).toBe('presence')
    const map = routePlayerAction(action(), current, ALL, { seed: 's', turn: 1 })
    expect(map.entries['world_castle']?.received).not.toContain('tỏi')
    expect(map.entries['world_castle']?.informationLoss).toBe(1)
    expect(map.entries['world_castle']?.received).toMatch(/không nghe rõ nội dung/i)

    // Nói ở phòng khác thì hoàn toàn không biết.
    current.player.location = 'pantry'
    expect(rawFidelity(castle(), { location: 'kitchen' }, action(), 'pantry', current)).toBe('none')

    // Nhưng thay đổi vật lý ở bất kỳ đâu thì cảm nhận được.
    expect(rawFidelity(castle(), { location: 'kitchen' }, action({ type: 'item_transfer' }), 'pantry', current)).toBe('presence')
  })

  it('mất mát thông tin tất định theo seed, và cắt bớt nội dung', () => {
    const text = 'trong năm trăm năm ngủ say tỏi đã trở thành biểu tượng của giới quý tộc hiện đại'
    const a = muffle(text, 0.35, (() => { let i = 0; const state = world(); void state; return () => (i++ % 7) / 7 })())
    const b = muffle(text, 0.35, (() => { let i = 0; return () => (i++ % 7) / 7 })())
    expect(a).toBe(b)
    expect(a).not.toBe(text)
    expect(a.startsWith('…')).toBe(true)
  })

  it('mỗi actor nhận một phiên bản thực tại KHÁC NHAU', () => {
    const current = world()
    current.player.location = 'kitchen'
    const map = routePlayerAction(action({ volume: 'loud' }), current, ALL, { seed: 's', turn: 1 })
    expect(map.entries['world_castle']?.fidelity).toBe('presence')
    expect(map.entries['npc_butler']?.fidelity).toBe('full')
    expect(map.entries['faction_knights']?.fidelity).toBe('muffled')
    expect(map.entries['npc_lucien']?.fidelity).toBe('muffled')
    expect(map.entries['faction_knights']?.received).not.toBe(action().text)
  })
})

describe('§28-Test 1 — cô lập thông tin', () => {
  it('Lucien không hề biết có hiệp sĩ, kể cả khi được đánh thức', () => {
    const current = world()
    const { prompt } = promptFor(current, 'npc_lucien', action({ volume: 'loud' }))
    expect(prompt).not.toMatch(/hiệp sĩ/i)
    expect(prompt).not.toContain('Lucien là ma cà rồng.')
    expect(() => assertIsolated(prompt, forbiddenFor('npc_lucien', current))).not.toThrow()
  })

  it('hỏi gián tiếp về hiệp sĩ khi Lucien ở phòng khác thì hắn không được đánh thức', () => {
    const current = world()
    const ask = action({ text: 'Ngài có biết dưới hầm lâu đài có gì không?' })
    const perceptions = routePlayerAction(ask, current, ALL, { seed: 's', turn: 1 })
    const wake = selectAwakeActors({ action: ask, world: current, definitions: ALL, perceptions })
    expect(wake.awake).not.toContain('npc_lucien')
    const after = applyObservations(current, wake.decisions, 1)
    expect(after.actors['npc_lucien']?.memory).toEqual([])
  })

  it('chốt chặn có răng: nhét bí mật vào prompt là ném lỗi ngay', () => {
    const current = world()
    const { prompt } = promptFor(current, 'npc_lucien', action({ volume: 'loud' }))
    const poisoned = `${prompt}\n- ${SECRET_FACTS[2]}`
    expect(() => assertIsolated(poisoned, forbiddenFor('npc_lucien', current))).toThrow(IsolationError)
  })

  it('mỗi actor chỉ thấy kiến thức của chính mình', () => {
    const current = world()
    for (const definition of ALL) {
      const { prompt } = promptFor(current, definition.id, action({ volume: 'loud', targetActorId: definition.id }))
      for (const line of definition.allowedKnowledge) expect(prompt).toContain(line)
      expect(() => assertIsolated(prompt, forbiddenFor(definition.id, current))).not.toThrow()
    }
  })

  it('prompt khai thẳng actor_id để model không tự chế id', () => {
    const current = world()
    for (const definition of ALL) {
      const { prompt } = promptFor(current, definition.id, action({ volume: 'loud' }))
      expect(prompt).toContain(`actor_id: ${definition.id}`)
    }
  })
})

describe('§28-Test 2 — ký ức riêng', () => {
  it('ai nghe thì nhớ, ai không nghe thì không', () => {
    const current = world()
    const claim = action({ text: 'Tỏi đã thành mốt của giới quý tộc.', volume: 'normal' })
    const perceptions = routePlayerAction(claim, current, ALL, { seed: 's', turn: 1 })
    const wake = selectAwakeActors({ action: claim, world: current, definitions: ALL, perceptions })
    const after = applyObservations(current, wake.decisions, 1)

    // Quản gia đứng ở kitchen_door nên cùng phòng → nhớ.
    expect(after.actors['npc_butler']?.memory.map(m => m.text).join(' ')).toContain('Tỏi đã thành mốt')
    // Lucien ở phòng ăn, âm lượng thường → không nghe, không nhớ.
    expect(after.actors['npc_lucien']?.memory).toEqual([])
  })

  it('năm lượt sau Lucien vẫn nhớ claim nếu hắn đã nghe', () => {
    let current = world()
    const claim = action({ text: 'Tỏi đã thành mốt của giới quý tộc.', targetActorId: 'npc_lucien' })
    const perceptions = routePlayerAction(claim, current, ALL, { seed: 's', turn: 1 })
    current = applyObservations(current, selectAwakeActors({ action: claim, world: current, definitions: ALL, perceptions }).decisions, 1)

    for (let turn = 2; turn <= 6; turn++) {
      current.turn = turn
      const idle = action({ type: 'observe', text: 'Người chơi đứng yên quan sát.', volume: 'whisper' })
      const map = routePlayerAction(idle, current, ALL, { seed: 's', turn })
      current = applyObservations(current, selectAwakeActors({ action: idle, world: current, definitions: ALL, perceptions: map }).decisions, turn)
    }

    const { prompt } = promptFor(current, 'npc_lucien', action({ volume: 'whisper' }), 's')
    expect(prompt).toContain('Tỏi đã thành mốt của giới quý tộc.')
  })
})

describe('§28-Test 3 — hành động bí mật', () => {
  it('lấy tỏi khi chỉ có một mình: không ai ngoài lâu đài biết', () => {
    const current = world()
    current.player.location = 'pantry'
    const steal = action({ type: 'item_transfer', item: 'garlic', text: 'Tôi giấu ba tép tỏi vào trong áo.', volume: 'whisper' })
    const perceptions = routePlayerAction(steal, current, ALL, { seed: 's', turn: 1 })

    expect(perceptions.entries['npc_lucien']?.fidelity).toBe('none')
    expect(perceptions.entries['npc_butler']?.fidelity).toBe('none')
    expect(perceptions.entries['faction_knights']?.fidelity).toBe('none')
    expect(perceptions.entries['world_castle']?.fidelity).toBe('presence')

    const wake = selectAwakeActors({ action: steal, world: current, definitions: ALL, perceptions })
    expect(wake.awake).toEqual(['world_castle'])
    const after = applyObservations(current, wake.decisions, 1)
    expect(after.actors['npc_lucien']?.memory).toEqual([])

    // Sau đó người chơi gặp Lucien: hắn vẫn không biết có tỏi.
    after.player.location = 'dining_room'
    const { prompt } = promptFor(after, 'npc_lucien', action({ text: 'Ngài chắc chắn không muốn ăn tỏi chứ?', targetActorId: 'npc_lucien' }))
    expect(prompt).not.toMatch(/ba tép tỏi/i)
    expect(prompt).not.toContain('Tôi giấu ba tép tỏi vào trong áo.')
  })
})

describe('§28-Test 4 — belief được phép sai', () => {
  it('canonical nói tỏi, quản gia tin hành, và không ai tự sửa nó', () => {
    const current = world()
    current.player.inventory.push('garlic')
    current.actors['npc_butler']?.beliefs.push({ claim: 'Người chơi lấy hành trong kho.', confidence: 0.6, source: 'perception', turn: 1 })

    const idle = action({ type: 'observe', text: 'Không có gì đáng chú ý.', volume: 'whisper' })
    const perceptions = routePlayerAction(idle, current, ALL, { seed: 's', turn: 2 })
    const after = applyObservations(current, selectAwakeActors({ action: idle, world: current, definitions: ALL, perceptions }).decisions, 2)

    expect(after.player.inventory).toContain('garlic')
    const beliefs = after.actors['npc_butler']?.beliefs.map(b => b.claim).join(' ') ?? ''
    expect(beliefs).toContain('hành')
    expect(beliefs).not.toContain('tỏi')
  })

  it('actor nói dối được: điều nó nói và điều nó tin là hai chuyện', () => {
    const parsed = parseActorOutput({
      actor_id: 'npc_butler',
      interpretation: 'Đầu bếp đang giấu điều gì đó.',
      emotion: 'nghi ngờ',
      intent_type: 'dialogue',
      intent_content: 'Ta hoàn toàn tin tưởng ngươi.',
    }, 'npc_butler')
    expect(parsed.output?.intent.content).toBe('Ta hoàn toàn tin tưởng ngươi.')
    expect(parsed.output?.interpretation).toContain('giấu điều gì đó')
  })
})

describe('§28-Test 5 — phản ứng song song', () => {
  it('một hành động đánh thức nhiều actor với mức quan sát khác nhau', () => {
    const current = world()
    const loud = action({ volume: 'loud' })
    const perceptions = routePlayerAction(loud, current, ALL, { seed: 's', turn: 1 })
    const wake = selectAwakeActors({ action: loud, world: current, definitions: ALL, perceptions })

    expect(wake.awake).toContain('npc_butler')
    expect(wake.awake).toContain('npc_lucien')
    expect(wake.awake).toContain('faction_knights')
    const losses = wake.awake.map(id => perceptions.entries[id]?.informationLoss)
    expect(new Set(losses).size).toBeGreaterThan(1)
    const reasons = wake.decisions.filter(d => d.wake).map(d => d.reason)
    expect(reasons.join(' ')).toMatch(/trực tiếp chứng kiến|nghe loáng thoáng/)
  })

  it('trần đánh thức chặn chi phí model mỗi lượt', () => {
    const current = world()
    const loud = action({ volume: 'loud' })
    const perceptions = routePlayerAction(loud, current, ALL, { seed: 's', turn: 1 })
    const wake = selectAwakeActors({ action: loud, world: current, definitions: ALL, perceptions, maxAwake: 2 })
    expect(wake.awake).toHaveLength(2)
    expect(wake.decisions.filter(d => d.reason.includes('vượt trần')).length).toBeGreaterThan(0)
  })
})

describe('§28-Test 6 — ý định không phải canon', () => {
  it('actor muốn giết người chơi cũng không đổi được world state', () => {
    const current = world()
    const before = JSON.stringify(current)
    const parsed = parseActorOutput({
      actor_id: 'npc_lucien',
      interpretation: 'Người đầu bếp vừa xúc phạm ta.',
      emotion: 'phẫn nộ',
      intent_type: 'attack',
      intent_target: 'player',
      intent_content: 'Ta sẽ tóm lấy cổ hắn.',
    }, 'npc_lucien')
    expect(parsed.output?.intent.type).toBe('attack')
    expect(JSON.stringify(current)).toBe(before)
  })

  it('output hỏng bị hạ cấp an toàn, không ném lỗi', () => {
    const parsed = parseActorOutput({ actor_id: 'npc_lucien', intent_type: 'xuyên không' }, 'npc_lucien')
    expect(parsed.output?.intent.type).toBe('wait')
    expect(parsed.issues.length).toBeGreaterThan(0)
    expect(parseActorOutput('không phải json', 'npc_lucien').output).toBeUndefined()
  })

  it('belief và plan của actor được đọc ra để Resolver xét, chứ không tự áp vào state', () => {
    const parsed = parseActorOutput({
      actor_id: 'npc_butler',
      interpretation: 'Đầu bếp chủ động chạm vào nỗi bất an của Lucien.',
      emotion: 'cảnh giác',
      intent_type: 'inspect',
      intent_target: 'player',
      intent_content: '',
      belief_claims: [{ claim: 'Đầu bếp đang toan tính.', confidence: 0.8 }],
      plan_goal: 'lục phòng người chơi',
      plan_trigger: 'player_leaves_kitchen',
    }, 'npc_butler')
    expect(parsed.output?.beliefClaims[0]?.confidence).toBe(0.8)
    expect(parsed.output?.plan?.trigger).toBe('player_leaves_kitchen')
  })
})

describe('§28-Test 7 — actor ngủ không tốn gì', () => {
  it('actor ngoài tầm không bị gọi, không nhận ký ức, không tăng lượt thức', () => {
    const current = world()
    const quiet = action({ text: 'Tôi lật trang sách.', volume: 'whisper' })
    const perceptions = routePlayerAction(quiet, current, ALL, { seed: 's', turn: 1 })
    const wake = selectAwakeActors({ action: quiet, world: current, definitions: ALL, perceptions })
    const after = applyObservations(current, wake.decisions, 1)

    expect(wake.awake).not.toContain('npc_lucien')
    expect(wake.awake).not.toContain('faction_knights')
    expect(after.actors['npc_lucien']?.awakeTurns).toEqual([])
    expect(after.actors['npc_lucien']?.memory).toEqual([])
    const sleepingDecision = wake.decisions.find(d => d.actorId === 'npc_lucien')
    expect(sleepingDecision?.received).toBe('')
  })

  it('đếm được actor chưa từng thức trong ván', () => {
    const current = world()
    expect(neverWoken(current)).toEqual(['faction_knights', 'npc_butler', 'npc_lucien', 'world_castle'])
  })

  it('kế hoạch chờ sẵn đánh thức actor dù nó không quan sát trực tiếp', () => {
    const current = world()
    // Đẩy quản gia sang phòng ăn để nó KHÔNG quan sát trực tiếp được lượt này.
    const butlerState = current.actors['npc_butler'] as NonNullable<WorldState['actors'][string]>
    ;(butlerState as { location: string }).location = 'dining_room'
    butlerState.plans.push({ goal: 'lục phòng người chơi', trigger: 'player_leaves_kitchen', createdTurn: 0 })

    const leave = action({ type: 'move', toLocation: 'pantry', text: 'Tôi rời bếp đi lấy đồ.', volume: 'whisper' })
    const perceptions = routePlayerAction(leave, current, ALL, { seed: 's', turn: 2 })
    expect(perceptions.entries['npc_butler']?.fidelity).toBe('none')

    const wake = selectAwakeActors({ action: leave, world: current, definitions: ALL, perceptions })
    const decision = wake.decisions.find(d => d.actorId === 'npc_butler')
    expect(decision?.wake).toBe(true)
    expect(decision?.reason).toMatch(/kế hoạch tới hạn/)
    // Đánh thức vì kế hoạch thì KHÔNG kèm dữ liệu thế giới nào.
    expect(decision?.received).toContain('lục phòng người chơi')
    expect(decision?.received).not.toContain('pantry')

    const after = applyObservations(current, wake.decisions, 2)
    expect(after.actors['npc_butler']?.awakeTurns).toEqual([2])
    expect(triggerMatches('player_leaves_kitchen', leave, current)).toBe(true)
  })
})

describe('§28-Test 8 — không rò rỉ bí mật', () => {
  it('prompt của mọi actor đều sạch bí mật và sạch dữ liệu actor khác', () => {
    const current = world()
    const loud = action({ volume: 'loud' })
    for (const definition of ALL) {
      const { prompt } = promptFor(current, definition.id, loud)
      for (const fact of SECRET_FACTS) expect(prompt).not.toContain(fact)
      expect(() => assertIsolated(prompt, forbiddenFor(definition.id, current))).not.toThrow()
    }
  })

  it('narrator chỉ cần dữ liệu công khai: không có bí mật nào trong danh sách cấm bị lọt vào prompt actor', () => {
    const current = world()
    const forbidden = forbiddenFor('world_castle', current)
    expect(forbidden).toContain(SECRET_FACTS[2])
    expect(forbidden).toContain('Lucien là ma cà rồng.')
  })
})
