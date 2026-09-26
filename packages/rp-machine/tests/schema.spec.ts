import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assertObjectJsonSchema, assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { CARD_TYPES, toStoredCard, writeCard, type Card } from '../src/card-schema'
import { createRpTools, type RpToolDefinition } from '../src/tools-scene'
import { loadActorSnapshot } from '../src/actor/turn'
import { loadRun } from '../src/runtime'
import { makeRichPool } from './fixtures/cards'

/**
 * Kiểm chứng mạnh nhất mà không cần mở GUI: schema của tool phải nằm trong tập con DSH hỗ trợ, và giá
 * trị trả về thật phải khớp schema đã khai. Nếu hai điều này đúng thì `tools.register()` của host sẽ
 * không từ chối plugin.
 */

const NOW = '2026-01-01T00:00:00.000Z'

/**
 * Dàn actor tối thiểu cho test tầng tool. Actor được giả lập trả về một output có cả niềm tin và kế
 * hoạch riêng, để kiểm được rằng những thứ đó KHÔNG lọt vào kết quả tool.
 */
const ACTOR_CAST = [
  {
    id: 'npc_butler',
    kind: 'npc',
    name: 'Quản gia',
    role: 'quản gia trung thành',
    location: 'kitchen',
    allowedKnowledge: ['Lâu đài này có một quản gia trung thành.'],
    goals: ['giữ lâu đài ngăn nắp'],
    perceive: ['same_room', 'addressed'],
    traits: { suspicion_player: 1 },
  },
]

const ACTOR_LOCATIONS = { kitchen: { adjacent: ['pantry'] }, pantry: { adjacent: ['kitchen'] } }

const ACTOR_PAYLOAD = {
  actor_id: 'npc_butler',
  interpretation: 'Người chơi vừa chào ta.',
  emotion: 'điềm tĩnh',
  intent_type: 'dialogue',
  intent_content: 'Dạ, thưa ngài.',
  belief_claims: [{ claim: 'Đầu bếp đang giấu một kế hoạch bí mật.', confidence: 0.7 }],
  plan_goal: 'theo dõi đầu bếp',
  plan_trigger: 'player_leaves_kitchen',
}

function actorRuntime(payload: unknown = ACTOR_PAYLOAD) {
  return {
    getProvider: () => ({
      name: 'spawn',
      inheritsParentContext: false,
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    }),
    start: async (_name: string, request: { readonly label?: string }) => ({
      result: Promise.resolve({
        stopReason: 'completed',
        structured: String(request.label ?? '').startsWith('writer:')
          ? { title: 'Truyện thử', body: 'Một đoạn văn đủ dài để vượt ngưỡng kiểm tra của writer. '.repeat(8), notes: ['ánh nến'] }
          : payload,
      }),
      dispose: async () => {},
    }),
  }
}

function setupWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-schema-'))
  const pool = path.join(root, 'roleplay-machine', 'pool')
  for (const card of makeRichPool() as Card[]) writeCard(pool, card)
  const packsDir = path.join(pool, 'packs')
  fs.mkdirSync(packsDir, { recursive: true })
  const packCards = CARD_TYPES.map(type => (makeRichPool() as Card[]).find(card => card.type === type) as Card)
  fs.writeFileSync(path.join(packsDir, 'pack-alpha.json'), JSON.stringify({
    schemaVersion: 'rsm-card-set-v1',
    id: 'pack-alpha',
    title: 'Alpha',
    description: '',
    recommendedChaosRange: { min: 8, max: 40 },
    sharedTags: [],
    cards: packCards.map(toStoredCard),
  }))
  return root
}

