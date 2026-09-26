/**
 * Kênh bí mật: gắn trạng thái ván vào systemPrompt của agent.
 *
 * Hai contribution:
 *  1. `section` — bản giao kèo cố định của Thiên Đạo (giọng kể, quy trình mỗi lượt, hai trục luật,
 *     ranh giới công khai/bí mật). Luôn có mặt, không phụ thuộc model có gọi skill hay không.
 *  2. `context` — khung GM của ván đang chạy, tính lại mỗi lần assemble. ĐÂY LÀ NƠI DUY NHẤT chứa
 *     `hiddenTruth`, mô tả bước thắng và luật Thiên Đạo. Không có đường nào khác đưa bí mật tới model
 *     mà không lộ ra transcript.
 *
 * Ở MVP này là "trust mode": người chơi tự nguyện không mở system prompt. Sealed mode (gọi model riêng
 * để phán quyết, bí mật không bao giờ vào session) là nâng cấp sau — điểm cắt đã sẵn: thay
 * `activeRunText()` bằng một lời gọi model.
 */

import type { Context } from '@deepseek-ai/cordis'
import { isTerminal, listRuns, loadRun, renderGmFrame } from './runtime'
import { activeActorText } from './actor/turn'
import { loadScene } from './scene'
import type { AgentLike } from './tools-scene'

/** Bản giao kèo tối thiểu, luôn nằm trong prompt. Ngắn có chủ đích: phần sâu nằm ở skill. */
export const RUNTIME_CONTRACT = `Bạn vận hành "Roleplay Machine" trong vai Thiên Đạo — một giọng nói đều đều, không cảm xúc, dẫn dắt người chơi trong một thế giới họ chưa từng biết.

Mỗi lượt, theo thứ tự:
1. Gọi rp_turn với tóm tắt hành động của người chơi — TRƯỚC khi viết bất cứ dòng nào.
2. Làm đúng những gì trường "instructions" của rp_turn yêu cầu.
3. Kể lượt. Kết bằng một áp lực mới hoặc một câu hỏi buộc phải trả lời.
4. Sau khi kể: việc gì đã THỰC SỰ xảy ra trong truyện thì ghi lại bằng tool tương ứng — rp_step khi xong một bước thắng, rp_meter khi một thanh căng thẳng đổi, rp_strike khi người chơi phá khung.

Hai trục luật TÁCH BIỆT, đừng trộn:
- THANH CĂNG THẲNG là chuyện trong truyện (bị ngờ, thời gian trôi, thân phận hao mòn). Nói hớ trong vai làm thanh tăng — đó là NỘI DUNG, không phải vi phạm.
- CẢNH CÁO OOC chỉ dành cho việc phá khung: tự định nghĩa nhân vật chính, tự quyết kết quả thay cho thế giới, nói ngoài truyện, dùng kiến thức nhân vật không thể biết.

LUẬT BẤT BIẾN:
- NGƯỜI CHƠI KHÔNG ĐƯỢC TỰ ĐỊNH NGHĨA NHÂN VẬT CHÍNH. Vai do card quy định. Người chơi biết mình là ai và mục tiêu là gì — chỉ sự thật bị niêm phong là họ không biết.
- Sự thật bị niêm phong là bí mật tuyệt đối: không nói thẳng, không xác nhận, không phủ nhận. Chỉ gieo chi tiết giác quan đúng mức.
- Kết thúc ván do máy trạng thái quyết. Không tự chế kết thúc.
- Người chơi bí thì gọi rp_grace (có giá). Đừng gợi ý miễn phí.
- Nhập vai nông: xử lý tình huống và quan hệ, không world-build, không giảng lịch sử thế giới.

Thế giới này không quan tâm người chơi muốn gì. Nó chỉ trả lời điều họ làm.`

export const CONTRACT_SECTION = 'rp-machine.contract'
export const RUN_CONTEXT = 'rp-machine.run'
export const ACTORS_CONTEXT = 'rp-machine.actors'

/** Vị trí: sau persona (0) nhưng trước khối hướng dẫn công cụ của host (1000+). */
const CONTRACT_ORDER = 950
const RUN_CONTEXT_ORDER = 90
const ACTORS_CONTEXT_ORDER = 88

/**
 * Agent cấp cao nhất hay con của một lần delegate?
 *
 * Đây là chốt chặn kiến trúc cho Multi-Actor-Agent Mode. Actor là subagent `spawn`, và kênh bí mật ở
 * file này chứa `hiddenTruth` trong khung GM — nếu nó được gắn cho mọi agent thì mọi actor đều đọc
 * được sự thật bị niêm phong ngay trong system prompt, và toàn bộ cô lập thông tin sụp đổ.
 *
 * Luật: **chỉ agent cấp cao nhất nhận khung GM.** Mọi agent có `origin === 'subagent'` bị bỏ qua.
 */
