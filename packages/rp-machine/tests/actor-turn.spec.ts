import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ALL_ACTORS,
  SECRET_FACTS,
  actorAction,
  makeCastleLocations,
  makeCastleWorld,
  relocate,
  seal,
} from './fixtures/actors'
import type { ActorDefinition, WorldState } from '../src/actor/model'
import type { ActorOutput } from '../src/actor/payload'
import { parseActorSetup, setupIsUsable } from '../src/actor/setup'
import {
  ActorWiringError,
  createScriptedActorRunner,
  createSpawnActorRunner,
  extractJson,
  inspectActorProvider,
  type ActorRunInput,
  type SubagentRuntimeLike,
  type SubagentStartRequestLike,
} from '../src/actor/session'
import {
  ACTOR_SNAPSHOT_VERSION,
  buildActorReport,
  loadActorSnapshot,
  renderActorGmText,
  runActorTurn,
  saveActorSnapshot,
} from '../src/actor/turn'

/**
 * M3 — adapter subagent và pipeline một lượt.
 *
 * Ba nhóm test:
 *  1. chốt chặn cấu hình: provider không bảo đảm cô lập thì phải TỪ CHỐI chạy, không chạy nửa vời
 *  2. pipeline một lượt, chạy bằng runner giả nên không tốn model call
 *  3. cô lập thông tin end-to-end: soi thẳng mọi prompt thực sự được gửi
 */

const TEMP_DIRS: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-actor-'))
  TEMP_DIRS.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function output(actorId: string, over: Partial<ActorOutput> = {}): ActorOutput {
  return {
    actorId,
    interpretation: 'có chuyện gì đó vừa xảy ra',
    emotion: 'điềm tĩnh',
    intent: { type: 'wait', content: 'đứng yên' },
    beliefClaims: [],
    ...over,
  }
}

function speak(actorId: string, content: string, over: Partial<ActorOutput> = {}): ActorOutput {
  return output(actorId, { intent: { type: 'dialogue', content }, ...over })
}

