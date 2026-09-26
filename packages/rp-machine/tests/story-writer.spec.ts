import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRpTools, planWriterRequests, type RpToolDefinition } from '../src/tools-scene'
import { writeCard, type Card } from '../src/card-schema'
import { makeRichPool } from './fixtures/cards'
import { loadRun } from '../src/runtime'
import { loadActorSnapshot } from '../src/actor/turn'
import { storyDirOf, transcriptFileOf, loadStoryTurns } from '../src/story/transcript'
import { PovViolation, assertPovSafe, povForbidden } from '../src/story/guard'
import { renderMaterial } from '../src/story/export'
import {
  createSpawnWriterRunner,
  createScriptedWriterRunner,
  type WriterRunInput,
} from '../src/story/session'
import { parseWriterOutput, renderWriterPrompt, wordCount } from '../src/story/brief'
import type { SubagentStartRequestLike, SubagentRuntimeLike } from '../src/actor/session'

/**
 * Writer — chạy thật qua tầng tool, với subagent giả nên không tốn model call.
 *
 * Trọng tâm: prompt mà writer nhận được phải sạch theo góc nhìn, và một truyện rò rỉ thì **không bao giờ**
 * được ghi ra đĩa.
 */

const TEMP_DIRS: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-writer-'))
  TEMP_DIRS.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const ACTOR_PAYLOAD = {
  actor_id: 'npc_butler',
  interpretation: 'Đầu bếp vừa gọi ta.',
  emotion: 'điềm tĩnh',
  intent_type: 'dialogue',
  intent_content: 'Dạ, thưa ngài.',
  belief_claims: [{ claim: 'Đầu bếp đang giấu một kế hoạch bí mật.', confidence: 0.7 }],
  plan_goal: 'theo dõi đầu bếp',
  plan_trigger: 'player_leaves_kitchen',
}

const WRITER_BODY = [
  'Quản gia đứng ở ngưỡng cửa, tay vẫn đặt trên khay bạc. Ông nghe tiếng gọi và cúi đầu.',
  'Ánh nến trong bếp nghiêng đi một nhịp. Ông không hỏi thêm gì, chỉ lùi lại nửa bước và chờ.',
  'Bên ngoài, hành lang lạnh hơn mọi khi. Một cánh cửa nào đó khép lại rất khẽ, như thể có người',
  'vừa quyết định không bước vào. Quản gia ghi nhớ chi tiết ấy, như ông vẫn ghi nhớ mọi thứ.',
].join(' ')

function fakeRuntime(options: {
  readonly writerPayload?: unknown
  readonly onRequest?: (request: SubagentStartRequestLike) => void
} = {}): SubagentRuntimeLike {
  return {
    getProvider: () => ({
      name: 'spawn',
      inheritsParentContext: false,
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    }),
    start: async (_name, request) => {
      options.onRequest?.(request)
      const label = String(request.label ?? '')
      const structured = label.startsWith('writer:')
        ? options.writerPayload ?? { title: 'Ngưỡng cửa', body: WRITER_BODY, notes: ['Ánh nến nghiêng đi một nhịp.'] }
        : ACTOR_PAYLOAD
      return { result: Promise.resolve({ stopReason: 'completed', structured }), dispose: async () => {} }
    },
  }
}

interface Harness {
  readonly root: string
  readonly tools: RpToolDefinition[]
  readonly sceneId: string
  readonly hiddenTruth: string
  readonly requests: SubagentStartRequestLike[]
  call: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/** Dựng một ván actor-mode thật rồi mới tới phần story. */
async function harness(options: Parameters<typeof fakeRuntime>[0] = {}): Promise<Harness> {
  const root = tempDir()
  const pool = path.join(root, 'roleplay-machine', 'pool')
  for (const card of makeRichPool() as Card[]) writeCard(pool, card)

  const requests: SubagentStartRequestLike[] = []
  const tools = createRpTools({
    workspaceRoot: () => root,
    now: () => '2026-01-01T00:00:00.000Z',
    subagents: fakeRuntime({ ...options, onRequest: request => { requests.push(request); options.onRequest?.(request) } }),
  })

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const tool = tools.find(entry => entry.name === name)
    if (tool === undefined) throw new Error(`thiếu tool ${name}`)
    return (await tool.execute(args, { agent: { id: 'sess-story' } })) as Record<string, unknown>
  }

