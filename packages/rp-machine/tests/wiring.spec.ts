import { beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { apply, currentWorkspaceRoot, name, resetWorkspaceRoot, RP_TOOL_NAMES } from '../src/index'
import { ACTORS_CONTEXT, CONTRACT_SECTION, RUNTIME_CONTRACT, RUN_CONTEXT } from '../src/prompt'
import { writeCard, type Card } from '../src/card-schema'
import { makeRichPool } from './fixtures/cards'

interface RegisteredTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => unknown }
  readonly execute: (args: Record<string, unknown>, exec?: unknown) => Promise<unknown> | unknown
}

interface PromptEntry {
  readonly name: string
  readonly order: number
  readonly text: string | ((assemble: unknown) => string)
}

const NOW = '2026-01-01T00:00:00.000Z'

function setupWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-wiring-'))
  const pool = path.join(root, 'roleplay-machine', 'pool')
  for (const card of makeRichPool() as Card[]) writeCard(pool, card)
  return root
}

function makeHost(ws: string, options?: { readonly headless?: boolean; readonly withAgents?: boolean; readonly withSubagents?: boolean }) {
  const registered: RegisteredTool[] = []
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const sections: PromptEntry[] = []
  const contexts: PromptEntry[] = []
  const logs: string[] = []

  const fakeAgentCtx = {
    systemPrompt: {
      section: (entry: PromptEntry) => { sections.push(entry); return () => {} },
      context: (entry: PromptEntry) => { contexts.push(entry); return () => {} },
    },
    inject: (_deps: readonly string[], cb: (scope: unknown) => void) => { cb(fakeAgentCtx); return undefined },
  }
  const agent = { id: 'sess-1', ctx: fakeAgentCtx, session: { header: { id: 'sess-1', cwd: ws } } }

  // Provider giả: đủ capability để chốt chặn cấu hình cho qua, và trả output cố định.
  const subagents = {
    getProvider: () => ({
      name: 'spawn',
      inheritsParentContext: false,
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    }),
    start: async () => ({
      result: Promise.resolve({
        stopReason: 'completed',
        structured: {
          actor_id: 'npc_butler',
          interpretation: 'Người chơi vừa chào ta.',
          emotion: 'điềm tĩnh',
          intent_type: 'dialogue',
          intent_content: 'Dạ, thưa ngài.',
        },
      }),
      dispose: async () => {},
    }),
  }

  const host = {
    logger: { info: (message: string) => { logs.push(message) }, warn: (message: string) => { logs.push(message) } },
    get: (key: string): unknown => {
      if (key === 'tools') return { register: (definition: RegisteredTool) => { registered.push(definition); return () => {} } }
      if (key === 'agents') return options?.withAgents === false ? undefined : { list: () => [agent] }
      if (key === 'workspaceRegistry') return options?.headless === true ? undefined : { list: () => [{ path: ws }] }
      if (key === 'subagents') return options?.withSubagents === true ? subagents : undefined
      return undefined
    },
    inject: (_deps: readonly string[], cb: (scope: unknown) => void) => { cb(host); return undefined },
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return () => {}
    },
    plugin: () => {},
  }
  return { host, registered, sections, contexts, listeners, agent, logs, subagents }
}

/**
 * Host giả **trung thành với Cordis**: truy cập một service chưa inject thì ném lỗi, và `inject` truyền
 * cho callback một scope CÓ service đó.
 *
 * Đây là bản sao của lỗi gặp trong DSH thật: `cannot get property "subagents" without inject`. Host giả
 * kiểu dễ tính ở trên không bắt được lỗi này vì nó cho đọc thẳng mọi thứ.
 */