describe('parseActorSetup — kiểm khai báo trước khi dựng thế giới', () => {
  const cast = [
    {
      id: 'npc_lucien',
      kind: 'npc',
      name: 'Lucien',
      role: 'ma cà rồng',
      location: 'dining_room',
      allowedKnowledge: ['Lâu đài này là của ta.'],
      perceive: ['same_room'],
      traits: { hunger: 3 },
    },
  ]

  it('dựng được world từ khai báo hợp lệ', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast,
      locations: { kitchen: { adjacent: ['dining_room'] }, dining_room: { adjacent: ['kitchen'] } },
      playerLocation: 'kitchen',
      playerInventory: ['dao'],
    })
    expect(setupIsUsable(setup)).toBe(true)
    expect(setup.cast).toHaveLength(1)
    expect(setup.world.actors['npc_lucien']?.traits).toEqual({ hunger: 3 })
    expect(setup.world.player.inventory).toEqual(['dao'])
  })

  it('từ chối bản đồ rỗng', () => {
    const setup = parseActorSetup({ sceneId: 's1', cast, locations: {} })
    expect(setupIsUsable(setup)).toBe(false)
    expect(setup.issues.map(i => i.where)).toContain('locations')
  })

  it('báo khi actor đứng ở địa điểm không có trong bản đồ', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast: [{ ...cast[0], location: 'hầm_bí_mật' }],
      locations: { kitchen: { adjacent: [] } },
    })
    expect(setup.issues.map(i => i.message).join(' ')).toMatch(/địa điểm không tồn tại/)
    expect(setupIsUsable(setup)).toBe(false)
  })

  it('báo khi quan hệ kề thiếu chiều ngược lại', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast,
      locations: { kitchen: { adjacent: ['dining_room'] }, dining_room: { adjacent: [] } },
    })
    expect(setup.issues.map(i => i.message).join(' ')).toMatch(/thiếu chiều kề ngược lại/)
  })

  it('báo khi kề với địa điểm không tồn tại, và khi tự kề chính mình', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast,
      locations: { kitchen: { adjacent: ['kitchen', 'phòng_không_có'] }, dining_room: { adjacent: [] } },
    })
    const text = setup.issues.map(i => i.message).join(' ')
    expect(text).toMatch(/tự kề chính mình/)
    expect(text).toMatch(/kề với địa điểm không tồn tại/)
  })

  it('playerLocation sai thì rơi về địa điểm đầu và báo rõ', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast,
      locations: { kitchen: { adjacent: ['dining_room'] }, dining_room: { adjacent: [] } },
      playerLocation: 'nơi_không_tồn_tại',
    })
    expect(setup.playerLocation).toBe('kitchen')
    expect(setup.issues.map(i => `${i.where}: ${i.message}`).join(' ')).toMatch(/playerLocation/)
  })

  it('sameRoomAs trỏ sai bị bỏ và báo', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast,
      locations: {
        kitchen: { adjacent: ['dining_room'] },
        dining_room: { adjacent: [] },
        kitchen_door: { adjacent: [], sameRoomAs: 'phòng_không_có' },
      },
    })
    expect(setup.locations['kitchen_door']?.sameRoomAs).toBeUndefined()
    expect(setup.issues.map(i => i.message).join(' ')).toMatch(/sameRoomAs/)
  })

  it('điều kiện kết thúc hỏng bị báo qua issues', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast,
      locations: { kitchen: { adjacent: [] } },
      endConditions: [{ id: '', outcome: 'won', allOf: [] }],
    })
    expect(setup.issues.map(i => i.message).join(' ')).toMatch(/thiếu id/)
    expect(setup.endConditions).toHaveLength(1)
  })

  it('sealed và sameRoomAs hợp lệ được giữ nguyên', () => {
    const setup = parseActorSetup({
      sceneId: 's1',
      cast,
      locations: {
        kitchen: { adjacent: ['dining_room'], sealed: true },
        dining_room: { adjacent: ['kitchen'] },
        kitchen_door: { adjacent: ['kitchen'], sameRoomAs: 'kitchen' },
      },
    })
    expect(setup.locations['kitchen']?.sealed).toBe(true)
    expect(setup.locations['kitchen_door']?.sameRoomAs).toBe('kitchen')
  })
})

describe('chốt chặn provider — không bảo đảm cô lập thì không chạy', () => {
  function runtime(over: Partial<Parameters<typeof runtimeProvider>[0]> = {}): SubagentRuntimeLike {
    return runtimeProvider(over)
  }

  it('provider `spawn` hợp lệ', () => {
    const result = inspectActorProvider(runtime(), 'spawn')
    expect(result.provider?.name).toBe('spawn')
    expect(result.warnings).toEqual([])
  })

  it('provider kế thừa ngữ cảnh cha bị từ chối (đây là đường rò rỉ toàn bộ ván)', () => {
    expect(() => inspectActorProvider(runtime({ inheritsParentContext: true }), 'fork')).toThrow(ActorWiringError)
    expect(() => inspectActorProvider(runtime({ inheritsParentContext: true }), 'fork')).toThrow(/kế thừa ngữ cảnh cha/)
  })

  it('provider thiếu toolFilter bị từ chối (không xoá được tool thì không cô lập được)', () => {
    expect(() => inspectActorProvider(runtime({ toolFilter: false }), 'spawn')).toThrow(/toolFilter/)
  })

  it('thiếu service subagents thì báo rõ, không im lặng', () => {
    expect(() => inspectActorProvider(undefined, 'spawn')).toThrow(/subagents/)
  })

  it('thiếu outputSchema/persona chỉ là cảnh báo, không chặn', () => {
    const result = inspectActorProvider(runtime({ outputSchema: false, persona: false }), 'spawn')
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.join(' ')).toMatch(/outputSchema/)
    expect(result.warnings.join(' ')).toMatch(/persona/)
  })
})