  const created = await call('rp_new_scene', { mode: 'boss_mode', seed: 'story-writer' })
  const sceneId = String(created['sceneId'])
  const { loadScene } = await import('../src/scene')
  const hiddenTruth = loadScene(root, sceneId)?.sceneCore.hiddenTruth ?? ''

  await call('rp_actor_cast', {
    sceneId,
    playerLocation: 'kitchen',
    locations: { kitchen: { adjacent: ['pantry'] }, pantry: { adjacent: ['kitchen'] } },
    cast: [{
      id: 'npc_butler',
      kind: 'npc',
      name: 'Quản gia',
      role: 'quản gia trung thành',
      location: 'kitchen',
      allowedKnowledge: ['Ta phục vụ lâu đài này.'],
      perceive: ['same_room', 'addressed'],
      traits: { suspicion_player: 1 },
    }],
  })
  await call('rp_actor_turn', { sceneId, playerAction: 'Tôi gọi quản gia.', volume: 'normal' })

  return { root, tools, sceneId, hiddenTruth, requests, call }
}

describe('rp_log — lời kể và hệ quả', () => {
  it('lưu lời kể vào transcript và vá outcome đang rỗng trong state.json', async () => {
    const h = await harness()
    expect(loadRun(h.root, h.sceneId)?.history[0]?.outcome).toBe('')

    const logged = await h.call('rp_log', { sceneId: h.sceneId, narration: 'Quản gia cúi đầu.', outcome: 'Quản gia đã đáp lời.' })
    expect(logged['ok']).toBe(true)
    expect(logged['turn']).toBe(1)
    expect(logged['narrated']).toBe(1)

    expect(loadRun(h.root, h.sceneId)?.history[0]?.outcome).toBe('Quản gia đã đáp lời.')
    const turns = loadStoryTurns(h.root, h.sceneId)
    expect(turns[0]?.narration).toBe('Quản gia cúi đầu.')
    expect(turns[0]?.outcome).toBe('Quản gia đã đáp lời.')
    expect(fs.existsSync(transcriptFileOf(h.root, h.sceneId))).toBe(true)
  })

  it('từ chối lời kể khi chưa có lượt nào', async () => {
    const h = await harness()
    await expect(h.call('rp_log', { sceneId: h.sceneId, narration: 'x', turn: 0 })).rejects.toThrow(/Chưa có lượt nào/)
  })
})

describe('rp_export — hồ sơ lưu trữ', () => {
  it('ghi story.md, story.json, và nguyên liệu cho POV được yêu cầu', async () => {
    const h = await harness()
    await h.call('rp_log', { sceneId: h.sceneId, narration: 'Quản gia cúi đầu.', outcome: 'Đã đáp lời.' })
    const exported = await h.call('rp_export', { sceneId: h.sceneId, pov: 'player' })

    expect(exported['ok']).toBe(true)
    const markdown = String(exported['markdown'])
    const json = String(exported['json'])
    expect(fs.existsSync(markdown)).toBe(true)
    expect(fs.existsSync(json)).toBe(true)
    expect(fs.existsSync(path.join(path.dirname(markdown), 'material-player.md'))).toBe(true)

    // Hồ sơ đầy đủ là phía Thiên Đạo: nó CÓ chứa bí mật.
    expect(fs.readFileSync(markdown, 'utf8')).toContain(h.hiddenTruth)
    // Còn nguyên liệu POV1 thì không.
    const material = fs.readFileSync(path.join(path.dirname(markdown), 'material-player.md'), 'utf8')
    expect(material).not.toContain(h.hiddenTruth)
    expect(material).toContain('Dạ, thưa ngài.')
  })

  it('kết quả tool công khai: không chứa bí mật, chỉ đường dẫn và số liệu', async () => {
    const h = await harness()
    const exported = await h.call('rp_export', { sceneId: h.sceneId, pov: 'player' })
    expect(JSON.stringify(exported)).not.toContain(h.hiddenTruth)
    expect(exported['sections']).toContain('sealed:sealed')
    expect(Number((exported['summary'] as Record<string, unknown>)['turns'])).toBe(1)
  })

  it('allPovs cắt nguyên liệu cho mọi góc nhìn, kể cả POV3 của từng actor', async () => {
    const h = await harness()
    const exported = await h.call('rp_export', { sceneId: h.sceneId, allPovs: true })
    const dir = String(exported['dir'])
    for (const name of ['material-player.md', 'material-kami.md', 'material-omniscient.md', 'material-npc-npc_butler.md']) {
      expect(fs.existsSync(path.join(dir, name)), `thiếu ${name}`).toBe(true)
    }
    expect(fs.readFileSync(path.join(dir, 'material-kami.md'), 'utf8')).toContain(h.hiddenTruth)
  })

  it('pov = npc mà không có actorId thì báo rõ', async () => {
    const h = await harness()
    await expect(h.call('rp_export', { sceneId: h.sceneId, pov: 'npc' })).rejects.toThrow(/cần actorId/)
    await expect(h.call('rp_export', { sceneId: h.sceneId, pov: 'npc', actorId: 'npc_ma' })).rejects.toThrow(/Không có actor/)
  })
})

