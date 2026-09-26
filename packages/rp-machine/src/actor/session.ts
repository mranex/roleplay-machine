/**
 * Cầu nối tới `ctx.subagents` của DSH — chỗ biến "một actor" thành "một subagent thật".
 *
 * Đây là ranh giới nguy hiểm nhất của Multi-Actor-Agent Mode, vì nó là nơi duy nhất có thể vô hiệu hoá
 * cô lập thông tin bằng một tham số sai. Nên nó có ba chốt chặn cứng, và cả ba đều **từ chối chạy**
 * thay vì chạy ở chế độ suy giảm:
 *
 *  1. Provider phải có capability `toolFilter` — nếu không, actor có thể mang theo tool đọc file và
 *     đọc thẳng pool card, kể cả `hidden_truth`.
 *  2. Yêu cầu luôn kèm `toolFilter: { allow: [] }` — xoá sạch mọi tool toàn cục. Tool scoped của chính
 *     con (ví dụ `structured_output` do host cài riêng) vẫn còn, nên nó vẫn trả được kết quả.
 *  3. Provider KHÔNG được `inheritsParentContext` — provider `fork` chép nguyên hội thoại cha vào con,
 *     nghĩa là actor đọc được cả bí mật lẫn lời kể. Chỉ provider kiểu `spawn` mới dùng được.
 *
 * Toàn bộ giao diện dưới đây là khai báo cấu trúc hẹp (structural), không import type từ gói DSH: plugin
 * vẫn cài được trên nhiều bản dsh khác nhau, và bản chất hợp đồng vẫn kiểm được bằng test.
 */

import {
  ACTOR_OUTPUT_SCHEMA,
  actorPersona,
  assertIsolated,
  parseActorOutput,
  type ActorOutput,
  type ActorPayload,
} from './payload'
import type { ActorDefinition } from './model'

// ── Khai báo cấu trúc hẹp của service subagents ────────────────────────────

export interface ContentBlockLike {
  readonly type: string
  readonly text?: string
}

export interface SubagentCapabilitiesLike {
  readonly agentOptions: boolean
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}

export interface SubagentProviderLike {
  readonly name: string
  readonly capabilities: SubagentCapabilitiesLike
  readonly inheritsParentContext: boolean
}

export interface SubagentResultLike {
  readonly output?: readonly ContentBlockLike[]
  readonly structured?: unknown
  readonly stopReason?: string
  readonly diagnostic?: string
}

export interface SubagentRunLike {
  readonly id?: string
  readonly result: Promise<SubagentResultLike>
  dispose(): Promise<void>
}

export interface SubagentStartRequestLike {
  readonly label?: string
  readonly prompt: readonly ContentBlockLike[]
  readonly parent: unknown
  readonly signal: AbortSignal
  readonly outputSchema?: Record<string, unknown>
  readonly toolFilter?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }
  readonly persona?: string
}

export interface SubagentRuntimeLike {
  start(name: string, request: SubagentStartRequestLike): Promise<SubagentRunLike>
  getProvider?(name: string): SubagentProviderLike | undefined
}

// ── Hợp đồng của một lần chạy actor ───────────────────────────────────────

export interface ActorRunInput {
  readonly definition: ActorDefinition
  readonly payload: ActorPayload
  readonly prompt: string
  readonly turn: number
  /**
   * Chuỗi KHÔNG được xuất hiện trong prompt, do tầng pipeline dựng từ world + định nghĩa actor.
   * Runner chỉ kiểm, không tự suy ra — nếu để runner tự dựng thì nó phải đọc world, mà đó lại là
   * đường rò rỉ.
   */
  readonly forbidden?: readonly string[]
}

export interface ActorRunOutcome {
  readonly output?: ActorOutput
  readonly issues: readonly string[]
}

export interface ActorRunner {
  run(input: ActorRunInput): Promise<ActorRunOutcome>
}

/** Lỗi cấu hình: không chạy được actor đúng cách thì không chạy actor. */
export class ActorWiringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActorWiringError'
  }
}

export const DEFAULT_ACTOR_TIMEOUT_MS = 120_000

export function textOfBlocks(blocks: readonly ContentBlockLike[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
    .trim()
}

/** Rút object JSON ra khỏi text thô, dùng khi provider không hỗ trợ `outputSchema`. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

export interface SpawnActorRunnerOptions {
  readonly subagents: SubagentRuntimeLike | undefined
  /** Provider của DSH. Mặc định `spawn` — TUYỆT ĐỐI không đổi sang `fork`. */
  readonly providerName?: string
  /** Agent cha (`exec.agent` trong thân tool). */
  readonly parent?: unknown
  readonly timeoutMs?: number
  /** Bật chốt chặn `assertIsolated` trước khi gửi. Mặc định bật. */
  readonly checkIsolation?: boolean
  readonly log?: (message: string) => void
}

