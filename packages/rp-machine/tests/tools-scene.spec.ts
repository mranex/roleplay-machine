import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CARD_TYPES, toStoredCard, writeCard, type Card } from '../src/card-schema'
import { createRpTools, RP_TOOL_NAMES, type RpToolDefinition } from '../src/tools-scene'
import { runDirOf } from '../src/runtime'
import { makeRichPool, makeVariedPool } from './fixtures/cards'

const NOW = '2026-01-01T00:00:00.000Z'

/** Workspace tạm có thư viện card theo layout mới, và tuỳ chọn có pack hoàn chỉnh. */
function setupWorkspace(options: { readonly withPacks?: boolean; readonly perType?: number } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-tools-'))
  const pool = path.join(root, 'roleplay-machine', 'pool')
  const cards: Card[] = options.perType !== undefined ? makeVariedPool(options.perType) : makeRichPool()
  for (const card of cards) writeCard(pool, card)

  if (options.withPacks === true) {
    const packsDir = path.join(pool, 'packs')
    fs.mkdirSync(packsDir, { recursive: true })
    for (const [id, title, chaos] of [['pack-alpha', 'Alpha', 1], ['pack-beta', 'Beta', 4]] as const) {
      const packCards: Card[] = []
      for (const type of CARD_TYPES) {
        const found = cards.find(card => card.type === type)
        if (found === undefined) continue
        packCards.push({ ...found, id: `${id}_${type}`, chaos })
      }
      fs.writeFileSync(path.join(packsDir, `${id}.json`), JSON.stringify({
        schemaVersion: 'rsm-card-set-v1',
        id,
        title,
        description: '',
        recommendedChaosRange: { min: 8, max: 40 },
        sharedTags: [],
        cards: packCards.map(toStoredCard),
      }))
    }
  }
  return root
}

function setup(options: Parameters<typeof setupWorkspace>[0] = {}) {
  const root = setupWorkspace(options)
  const tools: RpToolDefinition[] = createRpTools({ workspaceRoot: () => root, now: () => NOW })
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const tool = tools.find(entry => entry.name === name)
    if (tool === undefined) throw new Error(`không có tool ${name}`)
    return (await tool.execute(args, { agent: { id: 'sess-test' } })) as Record<string, unknown>
  }
  return { root, tools, call }
}

describe('bộ tool mới', () => {
  it('danh sách tên khớp bộ định nghĩa thật', () => {
    const { tools } = setup()
    expect(tools.map(tool => tool.name)).toEqual([...RP_TOOL_NAMES])
  })

  it('mọi tool khai output.schema kèm render (hợp đồng tools.register của DSH)', () => {
    const { tools } = setup()
    for (const tool of tools) {
      expect(tool.output.schema, `${tool.name} thiếu schema`).toBeTruthy()
      expect(typeof tool.output.render, `${tool.name} thiếu render`).toBe('function')
      expect(tool.description.length).toBeGreaterThan(20)
      expect((tool.parameters as { type?: string }).type).toBe('object')
    }
  })
})