describe('createSpawnActorRunner — yêu cầu gửi đi đúng và đủ chặt', () => {
  it('luôn gửi toolFilter allow rỗng, provider spawn, kèm persona và schema', async () => {
    const seen: SubagentStartRequestLike[] = []
    let disposed = 0
    const runner = createSpawnActorRunner({
      subagents: {
        getProvider: () => provider({ inheritsParentContext: false }),
        start: async (_name, request) => {
          seen.push(request)
          return { result: Promise.resolve({ structured: { actor_id: 'npc_lucien', interpretation: 'a', emotion: 'b', intent_type: 'dialogue', intent_content: 'c' } }), dispose: async () => { disposed++ } }
        },
      },
      parent: { id: 'parent' },
    })

    const result = await runner.run(runInput())
    expect(result.output?.intent.type).toBe('dialogue')
    expect(seen[0]?.toolFilter).toEqual({ allow: [] })
    expect(seen[0]?.outputSchema).toBeDefined()
    expect(seen[0]?.persona).toContain('Lucien')
    expect(seen[0]?.label).toBe('actor:npc_lucien')
    expect(seen[0]?.prompt).toHaveLength(1)
    expect(disposed).toBe(1)
  })

  it('chốt chặn cô lập ném lỗi TRƯỚC khi gọi model', async () => {
    let started = 0
    const runner = createSpawnActorRunner({
      subagents: { getProvider: () => provider({}), start: async () => { started++; return { result: Promise.resolve({}), dispose: async () => {} } } },
    })
    const bad = { ...runInput(), prompt: 'prompt có bí mật: Có một nhóm hiệp sĩ đang trốn dưới hầm lâu đài.', forbidden: ['Có một nhóm hiệp sĩ đang trốn dưới hầm lâu đài.'] }
    await expect(runner.run(bad)).rejects.toThrow(/bị cấm/)
    expect(started).toBe(0)
  })

  it('đọc được output từ text thô khi provider không hỗ trợ schema', async () => {
    const runner = createSpawnActorRunner({
      subagents: {
        getProvider: () => provider({ outputSchema: false }),
        start: async () => ({
          result: Promise.resolve({ output: [{ type: 'text', text: 'Đây là kết quả:\n{"actor_id":"npc_lucien","interpretation":"i","emotion":"e","intent_type":"dialogue","intent_content":"nói"}' }] }),
          dispose: async () => {},
        }),
      },
    })
    const result = await runner.run(runInput())
    expect(result.output?.intent.content).toBe('nói')
    expect(result.issues.join(' ')).toMatch(/outputSchema/)
  })

  it('output rác bị hạ cấp về wait, không ném', async () => {
    const runner = createSpawnActorRunner({
      subagents: { getProvider: () => provider({}), start: async () => ({ result: Promise.resolve({ structured: 'không phải object' }), dispose: async () => {} }) },
    })
    const result = await runner.run(runInput())
    expect(result.output).toBeUndefined()
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('actor kết thúc bất thường được ghi vào issues, không làm hỏng lượt', async () => {
    const runner = createSpawnActorRunner({
      subagents: { getProvider: () => provider({}), start: async () => ({ result: Promise.resolve({ stopReason: 'max-tokens', diagnostic: 'hết token' }), dispose: async () => {} }) },
    })
    const result = await runner.run(runInput())
    expect(result.issues.join(' ')).toMatch(/max-tokens/)
  })

  it('provider đổi sang fork thì runner từ chối trước khi gửi', async () => {
    const runner = createSpawnActorRunner({
      subagents: {
        getProvider: () => provider({ inheritsParentContext: true }),
        start: async () => {
          throw new Error('không được gọi tới đây')
        },
      },
    })
    await expect(runner.run(runInput())).rejects.toThrow(ActorWiringError)
  })

  it('extractJson lấy object giữa text và chịu được rác', () => {
    expect(extractJson('abc {"a":1} xyz')).toEqual({ a: 1 })
    expect(extractJson('không có gì')).toBeUndefined()
    expect(extractJson('{ hỏng')).toBeUndefined()
  })
})

describe('runActorTurn — một lượt đầy đủ, không tốn model call', () => {
  it('lời nói của NPC thành sự thật công khai, và người cùng phòng nhận nguyên văn', async () => {
    const world = makeCastleWorld()
    // Quản gia sang phòng ăn: cùng phòng với Lucien, nên sẽ nghe nguyên văn.
    ;(world.actors['npc_butler'] as { location: string }).location = 'dining_room'
    const captured: ActorRunInput[] = []
    const runner = createScriptedActorRunner(
      { npc_lucien: speak('npc_lucien', 'Ai đó dưới hầm?!') },
      { onRun: input => captured.push(input) },
    )

    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1, secretFacts: SECRET_FACTS },
      { runner, force: ['npc_lucien'], maxAwake: 1, seed: 's' },
    )

    expect(result.awake).toEqual(['npc_lucien'])
    expect(captured).toHaveLength(1)
    expect(result.committed).toHaveLength(1)
    expect(result.committed[0]?.type).toBe('npc_dialogue')
    expect(result.committed[0]?.visibility).toBe('public')

    // Quản gia cùng phòng nghe rõ nhưng không được gọi model ở lượt này, nên nó được xếp vào tri giác
    // còn nợ cho lượt sau.
    expect(result.pending.entries['npc_butler']?.fidelity).toBe('full')
    expect(result.pending.entries['npc_butler']?.received).toBe('Ai đó dưới hầm?!')
  })

  it('ý định tấn công không đổi được world: chỉ thành observation riêng tư', async () => {
    const world = makeCastleWorld()
    const runner = createScriptedActorRunner({
      npc_lucien: output('npc_lucien', { intent: { type: 'attack', target: 'player', content: 'Ta tóm lấy cổ hắn.' } }),
    })

    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1 },
      { runner, force: ['npc_lucien'], seed: 's' },
    )

    expect(result.committed[0]?.type).toBe('observation')
    expect(result.broadcast.privateEventIds).toEqual(['evt_1_npc_lucien_intent'])
    expect(result.publicLines.join(' ')).not.toContain('tóm lấy cổ')
    expect(result.world.player.inventory).toEqual(world.player.inventory)
    // Lucien có nghe thấy người chơi nói (đó là ký ức hợp lệ), nhưng KHÔNG trait nào, KHÔNG kế hoạch nào
    // và KHÔNG niềm tin nào mới: ý định tấn công không tự áp vào thế giới.
    const before = world.actors['npc_lucien'] as NonNullable<WorldState['actors'][string]>
    const after = result.world.actors['npc_lucien'] as NonNullable<WorldState['actors'][string]>
    expect(after.traits).toEqual(before.traits)
    expect(after.beliefs).toEqual(before.beliefs)
    expect(after.plans).toEqual([])
    expect(after.location).toBe(before.location)
  })

  it('event hỏng bị Resolver từ chối và đi vào issues, không âm thầm bỏ qua', async () => {
    const world = makeCastleWorld()
    // Thoại dài quá trần DIALOGUE_MAX: model có thể trả cả một chương, Resolver phải chặn.
    const runner = createScriptedActorRunner({ npc_lucien: speak('npc_lucien', 'x'.repeat(900)) })

    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1 },
      { runner, force: ['npc_lucien'], seed: 's' },
    )

    expect(result.proposed).toHaveLength(1)
    expect(result.committed).toEqual([])
    expect(result.rejected).toHaveLength(1)
    expect(result.issues.map(issue => issue.message).join(' ')).toMatch(/vượt 600 ký tự/)
    expect(result.publicLines).toEqual([])
  })

  it('trần maxAwake chặn chi phí model mỗi lượt', async () => {
    const world = makeCastleWorld()
    let calls = 0
    const runner = createScriptedActorRunner(
      { npc_lucien: speak('npc_lucien', 'a'), npc_butler: speak('npc_butler', 'b'), world_castle: speak('world_castle', 'c') },
      { onRun: () => { calls++ } },
    )
    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1 },
      { runner, maxAwake: 2, seed: 's' },
    )
    expect(calls).toBe(2)
    expect(result.awake).toHaveLength(2)
    expect(result.decisions.some(decision => decision.reason.includes('vượt trần'))).toBe(true)
  })

  it('tri giác còn nợ: actor ngủ mà nghe được sự thật thì được đánh thức ở lượt sau', async () => {
    let world: WorldState = makeCastleWorld()
    // Đưa quản gia sang phòng ăn: nó không nghe được lời thì thầm của người chơi ở bếp.
    ;(world.actors['npc_butler'] as { location: string }).location = 'dining_room'

    const prompts: Record<string, string> = {}
    const runner = createScriptedActorRunner(
      {
        npc_lucien: speak('npc_lucien', 'Ta ngửi thấy mùi lạ!'),
        npc_butler: input => {
          prompts['butler'] = input.prompt
          return speak('npc_butler', 'Thưa ngài, có kẻ lạ.')
        },
      },
      { onRun: input => { prompts[input.definition.id === 'npc_butler' ? 'butler' : input.definition.id] = input.prompt } },
    )

    // Lượt 1: người chơi chỉ thì thầm quan sát; Lucien bị đánh thức bắt buộc và nói to.
    const first = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ type: 'observe', text: 'Tôi đứng yên.', volume: 'whisper' }), turn: 1 },
      { runner, force: ['npc_lucien'], seed: 's' },
    )
    expect(first.awake).not.toContain('npc_butler')
    expect(first.pending.entries['npc_butler']?.fidelity).toBe('full')
    expect(first.pending.entries['npc_butler']?.received).toContain('mùi lạ')

    // Lượt 2: người chơi vẫn không làm gì đáng chú ý, nhưng quản gia phản ứng với điều nó đã nghe.
    const second = await runActorTurn(
      { world: first.world, definitions: ALL_ACTORS, action: actorAction({ type: 'observe', text: 'Tôi đứng yên.', volume: 'whisper' }), turn: 2, pending: first.pending },
      { runner, seed: 's' },
    )
    expect(second.awake).toContain('npc_butler')
    expect(prompts['butler']).toContain('mùi lạ')
  })

  it('actor đã thức thì không nhận lại cùng thông tin ở lượt sau (chặn vòng lặp NPC vô tận)', async () => {
    const world = makeCastleWorld()
    const runner = createScriptedActorRunner(
      { npc_lucien: speak('npc_lucien', 'Ai đó?'), npc_butler: speak('npc_butler', 'Dạ?'), world_castle: speak('world_castle', 'ầm') },
      {},
    )
    const first = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1 },
      { runner, force: ['npc_lucien'], seed: 's' },
    )
    for (const actorId of first.awake) {
      expect(first.pending.entries[actorId]).toBeUndefined()
    }
  })

  it('điều kiện kết thúc do code quyết', async () => {
    const world = makeCastleWorld()
    world.actors['npc_lucien']!.traits['garlic_consumed'] = 3
    world.player.inventory.push('garlic', 'garlic', 'garlic')
    const runner = createScriptedActorRunner({})

    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'whisper', type: 'observe' }), turn: 1 },
      {
        runner,
        seed: 's',
        endConditions: [
          { id: 'end_win', outcome: 'won', allOf: [{ kind: 'inventory', item: 'garlic', count: 3 }, { kind: 'trait', actor: 'npc_lucien', key: 'garlic_consumed', op: '>=', value: 3 }] },
        ],
      },
    )
    expect(result.ended?.id).toBe('end_win')
    expect(result.ended?.outcome).toBe('won')
  })

  it('runner ném lỗi thì cả lượt vẫn đi tiếp và ghi lại lỗi', async () => {
    const runner = { run: async () => { throw new Error('model chết') } }
    const result = await runActorTurn(
      { world: makeCastleWorld(), definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1 },
      { runner, force: ['npc_lucien'], seed: 's' },
    )
    expect(result.outputs).toEqual([])
    expect(result.issues.map(issue => issue.message).join(' ')).toMatch(/model chết/)
    expect(result.committed).toEqual([])
  })
})

