/**
 * Writer runner — cùng kỷ luật với tầng actor, áp cho người viết.
 *
 * Writer là subagent `spawn` với `toolFilter: { allow: [] }`: nó không đọc được file, không gọi được tool
 * nào, không kế thừa ngữ cảnh phiên. Toàn bộ những gì nó biết nằm trong prompt, và prompt được dựng từ
 * bản export đã cắt theo POV. Nhờ vậy câu chuyện POV1 **không thể** chứa thứ người chơi chưa từng biết —
 * đó là tính chất được kiểm, không phải lời hứa.
 *
 * Ba chốt chặn provider dùng lại nguyên của `actor/session.ts`: không viết lại, để hai tầng không lệch nhau.
 */

import {
  ActorWiringError,
  extractJson,
  inspectActorProvider,
  textOfBlocks,
  type SubagentProviderLike,
  type SubagentRuntimeLike,
} from '../actor/session'
import { WRITER_OUTPUT_SCHEMA, parseWriterOutput, writerPersona, type WriterOutput } from './brief'
import { assertPovSafe, type PovLeak } from './guard'
import type { Pov } from './export'

export { ActorWiringError }

export interface WriterRunInput {
  readonly pov: Pov
  readonly actorId?: string
  /** Nhãn hiển thị cho phiên con. */
  readonly label: string
  readonly prompt: string
  /** Chuỗi mà góc nhìn này chưa từng nhận. Kiểm TRƯỚC khi gọi model. */
  readonly forbidden: readonly PovLeak[]
}

export interface WriterRunOutcome {
  readonly output?: WriterOutput
  readonly issues: readonly string[]
}

export interface WriterRunner {
  run(input: WriterRunInput): Promise<WriterRunOutcome>
}

export const DEFAULT_WRITER_TIMEOUT_MS = 240_000

export interface SpawnWriterRunnerOptions {
  readonly subagents: SubagentRuntimeLike | undefined
  readonly providerName?: string
  readonly parent?: unknown
  readonly timeoutMs?: number
  readonly checkIsolation?: boolean
  readonly log?: (message: string) => void
}

/** Kiểm provider trước khi gửi — dùng chung chốt chặn với actor. */
export function inspectWriterProvider(
  runtime: SubagentRuntimeLike | undefined,
  providerName: string,
): { provider?: SubagentProviderLike; warnings: string[] } {
  return inspectActorProvider(runtime, providerName)
}

export function createSpawnWriterRunner(options: SpawnWriterRunnerOptions): WriterRunner {
  const providerName = options.providerName ?? 'spawn'
  const timeoutMs = options.timeoutMs ?? DEFAULT_WRITER_TIMEOUT_MS
  const checkIsolation = options.checkIsolation !== false

  return {
    async run(input: WriterRunInput): Promise<WriterRunOutcome> {
      const issues: string[] = []
      const { provider, warnings } = inspectWriterProvider(options.subagents, providerName)
      issues.push(...warnings)
      for (const warning of warnings) options.log?.(warning)

      // Chốt chặn có răng: nguyên liệu lọt chuỗi cấm thì không tốn model call nào.
      if (checkIsolation) assertPovSafe(input.prompt, input.forbidden, input.pov)

      const supportsSchema = provider?.capabilities.outputSchema ?? true
      const supportsPersona = provider?.capabilities.persona ?? true

      const controller = new AbortController()
      const timer = timeoutMs > 0
        ? setTimeout(() => controller.abort(`writer ${input.label} quá hạn ${timeoutMs}ms`), timeoutMs)
        : undefined

      let run: Awaited<ReturnType<SubagentRuntimeLike['start']>> | undefined
      try {
        run = await options.subagents!.start(providerName, {
          label: input.label,
          prompt: [{ type: 'text', text: input.prompt }],
          parent: options.parent,
          signal: controller.signal,
          toolFilter: { allow: [] },
          ...(supportsSchema ? { outputSchema: WRITER_OUTPUT_SCHEMA } : {}),
          ...(supportsPersona ? { persona: writerPersona(input.pov) } : {}),
        })
        const result = await run.result
        if (result.stopReason !== undefined && result.stopReason !== 'completed') {
          issues.push(`Writer kết thúc bất thường: ${result.stopReason}${result.diagnostic === undefined ? '' : ` (${result.diagnostic})`}`)
        }

        const text = textOfBlocks(result.output)
        const raw = result.structured ?? (text === '' ? undefined : extractJson(text) ?? text)
        const parsed = parseWriterOutput(raw)
        return {
          ...(parsed.output === undefined ? {} : { output: parsed.output }),
          issues: [...issues, ...parsed.issues],
        }
      } catch (error) {
        issues.push(`Writer lỗi: ${error instanceof Error ? error.message : String(error)}`)
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
export function createScriptedWriterRunner(
  script: WriterOutput | ((input: WriterRunInput) => WriterOutput | undefined),
  options?: { readonly onRun?: (input: WriterRunInput) => void },
): WriterRunner {
  return {
    async run(input: WriterRunInput): Promise<WriterRunOutcome> {
      options?.onRun?.(input)
      const output = typeof script === 'function' ? script(input) : script
      return output === undefined ? { issues: ['không có output cho writer'] } : { output, issues: [] }
    },
  }
}