describe('rp_write — truyện ngắn từ hồ sơ', () => {
  it('viết POV1, lưu file có front matter, và trả nội dung vì POV1 an toàn để người chơi đọc', async () => {
    const h = await harness()
    const result = await h.call('rp_write', { sceneId: h.sceneId, view: 'player', length: 'short', style: 'sparse' })

    expect(result['ok']).toBe(true)
    expect(result['guard']).toBe('pass')
    expect(result['title']).toBe('Ngưỡng cửa')
    expect(String(result['body'])).toContain('Quản gia đứng ở ngưỡng cửa')

    const stories = result['stories'] as Array<Record<string, unknown>>
    const file = String(stories[0]?.['path'])
    expect(file).toBe(path.join(storyDirOf(h.root, h.sceneId), 'player.md'))
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('guard: không có chuỗi rò rỉ ngoài góc nhìn')
    expect(text).toContain('length: short')
    expect(text).toContain('style: sparse')
    expect(text).toContain('# Ngưỡng cửa')
    expect(text).toContain('## Chi tiết người viết tự thêm')
    expect(Number(stories[0]?.['words'])).toBe(wordCount(WRITER_BODY))
  })

  it('prompt gửi cho writer POV1 sạch theo góc nhìn, và có đủ brief', async () => {
    const h = await harness()
    await h.call('rp_write', { sceneId: h.sceneId, view: 'player', length: 'long', style: 'noir', focus: 'tập trung vào quản gia', omit: ['mechanics', 'bỏ cảnh người chơi lúng túng'] })

    const writerRequest = h.requests.find(request => String(request.label ?? '').startsWith('writer:'))
    const prompt = String((writerRequest?.prompt as Array<{ text?: string }> | undefined)?.[0]?.text ?? '')
    expect(prompt).not.toBe('')
    expect(prompt).not.toContain(h.hiddenTruth)
    expect(prompt).not.toContain('kế hoạch bí mật')
    expect(prompt).toContain('khoảng 4000 từ')
    expect(prompt).toContain('lạnh và nghi ngờ')
    expect(prompt).toContain('tập trung vào quản gia')
    expect(prompt).toContain('bỏ cảnh người chơi lúng túng')
    // Chốt chặn provider vẫn được áp như tầng actor.
    expect(writerRequest?.toolFilter).toEqual({ allow: [] })
    expect(writerRequest?.outputSchema).toBeDefined()
    expect(writerRequest?.persona).toContain('truyện ngắn')
  })

  it('truyện rò rỉ thì KHÔNG được ghi ra đĩa', async () => {
    const h = await harness()
    const leaked = { title: 'Rò rỉ', body: `Trời tối. ${h.hiddenTruth} Và thế là hết.`, notes: [] }
    const result = await h.call('rp_write', { sceneId: h.sceneId, view: 'player' })

    // Lần gọi đầu dùng payload sạch nên phải thành công — kiểm riêng ca rò rỉ bằng harness thứ hai.
    expect(result['ok']).toBe(true)
    const leakHarness = await harness({ writerPayload: leaked })
    const leakResult = await leakHarness.call('rp_write', { sceneId: leakHarness.sceneId, view: 'player' })

    expect(leakResult['ok']).toBe(false)
    expect(leakResult['guard']).toBe('violation')
    expect((leakResult['issues'] as string[]).join(' ')).toMatch(/rò rỉ/)
    expect(fs.existsSync(path.join(storyDirOf(leakHarness.root, leakHarness.sceneId), 'player.md'))).toBe(false)
  })

  it('POV2 nhận được bí mật trong hồ sơ, nhưng KHÔNG trả nội dung về kết quả tool nếu chưa cho phép', async () => {
    const h = await harness()
    const hidden = await h.call('rp_write', { sceneId: h.sceneId, view: 'kami' })
    expect(hidden['ok']).toBe(true)
    expect(hidden['body']).toBeUndefined()

    const writerRequest = h.requests.find(request => String(request.label ?? '') === 'writer:kami')
    const prompt = String((writerRequest?.prompt as Array<{ text?: string }> | undefined)?.[0]?.text ?? '')
    expect(prompt).toContain(h.hiddenTruth)
  })

  it('reveal = true thì trả nội dung về, vì người chơi đã đồng ý có spoil', async () => {
    const h = await harness()
    const revealed = await h.call('rp_write', { sceneId: h.sceneId, view: 'kami', reveal: true })
    expect(String(revealed['body'])).toContain('Quản gia đứng ở ngưỡng cửa')
  })

  it('POV3 cần actorId hợp lệ, và file ghi theo tên actor', async () => {
    const h = await harness()
    await expect(h.call('rp_write', { sceneId: h.sceneId, view: 'npc' })).rejects.toThrow(/cần actorId/)
    await expect(h.call('rp_write', { sceneId: h.sceneId, view: 'npc', actorId: 'npc_ghost' })).rejects.toThrow(/Không có actor/)

    const result = await h.call('rp_write', { sceneId: h.sceneId, view: 'npc', actorId: 'npc_butler' })
    expect(result['ok']).toBe(true)
    expect(fs.existsSync(path.join(storyDirOf(h.root, h.sceneId), 'npc-npc_butler.md'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain(h.hiddenTruth)
  })

  it('allViews viết song song POV1 + POV2 + POV3 cho từng actor', async () => {
    const h = await harness()
    const result = await h.call('rp_write', { sceneId: h.sceneId, view: 'player', allViews: true, length: 'short' })
    const views = (result['stories'] as Array<Record<string, unknown>>).map(story => story['view'])
    expect(views).toEqual(['player', 'kami', 'npc'])
    expect(h.requests.filter(request => String(request.label ?? '').startsWith('writer:')).length).toBe(3)
  })

  it('chưa có lượt nào thì từ chối viết', async () => {
    const root = tempDir()
    const pool = path.join(root, 'roleplay-machine', 'pool')
    for (const card of makeRichPool() as Card[]) writeCard(pool, card)
    const tools = createRpTools({ workspaceRoot: () => root, subagents: fakeRuntime() })
    const created = (await tools.find(tool => tool.name === 'rp_new_scene')!.execute({ mode: 'boss_mode', seed: 'empty' }, { agent: { id: 's' } })) as { sceneId: string }
    const write = tools.find(tool => tool.name === 'rp_write')!
    await expect(write.execute({ sceneId: created.sceneId, view: 'player' }, { agent: { id: 's' } })).rejects.toThrow(/chưa có lượt nào/)
  })
})

describe('kế hoạch viết và adapter writer', () => {
  it('planWriterRequests chặn trần actor trong allViews', () => {
    const cast = Array.from({ length: 6 }, (_, index) => ({
      id: `npc_${index}`, kind: 'npc' as const, name: `N${index}`, role: '', personality: {}, goals: [],
      allowedKnowledge: ['biết gì đó'], initialBeliefs: [], traits: {}, location: 'x', perceive: ['same_room' as const], act: [],
    }))
    expect(planWriterRequests({ allViews: true }, cast).map(request => request.pov)).toEqual(['player', 'kami', 'npc', 'npc', 'npc'])
    expect(planWriterRequests({ view: 'kami' }, cast)).toEqual([{ pov: 'kami' }])
    expect(() => planWriterRequests({ view: 'npc' }, cast)).toThrow(/cần actorId/)
    expect(() => planWriterRequests({ view: 'view lạ' }, cast)).toThrow(/view không hợp lệ/)
  })

  it('parseWriterOutput hạ cấp an toàn, không ném', () => {
    expect(parseWriterOutput({ title: 'A', body: 'x'.repeat(300) }).output?.title).toBe('A')
    expect(parseWriterOutput({ title: 'A', body: 'ngắn' }).issues.join(' ')).toMatch(/quá ngắn/)
    expect(parseWriterOutput({ title: 'A' }).output).toBeUndefined()
    expect(parseWriterOutput('không phải json').output).toBeUndefined()
    expect(parseWriterOutput({ title: '', body: 'y'.repeat(250) }).output?.title).toBe('(không tiêu đề)')
    expect(parseWriterOutput({ title: 'A', body: 'z'.repeat(300), notes: ['a', 2, ' '] }).output?.notes).toEqual(['a'])
  })

  it('runner thật từ chối nguyên liệu rò rỉ TRƯỚC khi gọi model', async () => {
    let started = 0
    const runner = createSpawnWriterRunner({
      subagents: {
        getProvider: () => ({
          name: 'spawn',
          inheritsParentContext: false,
          capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        }),
        start: async () => { started++; return { result: Promise.resolve({}), dispose: async () => {} } },
      },
    })
    const forbidden = [{ text: 'Sự thật bị niêm phong dài dòng', source: 'sealed', classification: 'sealed' as const }]
    await expect(runner.run({ pov: 'player', label: 'writer:player', prompt: 'có Sự thật bị niêm phong dài dòng trong này', forbidden }))
      .rejects.toThrow(PovViolation)
    expect(started).toBe(0)
  })

  it('runner thật gửi đúng yêu cầu: spawn, toolFilter rỗng, outputSchema, persona', async () => {
    const seen: SubagentStartRequestLike[] = []
    const runner = createSpawnWriterRunner({
      subagents: {
        getProvider: () => ({
          name: 'spawn',
          inheritsParentContext: false,
          capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        }),
        start: async (_name, request) => {
          seen.push(request)
          return { result: Promise.resolve({ structured: { title: 'T', body: 'b'.repeat(300), notes: ['n'] } }), dispose: async () => {} }
        },
      },
    })
    const outcome = await runner.run({ pov: 'kami', label: 'writer:kami', prompt: 'hồ sơ', forbidden: [] })
    expect(outcome.output?.title).toBe('T')
    expect(seen[0]?.toolFilter).toEqual({ allow: [] })
    expect(seen[0]?.persona).toContain('thế giới')
    expect(seen[0]?.label).toBe('writer:kami')
  })

  it('runner giả cho test trả đúng output đã định', async () => {
    const captured: WriterRunInput[] = []
    const runner = createScriptedWriterRunner({ title: 'X', body: 'y'.repeat(250), notes: [] }, { onRun: input => captured.push(input) })
    const outcome = await runner.run({ pov: 'player', label: 'w', prompt: 'p', forbidden: [] })
    expect(outcome.output?.title).toBe('X')
    expect(captured).toHaveLength(1)
  })

  it('guard và material phối hợp đúng: bí mật cấm với POV1, cho phép với POV2', async () => {
    const h = await harness()
    const snapshot = loadActorSnapshot(h.root, h.sceneId)
    const { loadScene } = await import('../src/scene')
    const scene = loadScene(h.root, h.sceneId)!
    const turns = loadStoryTurns(h.root, h.sceneId)
    const exp = (await import('../src/story/export')).buildStoryExport({
      sceneId: h.sceneId, generatedAt: 'now', turns, scene, definitions: snapshot?.cast,
    })
    const material = renderMaterial(exp, 'player')
    const forbidden = povForbidden({ pov: 'player', scene, definitions: snapshot?.cast, turns, material })

    expect(() => assertPovSafe(`truyện có ${h.hiddenTruth}`, forbidden, 'player')).toThrow(PovViolation)
    expect(() => assertPovSafe('truyện sạch', forbidden, 'player')).not.toThrow()
  })

  it('renderWriterPrompt nhắc đúng luật bất biến và không tự thêm canon', async () => {
    const h = await harness()
    const { loadScene } = await import('../src/scene')
    const scene = loadScene(h.root, h.sceneId)!
    const snapshot = loadActorSnapshot(h.root, h.sceneId)
    const turns = loadStoryTurns(h.root, h.sceneId)
    const exp = (await import('../src/story/export')).buildStoryExport({ sceneId: h.sceneId, generatedAt: 'now', turns, scene, definitions: snapshot?.cast })
    const prompt = renderWriterPrompt({ exp, brief: { pov: 'player', length: 'medium', style: 'plain' }, definitions: snapshot?.cast })
    expect(prompt).toContain('Không thêm sự kiện, nhân vật, địa điểm, hay quan hệ mới')
    expect(prompt).toContain('có thể SAI so với sự thật')
    expect(prompt).toContain('notes')
  })
})