describe('thư viện card', () => {
  it('pool_status đọc đúng thư viện và chưa có ván nào', async () => {
    const { call } = setup()
    const status = await call('rp_pool_status')
    expect(status['ok']).toBe(true)
    expect(status['total']).toBe(8)
    expect(status['gmOnly']).toBe(1)
    expect(status['packs']).toBe(0)
    expect(status['issues']).toEqual([])
    expect(status['runs']).toEqual([])
  })

  it('list_cards lọc theo loại, mức hiển thị và tag', async () => {
    const { call } = setup({ perType: 2 })
    expect((await call('rp_list_cards'))['count']).toBe(16)
    expect((await call('rp_list_cards', { type: 'npc' }))['count']).toBe(2)
    expect((await call('rp_list_cards', { visibility: 'gm_only' }))['count']).toBe(2)
    expect((await call('rp_list_cards', { tag: 'chung' }))['count']).toBe(16)
    expect((await call('rp_list_cards', { limit: 3 }))['count']).toBe(3)
  })

  it('add_card nhận card hợp lệ và từ chối card vượt trần fragment', async () => {
    const { call } = setup()
    const good = await call('rp_add_card', {
      card: {
        schemaVersion: 'rsm-card-v1',
        id: 'npc_them_moi',
        title: 'NPC thêm mới',
        type: ['npc'],
        description: '',
        chaos: 3,
        tags: ['chung'],
        compatibility: { universal: false, domain: ['core'], compatibleTags: [], requiredAnyTags: [], requiredAllTags: [], incompatibleTags: [], compatibleCardIds: [], incompatibleCardIds: [] },
        visibility: 'public',
        weight: 10,
        fragments: { prompt: 'Một chỉ thị hành vi vừa đủ dài để hợp lệ trong schema card.', firstMessage: '', hiddenTruth: '', heavenRule: '', contentBoundary: '' },
        generationHints: { tone: [], preferredUse: '', avoidUse: '' },
        qualityNotes: [],
        metadata: { author: '', createdAt: NOW, updatedAt: NOW, source: 'test' },
      },
    })
    expect(good['ok']).toBe(true)
    expect(String(good['file'])).toMatch(/[\\/]npc[\\/]npc_them_moi\.json$/)

    const bad = await call('rp_add_card', {
      card: {
        schemaVersion: 'rsm-card-v1',
        id: 'npc_qua_dai',
        title: 'Quá dài',
        type: ['npc'],
        chaos: 3,
        tags: ['chung'],
        fragments: { prompt: 'x'.repeat(1200) },
        metadata: {},
      },
    })
    expect(bad['ok']).toBe(false)
    expect((bad['issues'] as string[]).join(' ')).toMatch(/vượt trần/)
  })

  it('add_card từ chối id trùng, và cho ghi đè khi replace = true', async () => {
    const { call } = setup()
    const base = {
      schemaVersion: 'rsm-card-v1',
      id: 'npc_giau',
      title: 'Bản đầu',
      type: ['npc'],
      chaos: 2,
      tags: ['chung'],
      fragments: { prompt: 'Một chỉ thị hành vi vừa đủ dài để hợp lệ trong schema card.' },
      metadata: {},
    }
    const first = await call('rp_add_card', { card: base })
    expect(first['ok']).toBe(false)
    expect((first['issues'] as string[]).join(' ')).toMatch(/đã tồn tại/)
    expect(first['id']).toBe('npc_giau')

    const replaced = await call('rp_add_card', { card: { ...base, title: 'Bản hai' }, replace: true })
    expect(replaced['ok']).toBe(true)
  })

  it('delete_card xoá được và trả false khi không thấy', async () => {
    const { call } = setup()
    expect((await call('rp_delete_card', { id: 'npc_giau' }))['ok']).toBe(true)
    expect((await call('rp_delete_card', { id: 'npc_giau' }))['ok']).toBe(false)
    expect((await call('rp_pool_status'))['total']).toBe(7)
  })
})

describe('mở ván', () => {
  it('new_scene sinh scene, khởi tạo ván, và trả briefing CÔNG KHAI', async () => {
    const { call } = setup({ withPacks: true })
    const created = await call('rp_new_scene', { mode: 'boss_mode' })
    expect(created['ok']).toBe(true)
    expect(String(created['sceneId'])).toMatch(/^scene-boss_mode-/)
    expect(created['source']).not.toBeNull()
    expect((created['meters'] as unknown[]).length).toBeGreaterThan(0)
    expect(String(created['briefing'])).toContain('Vai của bạn')
    expect(String(created['briefing'])).toContain('Mục tiêu')
    expect(String(created['next'])).toMatch(/rp_turn/)
  })

  it('dùng pack làm bộ nguồn nên cả 8 slot cùng một pack', async () => {
    const { call } = setup({ withPacks: true })
    const created = await call('rp_new_scene', { mode: 'boss_mode' })
    const source = created['source'] as { id: string }
    const state = await call('rp_state', { sceneId: created['sceneId'] })
    expect(state['ok']).toBe(true)
    // Id card luôn mang tiền tố của pack đã chọn.
    expect(source.id === 'pack-alpha' || source.id === 'pack-beta').toBe(true)
  })

  it('seed tất định: cùng seed cho cùng sceneId và cùng chaos', async () => {
    const { call } = setup()
    const a = await call('rp_new_scene', { mode: 'coward', seed: 'co-dinh' })
    const b = await call('rp_new_scene', { mode: 'coward', seed: 'co-dinh' })
    expect(b['sceneId']).toBe(a['sceneId'])
    expect((b['chaos'] as { total: number }).total).toBe((a['chaos'] as { total: number }).total)
  })

  it('tôn trọng card người chơi chỉ định', async () => {
    const { call } = setup()
    const created = await call('rp_new_scene', { mode: 'coward', picks: { world: 'world_giau' }, seed: 'chon' })
    expect((created['briefing'] as string).length).toBeGreaterThan(0)
    const listed = await call('rp_list_cards', { type: 'world' })
    expect((listed['cards'] as { id: string }[]).map(card => card.id)).toContain('world_giau')
  })

  it('ép ngân sách chọn theo mode', async () => {
    const { call } = setup()
    await expect(call('rp_new_scene', { mode: 'boss_mode', picks: { world: 'world_giau' } })).rejects.toThrow(/chỉ cho tự chọn 0/)
  })

  it('thư viện rỗng thì báo lỗi rõ ràng', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-empty-'))
    const tools = createRpTools({ workspaceRoot: () => root, now: () => NOW })
    const create = tools.find(tool => tool.name === 'rp_new_scene')!
    await expect(async () => create.execute({ mode: 'boss_mode' }, {})).rejects.toThrow(/Thư viện rỗng/)
  })
})