async function capture(): Promise<{ tools: RpToolDefinition[]; captured: Map<string, unknown[]> }> {
  const root = setupWorkspace()
  const tools = createRpTools({ workspaceRoot: () => root, now: () => NOW, subagents: actorRuntime() })
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const tool = tools.find(entry => entry.name === name)
    if (tool === undefined) throw new Error(`thiếu tool ${name}`)
    return await tool.execute(args, { agent: { id: 'sess-schema' } })
  }
  const captured = new Map<string, unknown[]>()
  const record = (name: string, value: unknown): void => {
    captured.set(name, [...(captured.get(name) ?? []), value])
  }

  record('rp_pool_status', await call('rp_pool_status'))
  record('rp_list_cards', await call('rp_list_cards', { type: 'world' }))
  record('rp_add_card', await call('rp_add_card', {
    card: {
      schemaVersion: 'rsm-card-v1',
      id: 'npc_schema',
      title: 'NPC schema',
      type: ['npc'],
      chaos: 2,
      tags: ['chung'],
      fragments: { prompt: 'Một chỉ thị hành vi vừa đủ dài để hợp lệ trong schema card.' },
      metadata: {},
    },
  }))
  record('rp_add_card', await call('rp_add_card', { card: { schemaVersion: 'rsm-card-v1', id: 'npc_giau', title: 'Trùng', type: ['npc'], chaos: 2, tags: ['chung'], fragments: { prompt: 'Một chỉ thị hành vi vừa đủ dài để hợp lệ trong schema card.' }, metadata: {} } }))
  record('rp_delete_card', await call('rp_delete_card', { id: 'npc_schema' }))
  record('rp_delete_card', await call('rp_delete_card', { id: 'khong-co' }))

  const created = (await call('rp_new_scene', { mode: 'boss_mode', seed: 'schema' })) as { sceneId: string }
  record('rp_new_scene', created)
  const sceneId = created.sceneId

  record('rp_state', await call('rp_state', { sceneId }))
  record('rp_turn', await call('rp_turn', { sceneId, playerAction: 'Tôi mở cửa.' }))
  record('rp_meter', await call('rp_meter', { sceneId, delta: 1, reason: 'thử' }))
  record('rp_meter', await call('rp_meter', { sceneId, meterId: 'khong-co', reason: 'thử' }))
  record('rp_strike', await call('rp_strike', { sceneId, reason: 'thử' }))
  record('rp_grace', await call('rp_grace', { sceneId }))
  record('rp_step', await call('rp_step', { sceneId, step: 1 }))
  record('rp_end', await call('rp_end', { sceneId, epilogue: 'kết thử' }))
  record('rp_step', await call('rp_step', { sceneId, step: 2 }))
  record('rp_step', await call('rp_step', { sceneId, step: 3 }))
  record('rp_end', await call('rp_end', { sceneId, epilogue: 'kết thật' }))

  // Multi-Actor-Agent Mode: khai dàn actor rồi chạy một lượt bằng runner giả.
  record('rp_actor_cast', await call('rp_actor_cast', { sceneId, cast: ACTOR_CAST, locations: ACTOR_LOCATIONS, playerLocation: 'kitchen' }))
  record('rp_actor_turn', await call('rp_actor_turn', { sceneId, playerAction: 'Tôi chào quản gia.' }))
  record('rp_actor_state', await call('rp_actor_state', { sceneId }))

  // Story: log lời kể, export hồ sơ, viết truyện ngắn.
  record('rp_log', await call('rp_log', { sceneId, narration: 'Quản gia cúi đầu.', outcome: 'Quản gia đã đáp lời.' }))
  record('rp_export', await call('rp_export', { sceneId, pov: 'player' }))
  record('rp_write', await call('rp_write', { sceneId, view: 'player', length: 'short', style: 'plain' }))

  // Nhánh chưa có ván. `rp_actor_state` cũng gọi resolveRun nên cũng ném — cùng quy ước với mọi tool
  // khác, và đã có test riêng cho nhánh chưa khai dàn actor.
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-schema-empty-'))
  const emptyTools = createRpTools({ workspaceRoot: () => emptyRoot, now: () => NOW, subagents: actorRuntime() })
  record('rp_state', await emptyTools.find(tool => tool.name === 'rp_state')!.execute({}, {}))

  return { tools, captured }
}