describe('hành động vật lý của người chơi — người chơi không phải model', () => {
  const quiet = actorAction({ type: 'move', text: 'Tôi đi sang bếp.', volume: 'normal' })

  it('người chơi khai di chuyển thì thế giới đổi thật', async () => {
    const world = makeCastleWorld()
    world.player.location = 'pantry'
    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ type: 'move', toLocation: 'kitchen', text: 'Tôi quay lại bếp.' }), turn: 1 },
      { runner: createScriptedActorRunner({}), seed: 's' },
    )

    expect(result.committed[0]?.type).toBe('player_move')
    expect(result.world.player.location).toBe('kitchen')
    expect(result.rejected).toEqual([])
  })

  it('di chuyển sang phòng không kề bị từ chối, người chơi đứng nguyên', async () => {
    const world = makeCastleWorld()
    world.player.location = 'pantry'
    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ type: 'move', toLocation: 'dining_room', text: 'Tôi bước sang phòng ăn.' }), turn: 1 },
      { runner: createScriptedActorRunner({}), seed: 's' },
    )

    expect(result.committed).toEqual([])
    expect(result.world.player.location).toBe('pantry')
    expect(result.issues.map(issue => issue.message).join(' ')).toMatch(/không kề/)
  })

  it('di chuyển xuyên cửa niêm phong bị từ chối', async () => {
    const world = makeCastleWorld()
    seal(world, 'kitchen')
    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ type: 'move', toLocation: 'pantry', text: 'Tôi mở cửa.' }), turn: 1 },
      { runner: createScriptedActorRunner({}), seed: 's' },
    )
    expect(result.world.player.location).toBe('kitchen')
    expect(result.issues.map(issue => issue.message).join(' ')).toMatch(/niêm phong/)
  })

  it('người chơi lấy tỏi trong kho: canon đổi, và chỉ người tri giác được mới biết', async () => {
    const world = makeCastleWorld()
    world.player.location = 'pantry'
    world.items['garlic'] = { location: 'pantry', count: 3 }
    const result = await runActorTurn(
      {
        world,
        definitions: ALL_ACTORS,
        action: actorAction({ type: 'item_transfer', item: 'garlic', itemFrom: 'pantry', itemTo: 'player', itemCount: 2, text: 'Tôi giấu hai tép tỏi vào áo.', volume: 'whisper' }),
        turn: 1,
      },
      { runner: createScriptedActorRunner({}), seed: 's' },
    )

    expect(result.world.player.inventory.filter(id => id === 'garlic')).toHaveLength(2)
    expect(result.world.items['garlic']?.count).toBe(1)
    // Người chơi ở kho, các actor ở phòng khác → không ai trong số họ nhận nội dung.
    expect(result.world.actors['npc_lucien']?.memory).toEqual([])
    expect(result.world.actors['npc_lucien']?.beliefs.map(belief => belief.claim)).not.toContain('garlic')
  })

  it('lấy quá số đồ đang có thì bị từ chối, không mất gì', async () => {
    const world = makeCastleWorld()
    world.player.location = 'pantry'
    world.items['garlic'] = { location: 'pantry', count: 1 }
    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ type: 'item_transfer', item: 'garlic', itemFrom: 'pantry', itemTo: 'player', itemCount: 4, text: 'Tôi lấy hết.' }), turn: 1 },
      { runner: createScriptedActorRunner({}), seed: 's' },
    )

    expect(result.committed).toEqual([])
    expect(result.world.items['garlic']?.count).toBe(1)
    expect(result.world.player.inventory).not.toContain('garlic')
    expect(result.issues.map(issue => issue.message).join(' ')).toMatch(/không đủ 4/)
  })

  it('hành động người chơi được commit TRƯỚC hệ quả của actor trong cùng lượt', async () => {
    const world = makeCastleWorld()
    world.player.location = 'pantry'
    // Lucien ở phòng ăn nói, nhưng người chơi đã đi sang bếp trong cùng lượt này.
    const runner = createScriptedActorRunner({ npc_lucien: speak('npc_lucien', 'Ngươi đâu rồi?') })
    const result = await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ type: 'move', toLocation: 'kitchen', text: 'Tôi quay lại bếp.' }), turn: 1 },
      { runner, force: ['npc_lucien'], maxAwake: 1, seed: 's' },
    )

    expect(result.proposed.map(event => event.type)).toEqual(['player_move', 'npc_dialogue'])
    expect(result.world.player.location).toBe('kitchen')
    expect(result.committed).toHaveLength(2)
  })
})