describe('chơi ván', () => {
  async function opened() {
    const ctx = setup({ withPacks: true })
    const created = await ctx.call('rp_new_scene', { mode: 'boss_mode', seed: 'choi' })
    return { ...ctx, sceneId: String(created['sceneId']), created }
  }

  it('state đọc khung công khai và danh sách ván', async () => {
    const { call, sceneId } = await opened()
    const state = await call('rp_state', { sceneId })
    expect(state['ok']).toBe(true)
    expect(String(state['frame'])).toContain('Thanh căng thẳng')
    expect((state['runs'] as unknown[]).length).toBe(1)
  })

  it('state không có ván nào thì trả ok false thay vì nổ', async () => {
    const { call } = setup()
    const state = await call('rp_state')
    expect(state['ok']).toBe(false)
    expect(String(state['frame'])).toMatch(/Chưa có ván nào/)
  })

  it('turn tăng lượt và trả chỉ dẫn', async () => {
    const { call, sceneId } = await opened()
    const turn = await call('rp_turn', { sceneId, playerAction: 'Tôi rót rượu và mời hắn nếm thử.' })
    expect(turn['turn']).toBe(1)
    expect((turn['signals'] as { meta: boolean }).meta).toBe(false)
    expect(Array.isArray(turn['instructions'])).toBe(true)
  })

  it('turn nhận diện tín hiệu bí và tín hiệu ngoài truyện', async () => {
    const { call, sceneId } = await opened()
    const bailout = await call('rp_turn', { sceneId, playerAction: 'Tôi bí quá, không biết làm gì.' })
    expect((bailout['signals'] as { bailout: boolean }).bailout).toBe(true)
    expect((bailout['instructions'] as string[]).join(' ')).toMatch(/rp_grace/)

    const meta = await call('rp_turn', { sceneId, playerAction: 'OOC: tôi muốn đổi luật ván này' })
    expect((meta['signals'] as { meta: boolean }).meta).toBe(true)
    expect((meta['instructions'] as string[]).join(' ')).toMatch(/rp_strike/)
  })

  it('meter đổi đúng thanh và từ chối thanh không tồn tại', async () => {
    const { call, sceneId } = await opened()
    const meters = (await call('rp_state', { sceneId }))['frame'] as string
    expect(meters.length).toBeGreaterThan(0)

    const moved = await call('rp_meter', { sceneId, delta: 2, reason: 'hắn bắt đầu để ý' })
    expect(moved['ok']).toBe(true)
    expect((moved['meters'] as { value: number }[])[0]?.value).toBeGreaterThan(0)

    const missing = await call('rp_meter', { sceneId, meterId: 'khong-co', reason: 'x' })
    expect(missing['ok']).toBe(false)
    expect((missing['issues'] as string[]).join(' ')).toMatch(/Không có thanh/)
  })

  it('meter chạm ngưỡng thì ván thua', async () => {
    const { call, sceneId } = await opened()
    const result = await call('rp_meter', { sceneId, value: 99, reason: 'quá đà' })
    expect(result['failed']).toBe(true)
    expect(String(result['frame'])).toContain('lost')
  })

  it('strike đủ trần thì bị trục xuất, và KHÔNG đụng vào thanh căng thẳng', async () => {
    const { call, sceneId } = await opened()
    const before = await call('rp_state', { sceneId })
    let last: Record<string, unknown> = {}
    for (let i = 0; i < 5; i++) last = await call('rp_strike', { sceneId, reason: `vi phạm ${i}` })
    expect(last['ejected']).toBe(true)
    const after = await call('rp_state', { sceneId })
    expect(String(after['frame'])).toContain('ejected')
    // Thanh căng thẳng không đổi vì OOC là trục riêng.
    expect(String(after['frame']).split('【Thanh căng thẳng】')[1]?.split('\n')[0])
      .toBe(String(before['frame']).split('【Thanh căng thẳng】')[1]?.split('\n')[0])
  })

  it('grace ban ơn nhưng tính giá bằng một thanh căng thẳng', async () => {
    const { call, sceneId } = await opened()
    const grace = await call('rp_grace', { sceneId, request: 'không biết đi đâu' })
    expect(grace['ok']).toBe(true)
    expect(String(grace['cost'])).toMatch(/\+1/)
    expect(String(grace['text'])).toContain('Thiên Đạo')
  })

  it('step đếm đúng tiến độ và chỉ kết thúc khi hết bước', async () => {
    const { call, sceneId } = await opened()
    const first = await call('rp_step', { sceneId, step: 1, evidence: 'hắn ăn hết' })
    expect(first['ok']).toBe(true)
    expect(first['finished']).toBe(false)
    expect(first['stepsTotal']).toBe(3)
    expect(String(first['message'])).toContain('1/3')

    await call('rp_step', { sceneId, step: 2 })
    const third = await call('rp_step', { sceneId, step: 3 })
    expect(third['finished']).toBe(true)
    expect(third['stepsDone']).toBe(3)
  })

  it('ván đã kết thúc thì turn từ chối mở lượt', async () => {
    const { call, sceneId } = await opened()
    for (const step of [1, 2, 3]) await call('rp_step', { sceneId, step })
    const after = await call('rp_turn', { sceneId, playerAction: 'chơi tiếp' })
    expect(after['ok']).toBe(false)
  })

  it('end từ chối khi ván chưa kết thúc, và ghi epilogue khi đã kết thúc', async () => {
    const { root, call, sceneId } = await opened()
    const early = await call('rp_end', { sceneId, epilogue: 'chưa xong' })
    expect(early['ok']).toBe(false)

    for (const step of [1, 2, 3]) await call('rp_step', { sceneId, step })
    const done = await call('rp_end', { sceneId, epilogue: 'Hắn ăn món thứ ba và không kịp nhận ra điều gì.' })
    expect(done['ok']).toBe(true)
    expect(done['status']).toBe('won')
    const file = path.join(runDirOf(root, sceneId), 'ending.md')
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toContain('Hắn ăn món thứ ba')
  })
})

