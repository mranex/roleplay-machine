/**
 * POV guard — biến "góc nhìn này không được biết chuyện kia" thành tính chất **kiểm được**.
 *
 * Cách làm thông thường là dặn model "đừng tiết lộ bí mật". Cách ở đây: dựng danh sách những chuỗi mà
 * góc nhìn này chưa từng nhận, rồi soi bản văn. Nếu bản văn chứa chúng, đó là lỗi kiến trúc, không phải
 * lỗi văn phong.
 *
 * Một chi tiết quan trọng để tránh báo động giả: một câu trong `allowedKnowledge` của NPC A **có thể**
 * đến tai người chơi qua lời thoại — khi đó nó nằm trong nguyên liệu hợp pháp của POV1, và không được
 * coi là rò rỉ nữa. Nên danh sách cấm = ứng viên **trừ** những gì đã có trong nguyên liệu của chính POV.
 */

import type { ActorDefinition } from '../actor/model'
import type { GeneratedScene } from '../scene'
import type { Pov } from './export'
import type { StoryTurn } from './transcript'

/** Chuỗi bị cấm, kèm lý do để thông báo lỗi nói được cái gì đã rò rỉ. */
export interface PovLeak {
  readonly text: string
  readonly source: string
  readonly classification: 'sealed' | 'private' | 'other_actor'
}

/** Ngắn hơn ngưỡng này thì bỏ: chuỗi ngắn khớp bừa trong văn xuôi. */
const MIN_LENGTH = 6

export class PovViolation extends Error {
  constructor(readonly pov: Pov, readonly leaked: readonly PovLeak[]) {
    super(
      `Bản văn POV "${pov}" chứa ${leaked.length} chuỗi mà góc nhìn này chưa từng nhận: `
      + leaked.slice(0, 3).map(entry => `[${entry.source}] ${entry.text.slice(0, 60)}`).join(' | '),
    )
    this.name = 'PovViolation'
  }
}

export interface PovForbiddenInput {
  readonly pov: Pov
  readonly actorId?: string
  readonly scene?: GeneratedScene
  readonly definitions?: readonly ActorDefinition[]
  readonly turns: readonly StoryTurn[]
  /** Nguyên liệu hợp pháp của POV này — dùng để loại bỏ báo động giả. */
  readonly material: string
}

export function povForbidden(input: PovForbiddenInput): PovLeak[] {
  // Thiên Đạo và toàn tri được phép biết mọi thứ: không có gì để cấm. Hàng rào ở đó là con người — người
  // chơi đã yêu cầu có spoil.
  if (input.pov === 'kami' || input.pov === 'omniscient') return []

  const candidates: PovLeak[] = []
  const push = (text: string | undefined, source: string, classification: PovLeak['classification']): void => {
    const trimmed = (text ?? '').trim()
    if (trimmed.length < MIN_LENGTH) return
    candidates.push({ text: trimmed, source, classification })
  }

  if (input.scene !== undefined) {
    push(input.scene.sceneCore.hiddenTruth, 'sealed.hiddenTruth', 'sealed')
    push(input.scene.sceneCore.chaosTwist, 'sealed.chaosTwist', 'sealed')
    for (const rule of input.scene.kamiSama.rules) push(rule, 'sealed.kamiRule', 'sealed')
  }

  for (const definition of input.definitions ?? []) {
    if (definition.id === input.actorId) continue
    for (const knowledge of definition.allowedKnowledge) push(knowledge, `khai báo.${definition.id}`, 'other_actor')
    for (const belief of definition.initialBeliefs) push(belief.claim, `khai báo.${definition.id}`, 'other_actor')
  }

  for (const turn of input.turns) {
    for (const actor of turn.actors) {
      if (actor.id === input.actorId) continue
      push(actor.interpretation, `lượt ${turn.turn}.${actor.id}.hiểu`, 'other_actor')
      push(actor.intentContent, `lượt ${turn.turn}.${actor.id}.ý định`, 'other_actor')
      push(actor.plan, `lượt ${turn.turn}.${actor.id}.kế hoạch`, 'private')
      for (const belief of actor.beliefs) push(belief, `lượt ${turn.turn}.${actor.id}.tin`, 'private')
    }
    // Ý định chưa thành sự thật: chỉ Thiên Đạo thấy.
    for (const privateEvent of turn.privateEvents) push(privateEvent, `lượt ${turn.turn}.riêng tư`, 'private')
    // Sự thật công khai mà POV này không tri giác được.
    for (const withheld of turn.withheld) push(withheld, `lượt ${turn.turn}.ngoài tầm`, 'private')
  }

  // Loại bỏ những gì POV này đã nhận hợp pháp: nếu chuỗi có trong nguyên liệu của nó thì nó biết rồi.
  const seen = new Set<string>()
  const out: PovLeak[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.text)) continue
    seen.add(candidate.text)
    if (input.material.includes(candidate.text)) continue
    out.push(candidate)
  }
  return out
}

/** Ném `PovViolation` nếu văn bản chứa chuỗi bị cấm. */
export function assertPovSafe(text: string, forbidden: readonly PovLeak[], pov: Pov): void {
  const leaked = forbidden.filter(entry => text.includes(entry.text))
  if (leaked.length > 0) throw new PovViolation(pov, leaked)
}

/** Kiểm không ném, để chỗ gọi tự quyết định (ví dụ: ghi log rồi vẫn lưu bản có cảnh báo). */
export function povLeaksIn(text: string, forbidden: readonly PovLeak[]): PovLeak[] {
  return forbidden.filter(entry => text.includes(entry.text))
}