describe('schema tool theo bộ kiểm tra của DSH', () => {
  it('mọi tool có schema hợp lệ, parameters hợp lệ, và giá trị trả về khớp schema', async () => {
    const { tools, captured } = await capture()
    const failures: string[] = []
    let checked = 0

    for (const tool of tools) {
      try {
        assertSupportedJsonSchema(tool.output.schema)
      } catch (error) {
        failures.push(`${tool.name}: output.schema ngoài tập con — ${(error as Error).message}`)
        continue
      }
      try {
        assertObjectJsonSchema(tool.parameters)
      } catch (error) {
        failures.push(`${tool.name}: parameters không phải object schema hợp lệ — ${(error as Error).message}`)
      }
      const values = captured.get(tool.name) ?? []
      expect(values.length, `${tool.name} chưa được gọi trong capture()`).toBeGreaterThan(0)
      for (const value of values) {
        checked++
        const violations = validateJsonSchemaValue(tool.output.schema, value)
        if (Array.isArray(violations) && violations.length > 0) {
          failures.push(`${tool.name}: giá trị không khớp schema — ${violations.join('; ')}`)
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([])
    expect(checked).toBeGreaterThan(tools.length)
  })

  it('render của mọi tool trả về block text (host cần để hiển thị kết quả)', () => {
    const tools = createRpTools({ workspaceRoot: () => process.cwd(), now: () => NOW })
    for (const tool of tools) {
      const blocks = tool.output.render({}, { ok: true }) as Array<{ type: string; text: string }>
      expect(Array.isArray(blocks), `${tool.name} render không trả mảng`).toBe(true)
      expect(blocks[0]?.type).toBe('text')
      expect(typeof blocks[0]?.text).toBe('string')
    }
  })
})

describe('tầng tool của Multi-Actor-Agent Mode', () => {
  async function freshScene(seed: string): Promise<{ root: string; tools: RpToolDefinition[]; sceneId: string }> {
    const root = setupWorkspace()
    const tools = createRpTools({ workspaceRoot: () => root, now: () => NOW, subagents: actorRuntime() })
    const created = (await tools.find(tool => tool.name === 'rp_new_scene')!.execute(
      { mode: 'boss_mode', seed },
      { agent: { id: 'sess-actor' } },
    )) as { sceneId: string }
    return { root, tools, sceneId: created.sceneId }
  }

  const exec = (name: string, tools: RpToolDefinition[], args: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(tools.find(tool => tool.name === name)!.execute(args, { agent: { id: 'sess-actor' } }))

  it('chưa khai dàn actor thì rp_actor_turn từ chối rõ ràng, rp_actor_state báo ok:false', async () => {
    const { tools, sceneId } = await freshScene('actor-none')
    await expect(exec('rp_actor_turn', tools, { sceneId, playerAction: 'xin chào' })).rejects.toThrow(/Multi-Actor-Agent Mode/)
    const state = (await exec('rp_actor_state', tools, { sceneId })) as { ok: boolean; notes: string[] }
    expect(state.ok).toBe(false)
    expect(state.notes.join(' ')).toMatch(/chưa ở Multi-Actor-Agent Mode/)
  })

  it('khai báo không dùng được thì rp_actor_cast từ chối, không ghi state nửa vời', async () => {
    const { tools, sceneId } = await freshScene('actor-bad')
    const bad = (await exec('rp_actor_cast', tools, {
      sceneId,
      cast: ACTOR_CAST,
      locations: { kitchen: { adjacent: ['pantry'] }, pantry: { adjacent: ['kitchen'] } },
      playerLocation: 'nơi_không_tồn_tại',
    })) as { ok: boolean }
    // playerLocation sai chỉ là cảnh báo: nó rơi về địa điểm đầu, nên vẫn dùng được.
    expect(bad.ok).toBe(true)

    const worse = (await exec('rp_actor_cast', tools, { sceneId, cast: [], locations: {} })) as { ok: boolean; issues: string[] }
    expect(worse.ok).toBe(false)
    expect(worse.issues.join(' ')).toMatch(/chưa dùng được/)
  })

  it('kết quả rp_actor_turn không chứa diễn biến riêng, nhưng bản ghi trên đĩa thì có', async () => {
    const { root, tools, sceneId } = await freshScene('actor-leak')
    const cast = (await exec('rp_actor_cast', tools, {
      sceneId,
      cast: ACTOR_CAST,
      locations: ACTOR_LOCATIONS,
      playerLocation: 'kitchen',
    })) as { ok: boolean }
    expect(cast.ok).toBe(true)

    const turn = (await exec('rp_actor_turn', tools, { sceneId, playerAction: 'Tôi chào quản gia.' })) as {
      ok: boolean
      frame: string
      facts: string[]
      awake: string[]
    }
    expect(turn.ok).toBe(true)
    // Quản gia cùng phòng nên được đánh thức và lời nói của nó thành sự thật công khai.
    expect(turn.awake).toContain('Quản gia')
    expect(turn.facts.join(' ')).toContain('Dạ, thưa ngài.')

    // Diễn biến riêng (niềm tin, kế hoạch) KHÔNG được có trong kết quả tool: transcript là nơi người
    // chơi đọc được.
    const toolText = JSON.stringify(turn)
    expect(toolText).not.toContain('kế hoạch bí mật')
    expect(toolText).not.toContain('theo dõi đầu bếp')
    expect(toolText).not.toContain('plan')

    // Nhưng bản ghi trên đĩa (đi qua kênh kín) thì phải có.
    const snapshot = loadActorSnapshot(root, sceneId)
    expect(JSON.stringify(snapshot?.report)).toContain('kế hoạch bí mật')
    expect(snapshot?.report?.actors[0]?.plan).toContain('theo dõi đầu bếp')
  })

  it('rp_actor_turn tiến số lượt của ván, không đứng yên ở lượt 1', async () => {
    const { root, tools, sceneId } = await freshScene('actor-turn-number')
    await exec('rp_actor_cast', tools, { sceneId, cast: ACTOR_CAST, locations: ACTOR_LOCATIONS, playerLocation: 'kitchen' })

    const first = (await exec('rp_actor_turn', tools, { sceneId, playerAction: 'Tôi chào quản gia.' })) as { turn: number }
    const second = (await exec('rp_actor_turn', tools, { sceneId, playerAction: 'Tôi hỏi thăm lâu đài.' })) as { turn: number }

    expect(first.turn).toBe(1)
    expect(second.turn).toBe(2)
    const run = loadRun(root, sceneId)
    expect(run?.turn).toBe(2)
    expect(run?.history.map(entry => entry.turn)).toEqual([1, 2])
  })

  it('điều kiện kết thúc khớp thì chốt luôn ván, và lượt sau bị từ chối', async () => {
    const { root, tools, sceneId } = await freshScene('actor-end')
    await exec('rp_actor_cast', tools, {
      sceneId,
      cast: ACTOR_CAST,
      locations: ACTOR_LOCATIONS,
      playerLocation: 'kitchen',
      endConditions: [{ id: 'end_win', outcome: 'won', allOf: [{ kind: 'actorAlive', actor: 'npc_butler' }] }],
    })

    const turn = (await exec('rp_actor_turn', tools, { sceneId, playerAction: 'Tôi chào quản gia.' })) as { ended?: string; ok: boolean }
    expect(turn.ok).toBe(true)
    expect(turn.ended).toContain('end_win')
    expect(loadRun(root, sceneId)?.status).toBe('won')

    const after = (await exec('rp_actor_turn', tools, { sceneId, playerAction: 'nói thêm' })) as { ok: boolean }
    expect(after.ok).toBe(false)
  })
})