function makeStrictHost(ws: string) {
  const registered: RegisteredTool[] = []
  const logs: string[] = []
  const injected = new Set<string>()

  // Provider giả, khai báo đủ capability để chốt chặn cấu hình cho qua.
  const strictSubagents = {
    getProvider: () => ({
      name: 'spawn',
      inheritsParentContext: false,
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    }),
    start: async () => ({
      result: Promise.resolve({
        stopReason: 'completed',
        structured: { actor_id: 'npc_butler', interpretation: 'Người chơi vừa gõ cửa.', emotion: 'điềm tĩnh', intent_type: 'dialogue', intent_content: 'Dạ, tôi ra ngay.' },
      }),
      dispose: async () => {},
    }),
  }
  const host = {
    logger: { info: (message: string) => { logs.push(message) }, warn: (message: string) => { logs.push(message) } },
    get: (key: string): unknown => {
      // Cordis: service chưa inject thì đọc thẳng là ném lỗi, không trả undefined.
      if (key === 'tools' || key === 'subagents' || key === 'workspaceRegistry') {
        throw new Error(`cannot get property "${key}" without inject`)
      }
      return undefined
    },
    inject: (deps: readonly string[], cb: (scope: unknown) => void) => {
      for (const dep of deps) injected.add(dep)
      const scope: Record<string, unknown> = {}
      for (const dep of deps) {
        if (dep === 'tools') scope['tools'] = { register: (definition: RegisteredTool) => { registered.push(definition); return () => {} } }
        if (dep === 'subagents') scope['subagents'] = strictSubagents
        if (dep === 'workspaceRegistry') scope['workspaceRegistry'] = { list: () => [{ path: ws }] }
      }
      cb(scope)
      return () => {}
    },
    on: () => () => {},
    plugin: () => {},
  }
  return { host, registered, logs, injected }
}

beforeEach(() => {
  resetWorkspaceRoot()
})

