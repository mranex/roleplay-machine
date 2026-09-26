/**
 * Roleplay Machine — điểm vào plugin DSH (Cordis bundle).
 *
 * Việc plugin làm:
 *  1. Gắn skill đi kèm gói (quy trình GM, tạo card, lắp thế giới).
 *  2. Nhận workspace của phiên để biết pool và runs nằm ở đâu.
 *  3. Đăng ký bộ tool roleplay (rút card, niêm phong thẻ ẩn, lượt, OOC, kết ván).
 *  4. Gắn kênh bí mật vào systemPrompt của từng agent.
 *
 * Chỉ tiêu thị trường host được khai báo hẹp (systemPrompt, workspaceRegistry, agents,
 * tools, skills) để không khoá cứng vào một bản dsh cụ thể.
 */

import type { Context } from '@deepseek-ai/cordis'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRpTools, RP_TOOL_NAMES, type AgentLike } from './tools-scene'
import { attachRunContext, isTopLevelAgent } from './prompt'
import type { SubagentRuntimeLike } from './actor/session'
import { createWebApiRoute, RP_API_PREFIX, type WebServerLike } from './web-api'

export const name = 'rp-machine'

/**
 * Chẩn đoán opt-in: đặt `RP_APPLY_LOG=<đường dẫn file>` để ghi lại các mốc trong `apply`.
 *
 * Vì sao cần: khi plugin không activate (ví dụ do cấu hình profile sai), DSH chỉ in URL khởi động và
 * không nói gì thêm; không có kênh nào để biết `apply` đã chạy tới đâu. Biến môi trường này bật một
 * file log nhỏ, tắt mặc định nên không ảnh hưởng vận hành bình thường.
 */
function probe(message: string): void {
  const file = process.env['RP_APPLY_LOG']
  if (file === undefined || file === '') return
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    /* chẩn đoán không được làm hỏng khởi động */
  }
}

export { RP_TOOL_NAMES }
export { createRpTools } from './tools-scene'
export { handleRpApi, createWebApiRoute, MASKED_TEXT, RP_API_PREFIX, toCardView } from './web-api'
export * from './card-schema'
export * from './compatibility'
export * from './scene'
export * from './runtime'
export { runActorTurn, renderActorGmText, loadActorSnapshot, saveActorSnapshot, activeActorText, ACTOR_SNAPSHOT_VERSION } from './actor/turn'
export { createSpawnActorRunner, createScriptedActorRunner, ActorWiringError, inspectActorProvider } from './actor/session'
export { parseActorSetup, setupIsUsable } from './actor/setup'

// ── Phạm vi làm việc ───────────────────────────────────────────────────────

interface WorkspaceState {
  root: string | undefined
  isFallback: boolean
}

const workspaceState: WorkspaceState = { root: undefined, isFallback: false }

export function currentWorkspaceRoot(): string | undefined {
  return workspaceState.root
}

export function registerWorkspaceRoot(root: string): void {
  workspaceState.root = path.resolve(root)
  workspaceState.isFallback = false
}

function registerFallbackRoot(root: string): void {
  workspaceState.root = path.resolve(root)
  workspaceState.isFallback = true
}

export function resetWorkspaceRoot(): void {
  workspaceState.root = undefined
  workspaceState.isFallback = false
}

/** Gốc workspace theo phiên: cwd của agent trước, giá trị đã nhận sau. */
export function workspaceRootOf(agent?: AgentLike): string | undefined {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') return path.resolve(cwd)
  return currentWorkspaceRoot()
}

// ── Tiện ích host surface hẹp ──────────────────────────────────────────────

function ctxGet<T>(ctx: Context, key: string): T | undefined {
  const direct = (ctx as unknown as Record<string, unknown>)[key]
  if (direct !== undefined) return direct as T
  const get = (ctx as { get?: (n: string) => unknown }).get
  if (typeof get === 'function') {
    try {
      return get.call(ctx, key) as T
    } catch {
      return undefined
    }
  }
  return undefined
}

interface ReactiveHost {
  inject?: (deps: readonly string[], setup: (scope: unknown) => void) => { dispose?: () => unknown } | undefined
  effect?: (execute: () => unknown, label?: string) => unknown
  on?: (event: string, listener: (...args: never[]) => unknown) => unknown
  logger?: { info: (m: string) => void; warn: (m: string) => void }
}

function withServices(
  ctx: Context,
  deps: readonly string[],
  setup: (scope: Context) => void,
): { reactive: boolean; fiber?: { dispose?: () => unknown } } {
  const host = ctx as unknown as ReactiveHost
  if (typeof host.inject !== 'function') return { reactive: false }
  try {
    const fiber = host.inject(deps, scope => { setup((scope ?? ctx) as Context) })
    return { reactive: true, fiber: fiber ?? undefined }
  } catch {
    return { reactive: false }
  }
}

function step(ctx: Context, label: string, execute: () => void | (() => void)): void {
  const host = ctx as unknown as ReactiveHost
  if (typeof host.effect !== 'function') {
    execute()
    return
  }
  host.effect(() => {
    const undo = execute()
    return typeof undo === 'function' ? undo : () => {}
  }, label)
}