describe('cô lập thông tin end-to-end — soi mọi prompt thực sự được gửi', () => {
  it('prompt của mỗi actor không chứa bí mật ván, không chứa kiến thức của actor khác', async () => {
    const world = makeCastleWorld()
    const prompts = new Map<string, string>()
    const runner = createScriptedActorRunner(
      {
        npc_lucien: speak('npc_lucien', 'Ta đói.'),
        npc_butler: speak('npc_butler', 'Dạ.'),
        faction_knights: output('faction_knights'),
        world_castle: output('world_castle'),
      },
      { onRun: input => prompts.set(input.definition.id, input.prompt) },
    )

    await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1, secretFacts: SECRET_FACTS },
      { runner, force: ALL_ACTORS.map(definition => definition.id), seed: 's' },
    )

    expect(prompts.size).toBe(4)
    for (const [actorId, prompt] of prompts) {
      for (const secret of SECRET_FACTS) expect(prompt).not.toContain(secret)
      for (const other of ALL_ACTORS) {
        if (other.id === actorId) continue
        for (const line of other.allowedKnowledge) expect(prompt).not.toContain(line)
      }
      // Chính nó thì phải thấy đủ kiến thức của mình.
      const self = ALL_ACTORS.find(definition => definition.id === actorId) as ActorDefinition
      for (const line of self.allowedKnowledge) expect(prompt).toContain(line)
    }
  })

  it('payload của actor không chứa state của actor khác', async () => {
    const world = makeCastleWorld()
    const payloads = new Map<string, string>()
    const runner = createScriptedActorRunner(
      { npc_lucien: speak('npc_lucien', 'x'), npc_butler: speak('npc_butler', 'y'), world_castle: output('world_castle') },
      { onRun: input => payloads.set(input.definition.id, JSON.stringify(input.payload)) },
    )
    await runActorTurn(
      { world, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1, secretFacts: SECRET_FACTS },
      { runner, force: ['npc_lucien', 'npc_butler', 'world_castle'], seed: 's' },
    )

    const butler = payloads.get('npc_butler') ?? ''
    expect(butler).not.toContain('npc_lucien')
    expect(butler).not.toContain('Tỏi là món ăn quê mùa.')
    const lucien = payloads.get('npc_lucien') ?? ''
    expect(lucien).not.toContain('npc_butler')
    expect(lucien).not.toContain('Trong kho có tỏi.')
  })
})

