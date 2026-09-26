import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CARD_TYPES, loadPool, type Card, type CardType } from '../src/card-schema'
import { checkScene } from '../src/compatibility'
import {
  DEFAULT_SETTINGS,
  MODE_INFO,
  PLAY_MODES,
  cardWeight,
  chaosOf,
  generateScene,
  listScenes,
  loadScene,
  renderGmContext,
  renderPlayerBriefing,
  saveScene,
  splitSentences,
  type CardSource,
  type GeneratedScene,
  type PlayMode,
  type SceneSettings,
} from '../src/scene'
import { makeCard, makeCleanPool, makeRichPool, makeVariedPool, realPoolDir } from './fixtures/cards'

const NOW = '2026-01-01T00:00:00.000Z'

/** 8 card có tổng chaos đúng bằng `total`, mỗi card 1..5. */
function cardsWithChaosSum(total: number): Card[] {
  const values: number[] = []
  let remaining = total
  for (let i = 0; i < 8; i++) {
    const rest = 8 - i - 1
    const value = Math.min(5, Math.max(1, remaining - rest))
    values.push(value)
    remaining -= value
  }
  return values.map((value, index) => makeCard({ id: `chaos_${index}`, type: CARD_TYPES[index] as CardType, chaos: value }))
}

function settings(over: Partial<SceneSettings> = {}): SceneSettings {
  return { ...DEFAULT_SETTINGS, ...over }
}

describe('chaos scale — TỔNG điểm, 5 tầng', () => {
  it('là tổng, không phải trung bình', () => {
    expect(chaosOf(cardsWithChaosSum(12)).total).toBe(12)
    expect(chaosOf(cardsWithChaosSum(33)).total).toBe(33)
  })

  it('đúng ngưỡng của bản cũ: 12/18/25/32', () => {
    expect(chaosOf(cardsWithChaosSum(12)).level).toBe('grounded')
    expect(chaosOf(cardsWithChaosSum(13)).level).toBe('strange')
    expect(chaosOf(cardsWithChaosSum(18)).level).toBe('strange')
    expect(chaosOf(cardsWithChaosSum(19)).level).toBe('unstable')
    expect(chaosOf(cardsWithChaosSum(25)).level).toBe('unstable')
    expect(chaosOf(cardsWithChaosSum(26)).level).toBe('chaotic')
    expect(chaosOf(cardsWithChaosSum(32)).level).toBe('chaotic')
    expect(chaosOf(cardsWithChaosSum(33)).level).toBe('reality_breaking')
  })

  it('chaos cao mở khoá lever cho GM, chaos thấp thì không', () => {
    const grounded = chaosOf(cardsWithChaosSum(12))
    expect(grounded.eventEvery).toBe(4)
    expect(grounded.mayBendRules).toBe(false)
    expect(grounded.npcMayLie).toBe(false)

    const unstable = chaosOf(cardsWithChaosSum(19))
    expect(unstable.eventEvery).toBe(3)
    expect(unstable.mayBendRules).toBe(false)

    const chaotic = chaosOf(cardsWithChaosSum(26))
    expect(chaotic.eventEvery).toBe(2)
    expect(chaotic.mayBendRules).toBe(true)
    expect(chaotic.npcMayLie).toBe(false)

    const breaking = chaosOf(cardsWithChaosSum(33))
    expect(breaking.mayBendRules).toBe(true)
    expect(breaking.npcMayLie).toBe(true)
  })
})

