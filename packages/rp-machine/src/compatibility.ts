/**
 * Đồ thị tương thích — port từ `compatibility.py` của Roleplay Scene Maker.
 *
 * Bản cũ trả về một boolean trộn lẫn hai loại vấn đề khác hẳn nhau:
 *   - VI PHẠM CỨNG: card này cấm thẳng card kia, hoặc cấm tag mà card kia mang.
 *   - CẢNH BÁO MỀM: card cần một tag mà cặp đang xét chưa cung cấp (card khác trong cảnh có thể lo).
 * Trộn chúng vào một boolean là lý do "strictness Soft" của bản cũ trở thành vô nghĩa: guard
 * `score < -500` không bao giờ chạm vì điểm thấp nhất của một cảnh là khoảng −140.
 *
 * Ở đây hai loại được tách hẳn (`errors` và `warnings`) để tầng strictness cưỡng chế được thật.
 */

import type { Card } from './card-schema'

export interface PairReport {
  /** Không vi phạm cứng nào. */
  readonly compatible: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly score: number
}

export interface SceneReport {
  readonly compatible: boolean
  readonly score: number
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

function tagSet(card: Card): Set<string> {
  return new Set(card.tags)
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const value of a) if (b.has(value)) out.push(value)
  return out.sort()
}

/**
 * Chấm một cặp card.
 *
 * Điểm (giữ thang của bản cũ): +10 khi một card chỉ đích danh card kia, +3 mỗi tag chung,
 * +2 mỗi lần tag của bên này nằm trong `compatibleTags` của bên kia, +2 mỗi domain chung,
 * +1 nếu một trong hai là `universal`, và −5 khi cặp sạch nhưng không có tín hiệu ghép nào.
 */
export function checkPair(a: Card, b: Card): PairReport {
  const errors: string[] = []
  const warnings: string[] = []
  let score = 0

  const tagsA = tagSet(a)
  const tagsB = tagSet(b)

  // Vi phạm cứng theo id chỉ đích danh.
  if (a.compatibility.incompatibleCardIds.includes(b.id)) errors.push(`${a.id} cấm thẳng ${b.id}`)
  if (b.compatibility.incompatibleCardIds.includes(a.id)) errors.push(`${b.id} cấm thẳng ${a.id}`)

  // Vi phạm cứng theo tag.
  const rejectedByA = intersect(tagsB, new Set(a.compatibility.incompatibleTags))
  if (rejectedByA.length > 0) errors.push(`${a.id} cấm tag ${rejectedByA.join(', ')} mà ${b.id} mang`)
  const rejectedByB = intersect(tagsA, new Set(b.compatibility.incompatibleTags))
  if (rejectedByB.length > 0) errors.push(`${b.id} cấm tag ${rejectedByB.join(', ')} mà ${a.id} mang`)

  // Cảnh báo mềm: cặp này chưa thoả, nhưng card khác trong cảnh có thể thoả.
  const reqAllA = new Set(a.compatibility.requiredAllTags)
  const missingA = [...reqAllA].filter(tag => !tagsB.has(tag))
  if (missingA.length > 0) warnings.push(`${a.id} cần tag ${missingA.join(', ')} — cặp này chưa có`)
  const reqAllB = new Set(b.compatibility.requiredAllTags)
  const missingB = [...reqAllB].filter(tag => !tagsA.has(tag))
  if (missingB.length > 0) warnings.push(`${b.id} cần tag ${missingB.join(', ')} — cặp này chưa có`)

  // Điểm cộng.
  if (a.compatibility.compatibleCardIds.includes(b.id)) score += 10
  if (b.compatibility.compatibleCardIds.includes(a.id)) score += 10
  score += 3 * intersect(tagsA, tagsB).length
  score += 2 * intersect(tagsB, new Set(a.compatibility.compatibleTags)).length
  score += 2 * intersect(tagsA, new Set(b.compatibility.compatibleTags)).length
  score += 2 * intersect(new Set(a.compatibility.domain), new Set(b.compatibility.domain)).length
  if (a.compatibility.universal || b.compatibility.universal) score += 1

  const compatible = errors.length === 0
  if (compatible && score === 0) {
    score -= 5
    warnings.push(`${a.id} và ${b.id} ghép yếu, không có tín hiệu chung`)
  }

  return { compatible, errors, warnings, score }
}

/**
 * Chấm toàn cảnh: mọi cặp, cộng kiểm tra ở mức cảnh cho `requiredAllTags` / `requiredAnyTags`.
 * Đây là chỗ bản cũ đặt hard-check cho tag yêu cầu — giữ nguyên hành vi đó.
 */
export function checkScene(cards: readonly Card[]): SceneReport {
  const errors: string[] = []
  const warnings: string[] = []
  let score = 0

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i] as Card
      const b = cards[j] as Card
      const pair = checkPair(a, b)
      errors.push(...pair.errors)
      warnings.push(...pair.warnings)
      score += pair.score
    }
  }

  const sceneTags = new Set<string>()
  for (const card of cards) for (const tag of card.tags) sceneTags.add(tag)

  for (const card of cards) {
    const reqAll = card.compatibility.requiredAllTags.filter(tag => !sceneTags.has(tag))
    if (reqAll.length > 0) errors.push(`Cảnh thiếu tag bắt buộc ${reqAll.join(', ')} cho ${card.id}`)
    const reqAny = card.compatibility.requiredAnyTags
    if (reqAny.length > 0 && !reqAny.some(tag => sceneTags.has(tag))) {
      errors.push(`${card.id} cần một trong ${reqAny.join(', ')}, cảnh không có tag nào`)
    }
  }

  // Cảnh báo mạch lạc: card không chia sẻ `domain` nào với phần còn lại thường là dấu hiệu cảnh bị
  // trộn từ nhiều thế giới khác nhau. Đây là chẩn đoán, không phải vi phạm — strict sẽ chặn nó.
  const withDomain = cards.filter(card => card.compatibility.domain.length > 0)
  for (const card of withDomain) {
    const own = new Set(card.compatibility.domain)
    const shares = withDomain.some(other => other.id !== card.id && other.compatibility.domain.some(domain => own.has(domain)))
    if (!shares) warnings.push(`${card.id} không chia sẻ domain nào với phần còn lại của cảnh`)
  }

  return {
    compatible: errors.length === 0,
    score,
    errors: dedupe(errors),
    warnings: dedupe(warnings),
  }
}

/**
 * Điểm cặp giữa một card ứng viên và bộ card đã chọn. Dùng khi lắp từng slot: ở bước này chỉ có
 * một phần cảnh nên không thể chấm mức cảnh, chỉ cộng dồn điểm cặp và đếm vi phạm cứng.
 */
export function scoreCandidate(
  candidate: Card,
  chosen: readonly Card[],
): { score: number; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  let score = 0
  for (const card of chosen) {
    const pair = checkPair(candidate, card)
    errors.push(...pair.errors)
    warnings.push(...pair.warnings)
    score += pair.score
  }
  return { score, errors, warnings }
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)].sort()
}

/** Ba luật nền, độc lập với card — bản cũ hardcode đúng ba luật này. */
export const BASE_KAMI_RULES: readonly string[] = [
  'Người chơi không được tự định nghĩa xuất thân, năng lực, vật dụng, kiến thức bí mật hay địa vị xã hội của nhân vật chính.',
  'Nhân vật chính do ván chơi quy định. Người chơi chỉ điều khiển hành động và lời nói trong khuôn khổ đó.',
  'Thế giới chỉ trả lời điều người chơi LÀM, không trả lời điều người chơi MUỐN.',
]