describe('bản ghi riêng cho Thiên Đạo', () => {
  it('bản ghi chứa diễn biến riêng, còn kết quả công khai thì không', async () => {
    const runner = createScriptedActorRunner({
      npc_lucien: output('npc_lucien', {
        interpretation: 'Đầu bếp đang thử lòng ta.',
        emotion: 'nghi ngờ',
        intent: { type: 'conceal', content: 'Ta sẽ cho người theo dõi hắn.' },
        beliefClaims: [{ claim: 'Đầu bếp có ý đồ.', confidence: 0.7 }],
        plan: { goal: 'theo dõi đầu bếp', trigger: 'player_leaves_kitchen' },
      }),
    })

    const result = await runActorTurn(
      { world: makeCastleWorld(), definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1, secretFacts: SECRET_FACTS },
      { runner, force: ['npc_lucien'], seed: 's' },
    )
    const report = buildActorReport({ sceneId: 's1', result, definitions: ALL_ACTORS })
    const sealed = renderActorGmText(report)

    expect(sealed).toContain('Đầu bếp đang thử lòng ta.')
    expect(sealed).toContain('theo dõi đầu bếp')
    expect(sealed).toContain('Đầu bếp có ý đồ.')

    const publicText = [result.publicLines.join(' '), JSON.stringify(report.committed), JSON.stringify(report.rejected)].join(' ')
    expect(publicText).not.toContain('Đầu bếp đang thử lòng ta.')
    expect(publicText).not.toContain('theo dõi đầu bếp')
  })

  it('bản ghi kể cả chi tiết bị từ chối và số sự việc ngoài tầm người chơi', async () => {
    const result = await runActorTurn(
      {
        world: makeCastleWorld(),
        definitions: ALL_ACTORS,
        action: actorAction({ volume: 'whisper', type: 'observe', text: 'Tôi đứng yên.' }),
        turn: 1,
      },
      { runner: createScriptedActorRunner({}), force: ['faction_knights'], seed: 's' },
    )
    const report = buildActorReport({ sceneId: 's1', result, definitions: ALL_ACTORS })
    const sealed = renderActorGmText(report)
    expect(sealed).toMatch(/Diễn biến riêng/)
    expect(sealed).toMatch(/ngoài tầm tri giác người chơi/)
  })
})