/** Kiểm provider trước khi gửi. Ném `ActorWiringError` nếu không bảo đảm được cô lập. */
export function inspectActorProvider(
  runtime: SubagentRuntimeLike | undefined,
  providerName: string,
): { provider?: SubagentProviderLike; warnings: string[] } {
  if (runtime === undefined) {
    throw new ActorWiringError(
      'Host không có service `subagents` — không thể chạy Multi-Actor-Agent Mode. Cần nạp bundle subagent (ví dụ subagent-spawn-in-process).',
    )
  }
  const provider = runtime.getProvider?.(providerName)
  if (provider === undefined) {
    // Bản dsh không có `getProvider`: không tra được, để chính `start` từ chối nếu thiếu capability.
    return { warnings: [] }
  }
  if (provider.inheritsParentContext) {
    throw new ActorWiringError(
      `Provider "${providerName}" kế thừa ngữ cảnh cha (inheritsParentContext) — actor sẽ đọc được toàn bộ hội thoại, gồm cả sự thật bị niêm phong. Chỉ dùng provider kiểu "spawn".`,
    )
  }
  if (!provider.capabilities.toolFilter) {
    throw new ActorWiringError(
      `Provider "${providerName}" không hỗ trợ toolFilter — không xoá được tool của actor, nên không bảo đảm được cô lập thông tin. Từ chối chạy.`,
    )
  }
  const warnings: string[] = []
  if (!provider.capabilities.outputSchema) {
    warnings.push(`Provider "${providerName}" không hỗ trợ outputSchema — phải đọc JSON từ text thô.`)
  }
  if (!provider.capabilities.persona) {
    warnings.push(`Provider "${providerName}" không hỗ trợ persona — actor sẽ mang persona của deployment.`)
  }
  return { provider, warnings }
}

/**
 * Runner thật: mỗi lần gọi là một subagent `spawn` một lượt, xong thì dispose.
 *
 * Vì sao một lượt rồi bỏ, thay vì giữ session sống: xem `docs/multi-actor.md` — ký ức của actor do
 * plugin sở hữu (`ActorState.memory`), nên một session sống sẽ thành nguồn sự thật thứ hai. Một session
 * mới mỗi lượt giữ đúng một nguồn, và giữ được bất biến "payload là tất cả những gì actor thấy".
 */
export function createSpawnActorRunner(options: SpawnActorRunnerOptions): ActorRunner {
  const providerName = options.providerName ?? 'spawn'
  const timeoutMs = options.timeoutMs ?? DEFAULT_ACTOR_TIMEOUT_MS
  const checkIsolation = options.checkIsolation !== false

  return {
    async run(input: ActorRunInput): Promise<ActorRunOutcome> {
      const issues: string[] = []
      const { provider, warnings } = inspectActorProvider(options.subagents, providerName)
      issues.push(...warnings)
      for (const warning of warnings) options.log?.(warning)

      if (checkIsolation && input.forbidden !== undefined) {
        // Chốt chặn có răng: chuỗi cấm lọt vào prompt thì ném lỗi, không gửi đi.
        assertIsolated(input.prompt, input.forbidden)
      }

      const supportsSchema = provider?.capabilities.outputSchema ?? true
      const supportsPersona = provider?.capabilities.persona ?? true

      const controller = new AbortController()
      const timer = timeoutMs > 0
        ? setTimeout(() => controller.abort(`actor ${input.definition.id} quá hạn ${timeoutMs}ms`), timeoutMs)
        : undefined

      let run: SubagentRunLike | undefined
      try {
        run = await options.subagents!.start(providerName, {
          label: `actor:${input.definition.id}`,
          prompt: [{ type: 'text', text: input.prompt }],
          parent: options.parent,
          signal: controller.signal,
          // Xoá sạch tool toàn cục: actor không đọc được file, không gọi được tool roleplay.
          toolFilter: { allow: [] },
          ...(supportsSchema ? { outputSchema: ACTOR_OUTPUT_SCHEMA } : {}),
          ...(supportsPersona ? { persona: actorPersona(input.definition) } : {}),
        })
        const result = await run.result

        if (result.stopReason !== undefined && result.stopReason !== 'completed') {
          issues.push(
            `Actor ${input.definition.id} kết thúc bất thường: ${result.stopReason}${
              result.diagnostic === undefined ? '' : ` (${result.diagnostic})`
            }`,
          )
        }

        // Ưu tiên `structured`; nếu provider không hỗ trợ thì đọc JSON từ text thô, và nếu vẫn không có
        // thì `parseActorOutput` hạ cấp về `wait` — actor hỏng không được làm hỏng lượt chơi.
        const text = textOfBlocks(result.output)
        const raw = result.structured ?? (text === '' ? undefined : extractJson(text) ?? text)
        const parsed = parseActorOutput(raw, input.definition.id)
        return {
          ...(parsed.output === undefined ? {} : { output: parsed.output }),
          issues: [...issues, ...parsed.issues.map(issue => `${issue.where}: ${issue.message}`)],
        }
      } catch (error) {
        issues.push(`Actor ${input.definition.id} lỗi: ${error instanceof Error ? error.message : String(error)}`)
        return { issues }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        if (run !== undefined) {
          try {
            await run.dispose()
          } catch {
            /* dispose idempotent */
          }
        }
      }
    },
  }
}

/** Runner giả cho test: trả đúng output đã định, không gọi model. */
export function createScriptedActorRunner(
  script: Readonly<Record<string, ActorOutput | ((input: ActorRunInput) => ActorOutput | undefined)>>,
  options?: { readonly onRun?: (input: ActorRunInput) => void },
): ActorRunner {
  return {
    async run(input: ActorRunInput): Promise<ActorRunOutcome> {
      options?.onRun?.(input)
      const entry = script[input.definition.id]
      const output = typeof entry === 'function' ? entry(input) : entry
      return output === undefined ? { issues: [`không có output cho ${input.definition.id}`] } : { output, issues: [] }
    },
  }
}