/** Sinh runId không cần host: plugin không tự tạo ván, tool mới tạo. */

export function apply(ctx: Context): void {
  probe('apply:start')
  ctx.logger.info('Đã tải Roleplay Machine (rp-machine)')

  /**
   * Service `subagents` lấy từ scope đã `inject`, giữ lại để tool dùng **lúc gọi**.
   *
   * Vì sao không đọc thẳng `ctx.subagents` trong thân tool: Cordis chỉ expose service đã inject, và truy
   * cập một tên chưa inject thì **ném lỗi** — đúng lỗi `cannot get property "subagents" without inject`
   * gặp trong DSH thật. Vì sao không gộp `subagents` vào `inject` của bước đăng ký tool: profile không có
   * subagent thì bước đó không chạy, và **toàn bộ** tool roleplay biến mất. Tách ra thì thiếu subagent chỉ
   * làm actor mode từ chối chạy, phần chơi thường vẫn nguyên.
   */
  const subagents: { current?: SubagentRuntimeLike } = {}

  // 1. Skill đi kèm gói: quy trình GM, tạo card, lắp thế giới.
  const skillDir = fileURLToPath(new URL('../skills/', import.meta.url))
  if (typeof ctx.inject !== 'function' || typeof ctx.plugin !== 'function') {
    ctx.logger.warn('[rp-machine] Host thiếu inject/plugin — bỏ qua skill đi kèm.')
  } else if (!fs.existsSync(skillDir)) {
    ctx.logger.warn(`[rp-machine] Gói cài đặt thiếu thư mục skills: ${skillDir}`)
  } else {
    try {
      ctx.inject(['skills'], scope => {
        ;(scope as unknown as { plugin: (p: unknown, o: unknown) => void }).plugin(skillFilesystem, {
          providerName: 'rp-machine',
          includeDefaultRoots: false,
          bundledSkillDir: skillDir,
        })
      })
    } catch (error) {
      ctx.logger.warn(`[rp-machine] Chưa gắn được bundled skills: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  probe('skills:done')

  // 2. Nhận phạm vi làm việc (workspaceRegistry, có thể tới muộn) + fallback cwd.
  step(ctx, 'rp-machine:workspace', () => {
    let claimed: string | undefined
    const claimedRoot = (registry: { readonly list?: () => ReadonlyArray<unknown> } | undefined): string | undefined => {
      if (registry === undefined || typeof registry.list !== 'function') return undefined
      let entries: ReadonlyArray<unknown> = []
      try {
        entries = registry.list()
      } catch {
        entries = []
      }
      const first = entries[0] as { readonly path?: string } | undefined
      if (first === undefined || typeof first.path !== 'string' || first.path === '') return undefined
      registerWorkspaceRoot(first.path)
      return currentWorkspaceRoot()
    }
    const reg = withServices(ctx, ['workspaceRegistry'], scope => {
      claimed = claimedRoot(ctxGet(scope, 'workspaceRegistry'))
    })
    if (!reg.reactive) claimed = claimedRoot(ctxGet(ctx, 'workspaceRegistry'))
    if (currentWorkspaceRoot() === undefined) {
      try {
        claimed = registerFallbackCwd()
      } catch {
        /* headless không có cwd cũng không sao: tool sẽ báo lỗi rõ ràng */
      }
    }
    return () => {
      if (claimed !== undefined && currentWorkspaceRoot() === claimed) resetWorkspaceRoot()
      void reg.fiber?.dispose?.()
    }
  })

  probe('workspace:done')

  // 3. Đăng ký tool (đăng ký toàn cục: MVP ưu tiên ít lỗi hơn scoped-per-agent).
  step(ctx, 'rp-machine:tools', () => {
    const offs: Array<() => void> = []
    const register = (scope: Context): void => {
      if (offs.length > 0) return
      const runtime = ctxGet<{ register: (definition: unknown) => unknown }>(scope, 'tools')
      if (runtime === undefined || typeof runtime.register !== 'function') return
      const kit = createRpTools({
        workspaceRoot: agent => workspaceRootOf(agent),
        // Actor mode cần service subagents. Tra qua holder (đã inject ở bước riêng), không đọc thẳng ctx.
        subagents: {
          start: (name, request) => {
            const service = subagents.current
            if (service === undefined) {
              throw new Error('[rp-machine] Host chưa nạp service `subagents` — không chạy được Multi-Actor-Agent Mode.')
            }
            return service.start(name, request)
          },
          getProvider: name => subagents.current?.getProvider?.(name),
        },
        actorProvider: process.env['RP_ACTOR_PROVIDER'],
        log: message => ctx.logger.info(message),
      })
      for (const tool of kit) {
        const off = runtime.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          output: tool.output,
          execute: (args: unknown, exec: unknown) => tool.execute(args as Record<string, unknown>, exec as never),
        })
        if (typeof off === 'function') offs.push(off as () => void)
      }
      ctx.logger.info(`[rp-machine] Đã đăng ký ${kit.length} tool roleplay.`)
    }
    const reg = withServices(ctx, ['tools'], register)
    if (!reg.reactive) register(ctx)
    return () => {
      for (const off of offs.reverse()) {
        try {
          off()
        } catch {
          /* idempotent */
        }
      }
      void reg.fiber?.dispose?.()
    }
  })

  probe('tools:done')

  // 3b. Giữ service `subagents` của host (có thể mount muộn) cho actor mode. Đăng ký riêng khỏi bước tool
  //     để profile không có subagent vẫn giữ được đủ bộ tool.
  step(ctx, 'rp-machine:subagents', () => {
    const capture = (scope: Context): void => {
      const service = ctxGet<SubagentRuntimeLike>(scope, 'subagents')
      if (service !== undefined) subagents.current = service
    }
    const reg = withServices(ctx, ['subagents'], capture)
    if (!reg.reactive) capture(ctx)
    return () => {
      subagents.current = undefined
      void reg.fiber?.dispose?.()
    }
  })

  probe('subagents:done')

  // 4. Gắn kênh bí mật vào từng agent (systemPrompt là scoped theo agent).
  step(ctx, 'rp-machine:agents', () => {
    const host = ctx as unknown as ReactiveHost
    const attached = new Map<string, () => void | Promise<void>>()
    const detach = (id: string): void => {
      const off = attached.get(id)
      attached.delete(id)
      if (off !== undefined) {
        try {
          void Promise.resolve(off()).catch(() => {})
        } catch {
          /* idempotent */
        }
      }
    }
    const attach = (agent: AgentLike & { readonly ctx?: Context }): void => {
      if (agent.ctx === undefined) return
      // Actor (và mọi subagent) KHÔNG được nhận khung GM: khung đó chứa hiddenTruth.
      if (!isTopLevelAgent(agent)) return
      const id = agent.id ?? ''
      if (id !== '' && attached.has(id)) return
      const off = attachRunContext(agent.ctx, { workspaceRoot: () => workspaceRootOf(agent) }, { logger: ctx.logger })
      if (off !== undefined && id !== '') attached.set(id, off)
    }
    const subscriptions: Array<() => void> = []
    if (typeof host.on === 'function') {
      const offCreated = host.on('agent/created', ((payload: { readonly agent?: AgentLike & { ctx?: Context } }) => {
        if (payload?.agent !== undefined) attach(payload.agent)
      }) as never)
      if (typeof offCreated === 'function') subscriptions.push(offCreated as () => void)
      const offDisposed = host.on('agent/disposed', ((payload: { readonly agent?: AgentLike }) => {
        const id = payload?.agent?.id
        if (typeof id === 'string') detach(id)
      }) as never)
      if (typeof offDisposed === 'function') subscriptions.push(offDisposed as () => void)
    }
    const attachExisting = (scope: Context): void => {
      const registry = ctxGet<{ list?: () => ReadonlyArray<AgentLike & { ctx?: Context }> }>(scope, 'agents')
      if (registry === undefined || typeof registry.list !== 'function') return
      for (const agent of registry.list()) attach(agent)
    }
    const reg = withServices(ctx, ['agents'], attachExisting)
    if (!reg.reactive) attachExisting(ctx)
    return () => {
      for (const off of subscriptions.reverse()) off()
      for (const id of [...attached.keys()]) detach(id)
      void reg.fiber?.dispose?.()
    }
  })

  probe('agents:done')

  // 5. API cho UI web. UI chạy trong trình duyệt nên không đọc được đĩa; nó gọi cùng origin tới
  //    `/rp-machine/api/<method>`. Route chỉ nhận request có header x-rp-request.
  step(ctx, 'rp-machine:web-api', () => {
    let off: (() => void) | undefined
    const attach = (scope: Context): void => {
      if (off !== undefined) return
      const server = ctxGet<WebServerLike>(scope, 'webServer')
      if (server === undefined || typeof server.register !== 'function') {
        probe('web-api:no-webServer-service')
        return
      }
      off = server.register(createWebApiRoute({ workspaceRoot: () => currentWorkspaceRoot() }))
      probe(`web-api:registered ${RP_API_PREFIX}`)
      ctx.logger.info(`[rp-machine] Đã mở API cho UI web tại ${RP_API_PREFIX}/.`)
    }
    const reg = withServices(ctx, ['webServer'], attach)
    if (!reg.reactive) attach(ctx)
    return () => {
      try {
        off?.()
      } catch {
        /* idempotent */
      }
      void reg.fiber?.dispose?.()
    }
  })

  probe('web-api:done')

  const root = currentWorkspaceRoot()
  if (root !== undefined) {
    ctx.logger.info(`[rp-machine] Phạm vi làm việc: ${root} (pool: ${path.join(root, 'roleplay-machine', 'pool')})`)
  }
  probe('apply:end')
}

function registerFallbackCwd(): string | undefined {
  if (workspaceState.root !== undefined) return undefined
  const cwd = process.cwd()
  if (cwd === '') return undefined
  registerFallbackRoot(cwd)
  return currentWorkspaceRoot()
}

export { registerFallbackCwd }