describe('apply() trên host giả', () => {
  it('đăng ký đủ bộ tool mới', () => {
    const ws = setupWorkspace()
    const { host, registered } = makeHost(ws)
    apply(host as never)
    expect(registered.map(tool => tool.name)).toEqual([...RP_TOOL_NAMES])
    expect(registered).toHaveLength(15)
  })

  it('gắn bản giao kèo Thiên Đạo với hai trục luật', () => {
    const ws = setupWorkspace()
    const { host, sections } = makeHost(ws)
    apply(host as never)
    const contract = sections.find(section => section.name === CONTRACT_SECTION)
    expect(contract?.text).toBe(RUNTIME_CONTRACT)
    expect(RUNTIME_CONTRACT).toContain('KHÔNG ĐƯỢC TỰ ĐỊNH NGHĨA NHÂN VẬT CHÍNH')
    expect(RUNTIME_CONTRACT).toContain('THANH CĂNG THẲNG')
    expect(RUNTIME_CONTRACT).toContain('CẢNH CÁO OOC')
    expect(RUNTIME_CONTRACT).toContain('rp_turn')
  })

  it('kênh trạng thái nói rõ khi chưa có ván', () => {
    const ws = setupWorkspace()
    const { host, contexts } = makeHost(ws)
    apply(host as never)
    const entry = contexts.find(context => context.name === RUN_CONTEXT)
    const text = String(typeof entry?.text === 'function' ? entry.text({}) : entry?.text)
    expect(text).toContain('Chưa có ván nào')
  })

  it('kênh bí mật chở hiddenTruth tới GM ngay khi mở ván, còn tool output thì sạch', async () => {
    const ws = setupWorkspace()
    const { host, registered, contexts, agent } = makeHost(ws)
    apply(host as never)

    const call = async (toolName: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
      const tool = registered.find(entry => entry.name === toolName)
      if (tool === undefined) throw new Error(`thiếu tool ${toolName}`)
      return (await tool.execute(args, { agent })) as Record<string, unknown>
    }

    const created = await call('rp_new_scene', { mode: 'boss_mode', seed: 'wiring' })
    expect(created['ok']).toBe(true)

    const entry = contexts.find(context => context.name === RUN_CONTEXT)
    const gmText = String(typeof entry?.text === 'function' ? entry.text({}) : entry?.text)
    expect(gmText).toContain('HIỆP SĨ ĐANG TRỐN DƯỚI SÀN.')
    expect(gmText).toContain('Thiên Đạo')
    expect(gmText).toContain('GIỚI HẠN (player_role)')
    // Cùng lúc đó, output công khai của tool không được chứa bí mật.
    expect(JSON.stringify(created)).not.toContain('HIỆP SĨ ĐANG TRỐN DƯỚI SÀN.')
  })

  it('gắn kênh bí mật cho agent sinh ra sau (agent/created)', () => {
    const ws = setupWorkspace()
    const { host, listeners } = makeHost(ws, { withAgents: false })
    apply(host as never)
    const sections: PromptEntry[] = []
    const newCtx = {
      systemPrompt: {
        section: (entry: PromptEntry) => { sections.push(entry); return () => {} },
        context: () => () => {},
      },
      inject: (_deps: readonly string[], cb: (scope: unknown) => void) => { cb(newCtx); return undefined },
    }
    for (const listener of listeners.get('agent/created') ?? []) {
      listener({ agent: { id: 'sess-2', ctx: newCtx, session: { header: { cwd: ws } } } })
    }
    expect(sections.map(section => section.name)).toContain(CONTRACT_SECTION)
  })

  it('actor subagent KHÔNG nhận khung GM: nếu nhận thì nó đọc được hiddenTruth', () => {
    const ws = setupWorkspace()
    const { host, listeners } = makeHost(ws, { withAgents: false })
    apply(host as never)

    const sections: PromptEntry[] = []
    const actorCtx = {
      systemPrompt: {
        section: (entry: PromptEntry) => { sections.push(entry); return () => {} },
        context: (entry: PromptEntry) => { sections.push(entry); return () => {} },
      },
      inject: (_deps: readonly string[], cb: (scope: unknown) => void) => { cb(actorCtx); return undefined },
    }
    for (const listener of listeners.get('agent/created') ?? []) {
      // `origin: 'subagent'` là dấu hiệu DSH đặt cho mọi agent con, kể cả actor.
      listener({ agent: { id: 'actor-1', ctx: actorCtx, session: { header: { id: 'actor-1', cwd: ws, origin: 'subagent' } } } })
    }
    expect(sections).toEqual([])

    // Đối chứng: agent cấp cao nhất vẫn nhận đủ.
    const topCtx = {
      systemPrompt: {
        section: (entry: PromptEntry) => { sections.push(entry); return () => {} },
        context: (entry: PromptEntry) => { sections.push(entry); return () => {} },
      },
      inject: (_deps: readonly string[], cb: (scope: unknown) => void) => { cb(topCtx); return undefined },
    }
    for (const listener of listeners.get('agent/created') ?? []) {
      listener({ agent: { id: 'sess-3', ctx: topCtx, session: { header: { id: 'sess-3', cwd: ws } } } })
    }
    expect(sections.map(section => section.name)).toContain(CONTRACT_SECTION)
  })

  it('nhận phạm vi làm việc từ workspaceRegistry, và lui về cwd khi headless', () => {
    const ws = setupWorkspace()
    const withRegistry = makeHost(ws)
    apply(withRegistry.host as never)
    expect(currentWorkspaceRoot()).toBe(ws)

    resetWorkspaceRoot()
    const headless = makeHost(ws, { headless: true })
    apply(headless.host as never)
    expect(currentWorkspaceRoot()).toBe(process.cwd())
  })

  it('diễn biến riêng của actor đi qua kênh kín, không đi qua kết quả tool', async () => {
    const ws = setupWorkspace()
    const { host, registered, contexts, agent } = makeHost(ws, { withSubagents: true })
    apply(host as never)

    const call = async (toolName: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
      const tool = registered.find(entry => entry.name === toolName)
      if (tool === undefined) throw new Error(`thiếu tool ${toolName}`)
      return (await tool.execute(args, { agent })) as Record<string, unknown>
    }

    const created = await call('rp_new_scene', { mode: 'boss_mode', seed: 'actor-wiring' })
    const sceneId = String(created['sceneId'])
    const cast = await call('rp_actor_cast', {
      sceneId,
      cast: [
        {
          id: 'npc_butler',
          kind: 'npc',
          name: 'Quản gia',
          role: 'quản gia',
          location: 'kitchen',
          allowedKnowledge: ['Lâu đài này có một quản gia trung thành.'],
          perceive: ['same_room', 'addressed'],
          traits: { suspicion_player: 1 },
        },
      ],
      locations: { kitchen: { adjacent: ['pantry'] }, pantry: { adjacent: ['kitchen'] } },
      playerLocation: 'kitchen',
    })
    expect(cast['ok']).toBe(true)

    const turn = await call('rp_actor_turn', { sceneId, playerAction: 'Tôi chào quản gia.' })
    expect(turn['ok']).toBe(true)

    const entry = contexts.find(context => context.name === ACTORS_CONTEXT)
    const sealedText = String(typeof entry?.text === 'function' ? entry.text({}) : entry?.text)
    expect(sealedText).toContain('Người chơi vừa chào ta.')
    expect(sealedText).toContain('Diễn biến riêng')
    // Ngược lại, kết quả tool là thứ người chơi đọc được, nên không được chứa diễn biến riêng.
    expect(JSON.stringify(turn)).not.toContain('Người chơi vừa chào ta.')
  })

  it('đọc service subagents qua inject, không đọc thẳng ctx (bản sao lỗi gặp trong DSH thật)', async () => {
    const ws = setupWorkspace()
    const { host, registered, injected } = makeStrictHost(ws)
    apply(host as never)

    // Host kiểu Cordis: chưa inject thì đọc thẳng là ném lỗi, nên nếu plugin đọc sai chỗ, apply sẽ nổ.
    expect(injected.has('subagents')).toBe(true)
    expect(registered).toHaveLength(15)

    const call = async (toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const tool = registered.find(entry => entry.name === toolName)
      if (tool === undefined) throw new Error(`thiếu tool ${toolName}`)
      return (await tool.execute(args, { agent: { id: 'sess-strict' } })) as Record<string, unknown>
    }

    const created = await call('rp_new_scene', { mode: 'boss_mode', seed: 'strict' })
    const sceneId = String(created['sceneId'])
    await call('rp_actor_cast', {
      sceneId,
      cast: [
        {
          id: 'npc_butler',
          kind: 'npc',
          name: 'Quản gia',
          role: 'quản gia',
          location: 'kitchen',
          allowedKnowledge: ['Ta phục vụ lâu đài này.'],
          perceive: ['same_room', 'addressed'],
          traits: { suspicion_player: 1 },
        },
      ],
      locations: { kitchen: { adjacent: ['pantry'] }, pantry: { adjacent: ['kitchen'] } },
      playerLocation: 'kitchen',
    })

    const turn = await call('rp_actor_turn', { sceneId, playerAction: 'Tôi gõ cửa.' })
    expect(turn['ok']).toBe(true)
    expect(turn['issues']).toEqual([])
    expect(String(turn['frame'])).toContain('Dạ, tôi ra ngay.')
  })

  it('không có tools surface thì vẫn load, không nổ', () => {    const logs: string[] = []
    const host = {
      logger: { info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) },
      get: () => undefined,
      on: () => () => {},
    }
    expect(() => apply(host as never)).not.toThrow()
    expect(logs.some(message => message.includes('Đã tải Roleplay Machine'))).toBe(true)
  })

  it('tên plugin ổn định (dùng cho cordis.patch.yml)', () => {
    expect(name).toBe('rp-machine')
  })
})