describe('trọng số rút theo từng chế độ sampling', () => {
  const cardA = makeCard({ id: 'a_card', type: 'npc', chaos: 1, tags: ['a'] })
  const cardB = makeCard({ id: 'b_card', type: 'npc', chaos: 5, tags: ['a'] })
  const base = { pairScore: 10, isRecent: false, packCount: 0, sceneTags: new Set<string>() }

  it('balanced random: hai card giống nhau trừ chaos thì trọng số bằng nhau', () => {
    const s = settings({ samplingMode: 'balanced_random' })
    expect(cardWeight(cardA, { ...base, settings: s })).toBeCloseTo(cardWeight(cardB, { ...base, settings: s }), 10)
  })

  it('chaos roulette: card chaos >= 4 được nhân 1.5', () => {
    const s = settings({ samplingMode: 'chaos_roulette' })
    const wa = cardWeight(cardA, { ...base, settings: s })
    const wb = cardWeight(cardB, { ...base, settings: s })
    expect(wb / wa).toBeCloseTo(1.5, 10)
  })

  it('wild but valid: thưởng card mang tag mới — đây là nhánh mà bản cũ không có', () => {
    const s = settings({ samplingMode: 'wild_but_valid' })
    const sceneTags = new Set(['x1', 'x2', 'x3', 'x4', 'x5'])
    const novel = makeCard({ id: 'novel_card', type: 'npc', chaos: 1, tags: ['n1', 'n2', 'n3', 'n4', 'n5'] })
    const stale = makeCard({ id: 'stale_card', type: 'npc', chaos: 1, tags: ['x1'] })
    const wNovel = cardWeight(novel, { ...base, settings: s, sceneTags })
    const wStale = cardWeight(stale, { ...base, settings: s, sceneTags })
    expect(wNovel / wStale).toBeCloseTo(1 + 0.3 * 5, 10)

    // Ở balanced thì hai card này bằng nhau ⇒ hai chế độ thật sự khác nhau.
    const wb = cardWeight(novel, { ...base, settings: settings({ samplingMode: 'balanced_random' }), sceneTags })
    const ws = cardWeight(stale, { ...base, settings: settings({ samplingMode: 'balanced_random' }), sceneTags })
    expect(wb).toBeCloseTo(ws, 10)
  })

  it('high compatibility không đổi trọng số từng card (nó cắt ở mức shortlist)', () => {
    const s = settings({ samplingMode: 'high_compatibility' })
    expect(cardWeight(cardA, { ...base, settings: s })).toBeCloseTo(cardWeight(cardB, { ...base, settings: s }), 10)
  })

  it('card vừa dùng gần đây bị nhân 0.35, tắt tuỳ chọn thì hết', () => {
    const on = settings({ avoidRecentCards: true })
    const off = settings({ avoidRecentCards: false })
    expect(cardWeight(cardA, { ...base, settings: on, isRecent: true }) / cardWeight(cardA, { ...base, settings: on })).toBeCloseTo(0.35, 10)
    expect(cardWeight(cardA, { ...base, settings: off, isRecent: true })).toBeCloseTo(cardWeight(cardA, { ...base, settings: off }), 10)
  })

  it('clumping cùng nguồn: 0.55 khi đã có 2, 0.25 khi đã có 4', () => {
    const s = settings({ avoidSamePackClumping: true })
    const w0 = cardWeight(cardA, { ...base, settings: s, packCount: 0 })
    expect(cardWeight(cardA, { ...base, settings: s, packCount: 2 }) / w0).toBeCloseTo(0.55, 10)
    expect(cardWeight(cardA, { ...base, settings: s, packCount: 4 }) / w0).toBeCloseTo(0.25, 10)

    const off = settings({ avoidSamePackClumping: false })
    expect(cardWeight(cardA, { ...base, settings: off, packCount: 4 })).toBeCloseTo(cardWeight(cardA, { ...base, settings: off }), 10)
  })
})