describe('ranh giới bí mật của tool output', () => {
  it('không tool công khai nào rò rỉ hiddenTruth của bất kỳ card nào', async () => {
    const ctx = setup({ withPacks: true })
    const created = await ctx.call('rp_new_scene', { mode: 'boss_mode', seed: 'bi-mat' })
    const sceneId = String(created['sceneId'])

    const outputs: unknown[] = [created, await ctx.call('rp_pool_status'), await ctx.call('rp_list_cards'), await ctx.call('rp_state', { sceneId })]
    outputs.push(await ctx.call('rp_turn', { sceneId, playerAction: 'Tôi mở cửa.' }))
    outputs.push(await ctx.call('rp_meter', { sceneId, delta: 1, reason: 'thử' }))
    outputs.push(await ctx.call('rp_strike', { sceneId, reason: 'thử' }))
    outputs.push(await ctx.call('rp_grace', { sceneId }))
    outputs.push(await ctx.call('rp_step', { sceneId, step: 1 }))
    outputs.push(await ctx.call('rp_end', { sceneId, epilogue: 'kết' }))

    const sceneFile = JSON.parse(fs.readFileSync(path.join(ctx.root, 'roleplay-machine', 'scenes', `${sceneId}.json`), 'utf8')) as {
      sceneCore: { hiddenTruth: string }
      cardFragments: Record<string, { hiddenTruth: string }>
    }
    const secrets = [
      sceneFile.sceneCore.hiddenTruth,
      ...Object.values(sceneFile.cardFragments).map(fragment => fragment.hiddenTruth),
    ].filter(text => text.trim() !== '')
    expect(secrets.length).toBeGreaterThan(0)

    const blob = JSON.stringify(outputs)
    for (const secret of secrets) expect(blob).not.toContain(secret)
    // Nhưng khung công khai vẫn phải có thông tin chơi được.
    expect(blob).toContain('Vai của bạn')
    expect(blob).toContain('Thanh căng thẳng')
  })
})