describe('lưu và đọc trạng thái actor mode', () => {
  it('đi vòng qua đĩa mà giữ nguyên world, pending và báo cáo', async () => {
    const root = tempDir()
    const result = await runActorTurn(
      { world: makeCastleWorld(), definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1, secretFacts: SECRET_FACTS },
      { runner: createScriptedActorRunner({ npc_lucien: speak('npc_lucien', 'Ai đó?') }), force: ['npc_lucien'], seed: 's' },
    )
    const report = buildActorReport({ sceneId: 'scene-x', result, definitions: ALL_ACTORS })
    saveActorSnapshot(root, {
      schemaVersion: ACTOR_SNAPSHOT_VERSION,
      sceneId: 'scene-x',
      turn: 1,
      cast: ALL_ACTORS,
      locations: makeCastleLocations(),
      secretFacts: SECRET_FACTS,
      endConditions: [],
      world: result.world,
      report,
      pending: result.pending,
      notes: [],
    })

    const loaded = loadActorSnapshot(root, 'scene-x')
    expect(loaded?.world.actors['npc_lucien']?.location).toBe(result.world.actors['npc_lucien']?.location)
    expect(loaded?.report?.turn).toBe(1)
    expect(loaded?.report?.actors[0]?.intent).toBe('dialogue')
    expect(Object.keys(loaded?.pending?.entries ?? {})).toEqual(Object.keys(result.pending.entries))
    expect(loaded?.secretFacts).toEqual(SECRET_FACTS)
  })

  it('file hỏng hoặc sai phiên bản thì trả undefined, không ném', () => {
    const root = tempDir()
    saveActorSnapshot(root, {
      schemaVersion: 'rp-actors-v0',
      sceneId: 'scene-y',
      turn: 0,
      cast: [],
      locations: {},
      secretFacts: [],
      endConditions: [],
      world: makeCastleWorld(),
      notes: [],
    })
    expect(loadActorSnapshot(root, 'scene-y')).toBeUndefined()
    expect(loadActorSnapshot(root, 'không-có')).toBeUndefined()
  })
})

