import { describe, expect, it } from 'vitest'
import { BASE_KAMI_RULES, checkPair, checkScene, scoreCandidate } from '../src/compatibility'
import { makeCard, makeRichPool } from './fixtures/cards'

describe('chấm cặp card', () => {
  it('hai card universal không có tín hiệu chung vẫn ghép được với điểm +1', () => {
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['x'], compatibility: { universal: true } })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['y'], compatibility: { universal: true } })
    const report = checkPair(a, b)
    expect(report.compatible).toBe(true)
    expect(report.score).toBe(1)
    expect(report.warnings).toEqual([])
  })

  it('hai card hoàn toàn không có tín hiệu chung bị trừ điểm và cảnh báo ghép yếu', () => {
    // Nhánh này ở bản cũ nằm sau guard `score < -500` không bao giờ chạm; ở đây nó thật sự chạy.
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['x'] })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['y'] })
    const report = checkPair(a, b)
    expect(report.compatible).toBe(true)
    expect(report.score).toBe(-5)
    expect(report.warnings.join(' ')).toMatch(/ghép yếu/)
  })

  it('cấm theo id chỉ đích danh là vi phạm cứng, cả hai chiều', () => {
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['shared'], compatibility: { incompatibleCardIds: ['b_card'] } })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['shared'] })
    expect(checkPair(a, b).compatible).toBe(false)
    expect(checkPair(a, b).errors.join(' ')).toMatch(/a_card cấm thẳng b_card/)

    const c = makeCard({ id: 'c_card', type: 'npc', tags: ['shared'], compatibility: { incompatibleCardIds: ['d_card'] } })
    const d = makeCard({ id: 'd_card', type: 'world', tags: ['shared'] })
    expect(checkPair(c, d).errors.join(' ')).toMatch(/c_card cấm thẳng d_card/)
  })

  it('cấm theo tag là vi phạm cứng, cả hai chiều', () => {
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['shared'], compatibility: { incompatibleTags: ['cozy'] } })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['shared', 'cozy'] })
    expect(checkPair(a, b).compatible).toBe(false)
    expect(checkPair(a, b).errors.join(' ')).toMatch(/a_card cấm tag cozy/)

    const c = makeCard({ id: 'c_card', type: 'world', tags: ['shared', 'cozy'] })
    const d = makeCard({ id: 'd_card', type: 'npc', tags: ['shared'], compatibility: { incompatibleTags: ['cozy'] } })
    expect(checkPair(c, d).errors.join(' ')).toMatch(/d_card cấm tag cozy/)
  })

  it('tag yêu cầu chưa thoả ở mức cặp là CẢNH BÁO, không phải vi phạm', () => {
    // Đây là chỗ bản cũ trộn lẫn: tag yêu cầu bị đẩy vào cảnh báo nhưng guard strictness lại so
    // trên tổng điểm, nên "Soft" trùng "Chaotic". Ở đây tách hẳn.
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['shared'], compatibility: { requiredAllTags: ['khong-co'] } })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['shared'] })
    const report = checkPair(a, b)
    expect(report.compatible).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.warnings.join(' ')).toMatch(/a_card cần tag khong-co/)
  })

  it('cộng điểm theo đúng thang của bản cũ', () => {
    const a = makeCard({
      id: 'a_card',
      type: 'world',
      tags: ['shared', 'chi-cua-a'],
      compatibility: { domain: ['d1'], compatibleCardIds: ['b_card'], compatibleTags: ['chi-cua-b'] },
    })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['shared', 'chi-cua-b'], compatibility: { domain: ['d1'] } })
    const report = checkPair(a, b)
    // +10 chỉ đích danh, +3 tag chung, +2 compatibleTags của a khớp tag của b, +2 domain chung
    expect(report.score).toBe(17)
    expect(report.errors).toEqual([])
  })
})

describe('chấm toàn cảnh', () => {
  it('tag bắt buộc thiếu ở mức cảnh là vi phạm cứng', () => {
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['shared'], compatibility: { requiredAllTags: ['khong-co'] } })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['shared'] })
    const report = checkScene([a, b])
    expect(report.compatible).toBe(false)
    expect(report.errors.join(' ')).toMatch(/Cảnh thiếu tag bắt buộc khong-co/)
  })

  it('requiredAnyTags thoả nếu BẤT KỲ card nào trong cảnh có tag đó', () => {
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['shared'] })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['shared', 'castle'], compatibility: { requiredAnyTags: ['castle', 'void'] } })
    const report = checkScene([a, b])
    expect(report.compatible).toBe(true)
  })

  it('requiredAnyTags không thoả khi cả cảnh không có tag nào trong danh sách', () => {
    const a = makeCard({ id: 'a_card', type: 'world', tags: ['shared'] })
    const b = makeCard({ id: 'b_card', type: 'npc', tags: ['shared'], compatibility: { requiredAnyTags: ['castle', 'void'] } })
    const report = checkScene([a, b])
    expect(report.errors.join(' ')).toMatch(/b_card cần một trong castle, void/)
  })

  it('điểm cảnh là tổng điểm mọi cặp và lỗi được khử trùng', () => {
    const cards = makeRichPool()
    const report = checkScene(cards)
    expect(report.score).toBeGreaterThan(0)
    expect(new Set(report.errors).size).toBe(report.errors.length)
    expect(new Set(report.warnings).size).toBe(report.warnings.length)
  })

  it('cảnh rỗng hợp lệ và điểm 0', () => {
    expect(checkScene([])).toEqual({ compatible: true, score: 0, errors: [], warnings: [] })
  })

  it('pool giàu có cảnh báo mềm (dùng để test strictness)', () => {
    expect(checkScene(makeRichPool()).warnings.length).toBeGreaterThan(0)
  })
})

describe('chấm ứng viên theo từng slot', () => {
  it('cộng dồn điểm cặp với phần đã chọn và gom vi phạm cứng', () => {
    const chosen = [
      makeCard({ id: 'w_card', type: 'world', tags: ['shared'] }),
      makeCard({ id: 'n_card', type: 'npc', tags: ['shared', 'cozy'] }),
    ]
    const candidate = makeCard({ id: 'c_card', type: 'goal', tags: ['shared'], compatibility: { incompatibleTags: ['cozy'] } })
    const scored = scoreCandidate(candidate, chosen)
    expect(scored.errors.length).toBeGreaterThan(0)
    expect(scored.score).toBeGreaterThan(0)
  })

  it('không có phần đã chọn thì điểm 0', () => {
    const candidate = makeCard({ id: 'c_card', type: 'goal', tags: ['shared'] })
    expect(scoreCandidate(candidate, [])).toEqual({ score: 0, errors: [], warnings: [] })
  })
})

describe('luật nền của Thiên Đạo', () => {
  it('có đúng ba luật và luật đầu nói về việc không được tự định nghĩa nhân vật chính', () => {
    expect(BASE_KAMI_RULES).toHaveLength(3)
    expect(BASE_KAMI_RULES.join(' ')).toMatch(/không được tự định nghĩa/)
  })
})