export function isTopLevelAgent(agent: {
  readonly session?: { readonly header?: { readonly origin?: string } | undefined } | undefined
}): boolean {
  return agent.session?.header?.origin !== 'subagent'
}

export interface SystemPromptLike {
  section(section: {
    readonly name: string
    readonly order: number
    readonly text: string | ((assemble: unknown) => string)
  }): () => void
  context(context: {
    readonly name: string
    readonly order: number
    readonly text: string | ((assemble: unknown) => string)
  }): () => void
  getSectionOrder?(name: string): number
  getContextOrder?(name: string): number
}

export interface PromptDeps {
  readonly workspaceRoot: (agent?: AgentLike) => string | undefined
}

function sysPromptOf(ctx: Context): SystemPromptLike | undefined {
  const get = (ctx as unknown as { get?: (n: string) => unknown }).get
  if (typeof get === 'function') {
    try {
      return get.call(ctx, 'systemPrompt') as SystemPromptLike | undefined
    } catch {
      return undefined
    }
  }
  return (ctx as unknown as { systemPrompt?: SystemPromptLike }).systemPrompt
}

/** Khung GM của ván mới nhất. Rỗng khi chưa có ván. */
export function activeRunText(root: string | undefined): string {
  if (root === undefined) return ''
  try {
    const latest = listRuns(root)[0]
    if (latest === undefined) return ''
    const state = loadRun(root, latest.sceneId)
    if (state === undefined) return ''
    const scene = loadScene(root, latest.sceneId)
    if (scene === undefined) return ''
    if (isTerminal(state.status)) {
      return `【Roleplay Machine】Ván ${state.sceneId} đã kết thúc (${state.status}). Không kể tiếp trừ khi người chơi mở ván mới bằng rp_new_scene.`
    }
    return renderGmFrame(state, scene)
  } catch {
    return ''
  }
}

/**
 * Gắn kênh bí mật vào một agent. Trả về hàm gỡ (gộp disposer của section/context và Fiber của inject)
 * để plugin không rò rỉ khi unload.
 */
export function attachRunContext(
  agentCtx: Context,
  deps: PromptDeps,
  options?: { readonly logger?: { readonly warn: (message: string) => void } },
): (() => void | Promise<void>) | undefined {
  if (typeof (agentCtx as { inject?: unknown }).inject !== 'function') return undefined
  try {
    const offs: Array<() => void> = []
    const fiber = (
      agentCtx as unknown as {
        inject: (deps: readonly string[], setup: (scope: unknown) => void) => { dispose?: () => unknown } | undefined
      }
    ).inject(['systemPrompt'], scope => {
      const sys = sysPromptOf(scope as Context)
      if (sys === undefined || typeof sys.section !== 'function' || typeof sys.context !== 'function') return
      const sectionOrder = typeof sys.getSectionOrder === 'function' ? sys.getSectionOrder(CONTRACT_SECTION) : CONTRACT_ORDER
      const contextOrder = typeof sys.getContextOrder === 'function' ? sys.getContextOrder(RUN_CONTEXT) : RUN_CONTEXT_ORDER

      const offSection = sys.section({
        name: CONTRACT_SECTION,
        order: Number.isFinite(sectionOrder) ? sectionOrder : CONTRACT_ORDER,
        text: RUNTIME_CONTRACT,
      })
      if (typeof offSection === 'function') offs.push(offSection)

      const offContext = sys.context({
        name: RUN_CONTEXT,
        order: Number.isFinite(contextOrder) ? contextOrder : RUN_CONTEXT_ORDER,
        text: () => {
          const root = deps.workspaceRoot()
          if (root === undefined) return ''
          const text = activeRunText(root)
          if (text !== '') return text
          return '【Roleplay Machine】Chưa có ván nào. Khi người chơi muốn chơi, gọi rp_pool_status rồi rp_new_scene.'
        },
      })
      if (typeof offContext === 'function') offs.push(offContext)

      // Kênh kín thứ hai: diễn biến riêng của Multi-Actor-Agent Mode (actor hiểu gì, muốn gì, tin gì).
      // Cũng chỉ tới agent cấp cao nhất, và cũng không bao giờ đi qua kết quả tool.
      const actorsOrder = typeof sys.getContextOrder === 'function' ? sys.getContextOrder(ACTORS_CONTEXT) : ACTORS_CONTEXT_ORDER
      const offActors = sys.context({
        name: ACTORS_CONTEXT,
        order: Number.isFinite(actorsOrder) ? actorsOrder : ACTORS_CONTEXT_ORDER,
        text: () => {
          const root = deps.workspaceRoot()
          if (root === undefined) return ''
          return activeActorText(root)
        },
      })
      if (typeof offActors === 'function') offs.push(offActors)
    })
    return () => {
      for (const off of offs.reverse()) {
        try {
          off()
        } catch {
          /* gỡ idempotent */
        }
      }
      void fiber?.dispose?.()
    }
  } catch (error) {
    options?.logger?.warn(`[rp-machine] Gắn kênh bí mật vào agent thất bại: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