// ── Tiện ích dựng provider giả ─────────────────────────────────────────────

function provider(over: {
  readonly inheritsParentContext?: boolean
  readonly toolFilter?: boolean
  readonly outputSchema?: boolean
  readonly persona?: boolean
}) {
  return {
    name: 'spawn',
    inheritsParentContext: over.inheritsParentContext ?? false,
    capabilities: {
      agentOptions: true,
      outputSchema: over.outputSchema ?? true,
      depthLimit: true,
      toolFilter: over.toolFilter ?? true,
      persona: over.persona ?? true,
    },
  }
}

function runtimeProvider(over: Parameters<typeof provider>[0] = {}): SubagentRuntimeLike {
  return {
    getProvider: () => provider(over),
    start: async () => ({ result: Promise.resolve({}), dispose: async () => {} }),
  }
}

function runInput(): ActorRunInput {
  const definition = ALL_ACTORS[0] as ActorDefinition
  return {
    definition,
    prompt: 'prompt sạch',
    turn: 1,
    payload: {
      actorId: definition.id,
      name: definition.name,
      role: definition.role,
      personality: [],
      goals: [],
      knowledge: definition.allowedKnowledge,
      memory: [],
      beliefs: [],
      plans: [],
      selfTraits: [],
      perception: 'người chơi vừa nói gì đó',
      instruction: 'trả JSON',
    },
  }
}