describe('sinh scene tất định', () => {
  const pool = makeVariedPool(3)

  it('cùng seed + cùng pool cho cùng scene', () => {
    const a = generateScene(pool, { seed: 'seed-1', mode: 'boss_mode', now: NOW })
    const b = generateScene(pool, { seed: 'seed-1', mode: 'boss_mode', now: NOW })
    expect(a.scene).toEqual(b.scene)
  })

  it('không phụ thuộc thứ tự file trên đĩa — điểm yếu của bản cũ', () => {
    const forward = generateScene(pool, { seed: 'seed-2', mode: 'boss_mode', now: NOW })
    const reversed = generateScene([...pool].reverse(), { seed: 'seed-2', mode: 'boss_mode', now: NOW })
    expect(forward.scene).toEqual(reversed.scene)
  })

  it('seed khác cho ra scene khác', () => {
    const seen = new Set<string>()
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const scene = generateScene(pool, { seed, mode: 'boss_mode', now: NOW }).scene
      seen.add(CARD_TYPES.map(type => scene.cards[type].id).join('|'))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('scene luôn đủ 8 slot và chaos bằng tổng chaos của chúng', () => {
    const scene = generateScene(pool, { seed: 'seed-3', mode: 'boss_mode', now: NOW }).scene
    const sum = CARD_TYPES.reduce((total, type) => total + scene.cards[type].chaos, 0)
    expect(scene.chaos.total).toBe(sum)
    for (const type of CARD_TYPES) expect(scene.cards[type].type).toBe(type)
  })

  it('số cảnh ứng viên dựng ra đúng theo chế độ', () => {
    const counts = Object.fromEntries(
      (['balanced_random', 'high_compatibility', 'wild_but_valid', 'chaos_roulette'] as const).map(mode => [
        mode,
        generateScene(pool, { seed: 'seed-4', mode: 'boss_mode', settings: { samplingMode: mode }, now: NOW }).considered,
      ]),
    )
    expect(counts).toEqual({ balanced_random: 20, high_compatibility: 30, wild_but_valid: 20, chaos_roulette: 10 })
  })
})

describe('ngân sách chọn theo mode và card người chơi chỉ định', () => {
  const pool = makeVariedPool(2)

  it('boss mode không cho chọn gì', () => {
    expect(() => generateScene(pool, { seed: 's', mode: 'boss_mode', picks: { world: 'world_0' } })).toThrow(/chỉ cho tự chọn 0/)
  })

  it('semi coward cho tối đa 3 slot', () => {
    const three = { world: 'world_0', npc: 'npc_0', goal: 'goal_0' }
    expect(() => generateScene(pool, { seed: 's', mode: 'semi_coward', picks: three })).not.toThrow()
    expect(() => generateScene(pool, { seed: 's', mode: 'semi_coward', picks: { ...three, chaos: 'chaos_0' } })).toThrow(/chỉ cho tự chọn 3/)
  })

  it('coward mode cho chọn cả 8 slot và tôn trọng lựa chọn', () => {
    const picks = Object.fromEntries(CARD_TYPES.map(type => [type, `${type}_0`])) as Partial<Record<CardType, string>>
    const scene = generateScene(pool, { seed: 's', mode: 'coward', picks, now: NOW }).scene
    for (const type of CARD_TYPES) expect(scene.cards[type].id).toBe(`${type}_0`)
    expect(scene.mode.selectedSlots).toEqual([...CARD_TYPES])
    expect(scene.mode.randomSlots).toEqual([])
  })

  it('luôn giấu đúng slot hidden_truth, kể cả ở mode người chơi chọn hết', () => {
    const picks = Object.fromEntries(CARD_TYPES.map(type => [type, `${type}_0`])) as Partial<Record<CardType, string>>
    for (const mode of PLAY_MODES) {
      const scene = generateScene(pool, { seed: 's', mode, picks: mode === 'coward' ? picks : undefined, now: NOW }).scene
      expect(scene.mode.hiddenSlots).toEqual(['hidden_truth'])
    }
  })

  it('card chỉ định không tồn tại thì ghi chú và vẫn sinh được scene', () => {
    const outcome = generateScene(pool, { seed: 's', mode: 'coward', picks: { world: 'khong_ton_tai' }, now: NOW })
    expect(outcome.notes.join(' ')).toMatch(/Không thấy card "khong_ton_tai"/)
    expect(outcome.scene.cards.world.id).toMatch(/^world_/)
  })

  it('pool thiếu hẳn một loại thì báo lỗi rõ ràng', () => {
    const missing = pool.filter(card => card.type !== 'goal')
    expect(() => generateScene(missing, { seed: 's', mode: 'boss_mode' })).toThrow(/thiếu card loại "goal"/)
  })

  it('pool rỗng thì báo lỗi thay vì sinh scene rỗng', () => {
    expect(() => generateScene([], { seed: 's', mode: 'boss_mode' })).toThrow(/Pool rỗng/)
  })
})

describe('strictness — chỗ bản cũ để "Soft" trùng "Chaotic"', () => {
  const clean = makeCleanPool()
  const rich = makeRichPool()

  it('pool sạch + strict: không phải hạ cấp', () => {
    const outcome = generateScene(clean, { seed: 's', mode: 'boss_mode', settings: { strictness: 'strict' }, now: NOW })
    expect(outcome.notes.join(' ')).not.toMatch(/đã hạ xuống/)
    expect(outcome.scene.compatibilityReport.warnings).toEqual([])
    expect(outcome.scene.compatibilityReport.errors).toEqual([])
  })

  it('pool giàu + strict: có cảnh báo mềm nên phải hạ cấp, và được ghi lại', () => {
    const outcome = generateScene(rich, { seed: 's', mode: 'boss_mode', settings: { strictness: 'strict' }, now: NOW })
    expect(outcome.notes.join(' ')).toMatch(/đã hạ xuống cảnh tốt nhất/)
    expect(outcome.scene.compatibilityReport.warnings.length).toBeGreaterThan(0)
    expect(outcome.scene.compatibilityReport.errors).toEqual([])
  })

  it('pool giàu + soft: cảnh báo mềm không chặn — soft KHÁC strict', () => {
    const outcome = generateScene(rich, { seed: 's', mode: 'boss_mode', settings: { strictness: 'soft' }, now: NOW })
    expect(outcome.notes.join(' ')).not.toMatch(/đã hạ xuống/)
    expect(outcome.scene.compatibilityReport.errors).toEqual([])
  })

  it('pool giàu + chaotic: nhận hết', () => {
    const outcome = generateScene(rich, { seed: 's', mode: 'boss_mode', settings: { strictness: 'chaotic' }, now: NOW })
    expect(outcome.notes.join(' ')).not.toMatch(/đã hạ xuống/)
  })

  it('kamiSama.strictness phản ánh mức đã chọn', () => {
    const at = (strictness: 'strict' | 'soft' | 'chaotic'): number =>
      generateScene(clean, { seed: 's', mode: 'boss_mode', settings: { strictness }, now: NOW }).scene.kamiSama.strictness
    expect([at('strict'), at('soft'), at('chaotic')]).toEqual([5, 3, 2])
  })
})

describe('vật chất hoá: những trường bản cũ để rỗng', () => {
  it('pool khai báo đủ thì KHÔNG suy ra gì', () => {
    const scene = generateScene(makeRichPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    expect(scene.derivation.derived).toEqual([])
  })

  it('pool không khai báo thì suy ra và ghi lại rõ đã suy ra gì', () => {
    const scene = generateScene(makeCleanPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    const derived = scene.derivation.derived.join(' ')
    expect(derived).toMatch(/forbiddenActions/)
    expect(derived).toMatch(/tensionMeters/)
    expect(derived).toMatch(/winCondition/)
    expect(derived).toMatch(/loseCondition/)
  })

  it('playerContract.forbiddenActions lấy từ contentBoundary khi card không khai báo', () => {
    const scene = generateScene(makeCleanPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    expect(scene.playerContract.forbiddenActions.length).toBeGreaterThan(0)
    expect(scene.playerContract.forbiddenActions.join(' ')).toMatch(/không được tự nhận có vũ khí/i)
    expect(scene.playerContract.outOfCharacterExamples.length).toBeGreaterThan(0)
  })

  it('playerContract ưu tiên khai báo có cấu trúc khi card có', () => {
    const scene = generateScene(makeRichPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    expect(scene.playerContract.forbiddenActions).toEqual(['tự nhận có vũ khí', 'tự nhận biết ma thuật'])
    expect(scene.playerContract.allowedAbilities).toEqual(['nấu ăn', 'quan sát'])
  })

  it('kamiSama.rules gồm luật nền + heavenRule của MỌI card + contentBoundary của MỌI card', () => {
    // Đây là sửa lỗi lớn nhất của bản cũ: contentBoundary được lưu nhưng chưa bao giờ vào prompt.
    const scene = generateScene(makeRichPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    const rules = scene.kamiSama.rules.join('\n')
    expect(scene.kamiSama.rules.slice(0, 3)).toEqual([...scene.kamiSama.rules.slice(0, 3)])
    expect(rules).toMatch(/Kami-sama declares: lời nói dối thời thượng/)
    expect(rules).toMatch(/GIỚI HẠN \(player_role\): Không được tự nhận là hiệp sĩ/)
  })

  it('tensionMeters: dùng meter khai báo, giữ nguyên nhiều thanh', () => {
    const scene = generateScene(makeRichPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    expect(scene.mechanics.tensionMeters.map(meter => meter.id)).toEqual(['nghi-ngo', 'thoi-gian'])
    expect(scene.mechanics.tensionMeters.every(meter => meter.derived === false)).toBe(true)
  })

  it('tensionMeters: suy một thanh từ card pressure khi không có khai báo', () => {
    const scene = generateScene(makeCleanPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    expect(scene.mechanics.tensionMeters).toHaveLength(1)
    expect(scene.mechanics.tensionMeters[0]?.derived).toBe(true)
    expect(scene.mechanics.tensionMeters[0]?.failAt).toBe(5)
  })

  it('winCondition và loseCondition không bao giờ rỗng', () => {
    for (const pool of [makeCleanPool(), makeRichPool()]) {
      const scene = generateScene(pool, { seed: 's', mode: 'boss_mode', now: NOW }).scene
      expect(scene.mechanics.winCondition.trim()).not.toBe('')
      expect(scene.mechanics.loseCondition.trim()).not.toBe('')
    }
  })

  it('winCondition dùng winSteps có cấu trúc khi card khai báo', () => {
    const scene = generateScene(makeRichPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    expect(scene.mechanics.winCondition).toMatch(/^Hoàn thành: /)
    expect(scene.mechanics.loseCondition).toBe('Bị khai thân phận')
  })

  it('sceneCore.hiddenTruth lấy từ card hidden_truth, không lấy từ card khác', () => {
    const scene = generateScene(makeCleanPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene
    expect(scene.sceneCore.hiddenTruth).toBe('CÓ CÁC HIỆP SĨ ĐANG TRỐN DƯỚI SÀN BẾP.')
  })

  it('splitSentences tách contentBoundary thành từng việc bị cấm', () => {
    expect(splitSentences('Không được tự nhận có vũ khí. Không được biết trước cái kết.')).toHaveLength(2)
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('Ngắn.')).toEqual([])
  })
})

describe('hai kênh render', () => {
  const scene = generateScene(makeCleanPool(), { seed: 's', mode: 'boss_mode', now: NOW }).scene

  it('briefing cho người chơi KHÔNG chứa sự thật bị niêm phong', () => {
    const briefing = renderPlayerBriefing(scene)
    expect(briefing).not.toContain('CÓ CÁC HIỆP SĨ')
    expect(briefing).toContain('Vai của bạn')
    expect(briefing).toContain('Mục tiêu')
    expect(briefing).toContain('Thanh căng thẳng')
  })

  it('vai và mục tiêu là CÔNG KHAI — người chơi biết mình là ai và phải làm gì', () => {
    const briefing = renderPlayerBriefing(scene)
    expect(briefing).toContain(scene.playerContract.role)
    expect(briefing).toContain(scene.mechanics.winCondition)
  })

  it('kênh GM chứa sự thật bị niêm phong và toàn bộ luật', () => {
    const gm = renderGmContext(scene)
    expect(gm).toContain('CÓ CÁC HIỆP SĨ')
    expect(gm).toContain('Thiên Đạo')
    expect(gm).toContain('GIỚI HẠN (player_role)')
  })

  it('kênh GM báo rõ trường nào do máy suy ra', () => {
    expect(renderGmContext(scene)).toMatch(/Trường do máy suy ra/)
  })
})

describe('lưu và đọc scene', () => {
  it('ghi rồi đọc lại đúng scene, và liệt kê được', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-scene-'))
    const generated = generateScene(makeRichPool(), { seed: 'seed-luu', mode: 'boss_mode', now: NOW }).scene
    const file = saveScene(ws, generated)
    expect(fs.existsSync(file)).toBe(true)

    const reloaded = loadScene(ws, generated.id) as GeneratedScene
    expect(reloaded.chaos.total).toBe(generated.chaos.total)
    expect(reloaded.sceneCore.hiddenTruth).toBe(generated.sceneCore.hiddenTruth)
    expect(reloaded.mechanics.winCondition).toBe(generated.mechanics.winCondition)

    const listed = listScenes(ws)
    expect(listed.map(entry => entry.id)).toEqual([generated.id])
    expect(listed[0]?.mode).toBe('boss_mode')
  })

  it('scene không tồn tại trả undefined', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-scene-'))
    expect(loadScene(ws, 'khong-co')).toBeUndefined()
    expect(listScenes(ws)).toEqual([])
  })
})

describe('nhãn mode', () => {
  it('ba mode khớp với ba lựa chọn trong thiết kế', () => {
    expect(Object.keys(MODE_INFO)).toEqual([...PLAY_MODES])
    expect(MODE_INFO.coward.maxManual).toBe(8)
    expect(MODE_INFO.semi_coward.maxManual).toBe(3)
    expect(MODE_INFO.boss_mode.maxManual).toBe(0)
    expect(MODE_INFO.boss_mode.label).toBe('Tôi là siêu anh hùng')
  })
})

describe('mạch lạc: lấy cả 8 slot từ MỘT bộ nguồn', () => {
  // Đây là chỗ sửa lỗi nghiêm trọng nhất tìm thấy khi chạy demo trên pool thật: trộn từng slot từ
  // toàn pool sinh ra cảnh ghép ba pack khác nhau (rừng rậm + ma cà rồng + vũ hội của thế lực khác).
  const alpha: CardSource = {
    id: 'pack-alpha',
    title: 'Alpha',
    cards: CARD_TYPES.map((type, index) =>
      makeCard({ id: `alpha_${type}`, type, tags: ['chung', 'alpha'], compatibility: { domain: ['alpha'] }, chaos: 1 + index % 3, sourcePackId: 'pack-alpha' })),
  }
  const beta: CardSource = {
    id: 'pack-beta',
    title: 'Beta',
    cards: CARD_TYPES.map((type, index) =>
      makeCard({ id: `beta_${type}`, type, tags: ['chung', 'beta'], compatibility: { domain: ['beta'] }, chaos: 1 + (index + 1) % 3, sourcePackId: 'pack-beta' })),
  }
  const pool = [...alpha.cards, ...beta.cards]
  const sources = [alpha, beta]

  it('mặc định lấy trọn một bộ nguồn và ghi lại nguồn đã dùng', () => {
    const scene = generateScene(pool, { seed: 'nguon-1', mode: 'boss_mode', sources, now: NOW }).scene
    expect(scene.source).not.toBeNull()
    const prefix = scene.source?.id === 'pack-alpha' ? 'alpha_' : 'beta_'
    for (const type of CARD_TYPES) expect(scene.cards[type].id).toBe(`${prefix}${type}`)
  })

  it('seed khác có thể chọn bộ nguồn khác', () => {
    const ids = new Set<string>()
    for (const seed of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']) {
      const scene = generateScene(pool, { seed, mode: 'boss_mode', sources, now: NOW }).scene
      ids.add(scene.source?.id ?? 'khong')
    }
    expect(ids.size).toBeGreaterThan(1)
  })

  it('coherence mixed thì trộn tự do và không ghi nguồn', () => {
    const scene = generateScene(pool, { seed: 'nguon-2', mode: 'boss_mode', sources, settings: { coherence: 'mixed' }, now: NOW }).scene
    expect(scene.source).toBeNull()
  })

  it('lựa chọn của người chơi quyết định bộ nguồn được chọn', () => {
    const scene = generateScene(pool, {
      seed: 'nguon-3',
      mode: 'semi_coward',
      picks: { world: 'beta_world' },
      sources,
      now: NOW,
    }).scene
    expect(scene.source?.id).toBe('pack-beta')
    expect(scene.cards.world.id).toBe('beta_world')
  })

  it('lựa chọn không nằm trong bộ nguồn hoàn chỉnh nào thì trộn và ghi chú', () => {
    const outcome = generateScene(pool, {
      seed: 'nguon-4',
      mode: 'coward',
      picks: { world: 'alpha_world' },
      sources: [beta],
      now: NOW,
    })
    expect(outcome.scene.source).toBeNull()
    expect(outcome.notes.join(' ')).toMatch(/không nằm trong bộ nguồn hoàn chỉnh nào/)
  })

  it('không có bộ nguồn nào đủ 8 loại thì trộn và ghi chú', () => {
    const partial: CardSource = { id: 'pack-thieu', title: 'Thiếu', cards: alpha.cards.filter(card => card.type !== 'goal') }
    const outcome = generateScene(pool, { seed: 'nguon-5', mode: 'boss_mode', sources: [partial], now: NOW })
    expect(outcome.scene.source).toBeNull()
    expect(outcome.notes.join(' ')).toMatch(/Không có bộ nguồn nào đủ 8 loại/)
  })

  it('cảnh lấy từ một bộ nguồn luôn mạch lạc về domain', () => {
    const scene = generateScene(pool, { seed: 'nguon-6', mode: 'boss_mode', sources, now: NOW }).scene
    expect(scene.compatibilityReport.warnings.join(' ')).not.toMatch(/không chia sẻ domain/)
  })
})

describe('mạch lạc: chẩn đoán trộn domain', () => {
  it('cảnh trộn hai domain rời nhau bị cảnh báo', () => {
    const a = makeCard({ id: 'a_world', type: 'world', tags: ['chung'], compatibility: { domain: ['alpha'] } })
    const b = makeCard({ id: 'b_npc', type: 'npc', tags: ['chung'], compatibility: { domain: ['beta'] } })
    const report = checkScene([a, b])
    expect(report.compatible).toBe(true)
    expect(report.warnings.join(' ')).toMatch(/không chia sẻ domain/)
  })
})

// ── Tích hợp với pool thật đã import từ thư viện Python cũ ────────────────

const realLoaded = loadPool(realPoolDir())
const realPool = realLoaded.cards
const realSources: CardSource[] = realLoaded.packs.map(pack => ({ id: pack.id, title: pack.title, cards: pack.cards }))
const hasRealPool = realPool.length > 0

describe.skipIf(!hasRealPool)('sinh scene từ pool thật (25 card của RSM)', () => {
  it('sinh được scene ở cả ba mode', () => {
    for (const mode of PLAY_MODES) {
      const outcome = generateScene(realPool, { seed: `that-${mode}`, mode, sources: realSources, now: NOW })
      expect(outcome.scene.cards.hidden_truth.type).toBe('hidden_truth')
      expect(outcome.scene.chaos.total).toBeGreaterThanOrEqual(8)
      expect(outcome.scene.chaos.total).toBeLessThanOrEqual(40)
      expect(outcome.scene.sceneCore.hiddenTruth.trim()).not.toBe('')
    }
  })

  it('dùng bộ nguồn thật thì cả 8 slot đến từ cùng một pack — cảnh mạch lạc', () => {
    const outcome = generateScene(realPool, { seed: 'that-nguon', mode: 'boss_mode', sources: realSources, now: NOW })
    const scene = outcome.scene
    expect(scene.source).not.toBeNull()
    const source = realSources.find(entry => entry.id === scene.source?.id)
    expect(source).toBeDefined()
    const sourceIds = new Set(source?.cards.map(card => card.id) ?? [])
    for (const type of CARD_TYPES) expect(sourceIds.has(scene.cards[type].id)).toBe(true)
    // Không còn ô mở màn rỗng — lỗi mà demo trên pool thật đã bắt được.
    expect(scene.sceneCore.openingSituation.trim()).not.toBe('')
  })

  it('không cung cấp bộ nguồn thì trộn tự do và ghi nhận nguồn là null', () => {
    const scene = generateScene(realPool, { seed: 'that-tron', mode: 'boss_mode', now: NOW }).scene
    expect(scene.source).toBeNull()
  })

  it('card thật không khai báo mechanics nên bốn trường được suy ra và ghi lại', () => {
    const scene = generateScene(realPool, { seed: 'that-1', mode: 'boss_mode', now: NOW }).scene
    const derived = scene.derivation.derived.join(' ')
    expect(derived).toMatch(/forbiddenActions/)
    expect(derived).toMatch(/tensionMeters/)
    expect(derived).toMatch(/winCondition/)
    expect(derived).toMatch(/loseCondition/)
    // Suy ra nhưng không được rỗng: đây chính là thứ bản cũ để trống.
    expect(scene.mechanics.winCondition.trim()).not.toBe('')
    expect(scene.mechanics.loseCondition.trim()).not.toBe('')
    expect(scene.mechanics.tensionMeters.length).toBeGreaterThan(0)
    expect(scene.playerContract.forbiddenActions.length).toBeGreaterThan(0)
  })

  it('contentBoundary của card thật vào được kamiSama.rules', () => {
    const scene = generateScene(realPool, { seed: 'that-2', mode: 'boss_mode', now: NOW }).scene
    expect(scene.kamiSama.rules.join('\n')).toMatch(/GIỚI HẠN \(/)
  })

  it('briefing người chơi không rò rỉ sự thật thật của ván', () => {
    const scene = generateScene(realPool, { seed: 'that-3', mode: 'boss_mode', now: NOW }).scene
    const briefing = renderPlayerBriefing(scene)
    expect(briefing).not.toContain(scene.sceneCore.hiddenTruth)
    expect(renderGmContext(scene)).toContain(scene.sceneCore.hiddenTruth)
  })

  it('tất định trên pool thật', () => {
    const a = generateScene(realPool, { seed: 'that-4', mode: 'boss_mode', now: NOW }).scene
    const b = generateScene(realPool, { seed: 'that-4', mode: 'boss_mode', now: NOW }).scene
    expect(a).toEqual(b)
  })
})
