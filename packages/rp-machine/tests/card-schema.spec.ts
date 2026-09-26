import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CARD_TYPES,
  FRAGMENT_LIMITS,
  deleteCard,
  importRsmLibrary,
  loadPool,
  normalizeCard,
  poolSummary,
  toStoredCard,
  validateCard,
  writeCard,
  type Card,
} from '../src/card-schema'

const RSM_LIBRARY = 'C:\\Nghich\\Roleplay_Gemini_new\\data'

function tmpDir(prefix = 'rp-card-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** Card đúng hình dạng `rsm-card-v1` như app Python ghi ra. */
function rsmCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'rsm-card-v1',
    id: 'npc_thu_nghiem',
    title: 'NPC thử nghiệm',
    type: ['npc'],
    description: 'Một npc để test.',
    chaos: 3,
    tags: ['vampire', 'noble'],
    compatibility: {
      universal: false,
      domain: ['fantasy'],
      compatibleTags: ['castle'],
      requiredAnyTags: ['vampire'],
      requiredAllTags: [],
      incompatibleTags: ['cozy'],
      compatibleCardIds: [],
      incompatibleCardIds: [],
    },
    visibility: 'public',
    weight: 10,
    fragments: {
      prompt: 'Một kẻ săn mồi cổ đại bị chi phối bởi gu thẩm mỹ và không bao giờ ra tay trước khi khoe gu.',
      firstMessage: '',
      hiddenTruth: 'Hắn từng bị sỉ nhục vì lỗi mốt nên sợ bị coi là lạc hậu.',
      heavenRule: 'Kami-sama declares: lời nói dối thời thượng chỉ hiệu lực một lần.',
      contentBoundary: 'Không được để hắn trở nên vô hại hay hợp tác hoàn toàn.',
    },
    generationHints: { tone: ['dark comedy'], preferredUse: 'Cảnh xã giao.', avoidUse: 'Cảnh chiến đấu thuần.' },
    qualityNotes: ['Neo trung tâm tốt.'],
    metadata: { author: 'user', createdAt: '2026-05-04T00:00:00.000Z', updatedAt: '2026-05-04T00:00:00.000Z', source: 'default_test_deck' },
    ...overrides,
  }
}

/** Card theo schema MVP trước. */
function legacyCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cast-ma-carong',
    kind: 'cast',
    title: 'Ma cà rồng',
    directive: 'Một chỉ thị hành vi đủ dài để vượt ngưỡng tối thiểu của schema card cũ.',
    scale: 4,
    tags: ['vampire'],
    requires: ['fantasy'],
    forbids: ['cong-nghe-cao'],
    ...overrides,
  }
}

function pack(cards: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'rsm-card-set-v1',
    title: 'Pack thử',
    description: 'Pack để test.',
    recommendedChaosRange: { min: 8, max: 40 },
    sharedTags: ['vampire'],
    cards,
    ...overrides,
  }
}

describe('chuẩn hoá card rsm-card-v1', () => {
  it('nhận card đúng schema gốc, không đánh dấu migrate', () => {
    const result = normalizeCard(rsmCard())
    expect(result.issues).toEqual([])
    expect(result.migrated).toBe(false)
    expect(result.card?.type).toBe('npc')
    expect(result.card?.compatibility.requiredAnyTags).toEqual(['vampire'])
    expect(result.card?.fragments.heavenRule).toContain('Kami-sama')
  })

  it('giữ nguyên năm mảnh văn bản — đây là thứ bản cũ lưu mà không dùng', () => {
    const card = normalizeCard(rsmCard()).card!
    expect(card.fragments.prompt).not.toBe('')
    expect(card.fragments.hiddenTruth).not.toBe('')
    expect(card.fragments.heavenRule).not.toBe('')
    expect(card.fragments.contentBoundary).not.toBe('')
  })

  it('đọc được trường mechanics có cấu trúc (phần mở rộng)', () => {
    const result = normalizeCard(rsmCard({
      mechanics: {
        meters: [{ id: 'suspicion', label: 'Suspicion', min: 0, max: 5, start: 1, failAt: 5, description: 'Bị để ý.' }],
        forbiddenActions: ['tự nhận có vũ khí'],
        winSteps: ['Bước một', 'Bước hai'],
      },
    }))
    expect(result.issues).toEqual([])
    expect(result.card?.mechanics?.meters?.[0]?.failAt).toBe(5)
    expect(result.card?.mechanics?.forbiddenActions).toEqual(['tự nhận có vũ khí'])
  })

  it('từ chối meter có failAt không lớn hơn start, hoặc max nhỏ hơn failAt', () => {
    const bad = normalizeCard(rsmCard({ mechanics: { meters: [{ id: 'm', label: 'M', min: 0, max: 3, start: 3, failAt: 3, description: '' }] } }))
    expect(bad.card).toBeUndefined()
    expect(bad.issues.map(i => i.message).join(' ')).toMatch(/failAt .* phải lớn hơn start/)
  })
})

describe('migrate từ schema MVP trước', () => {
  it('ánh xạ kind/scale/directive/requires/forbids sang schema mới', () => {
    const result = normalizeCard(legacyCard())
    expect(result.issues).toEqual([])
    expect(result.migrated).toBe(true)
    const card = result.card!
    expect(card.type).toBe('npc')
    expect(card.chaos).toBe(4)
    expect(card.fragments.prompt).toContain('chỉ thị hành vi')
    expect(card.compatibility.requiredAnyTags).toEqual(['fantasy'])
    expect(card.compatibility.incompatibleTags).toEqual(['cong-nghe-cao'])
    expect(card.metadata.source).toBe('legacy-mvp-migration')
    expect(card.visibility).toBe('public')
  })

  it('ánh xạ đúng ba loại chỉ có ở MVP trước', () => {
    expect(normalizeCard(legacyCard({ kind: 'cast' })).card?.type).toBe('npc')
    expect(normalizeCard(legacyCard({ kind: 'interaction' })).card?.type).toBe('pressure')
    expect(normalizeCard(legacyCard({ kind: 'mystery' })).card?.type).toBe('hidden_truth')
  })

  it('card mystery migrate thành hidden_truth thì mặc định gm_only', () => {
    expect(normalizeCard(legacyCard({ kind: 'mystery' })).card?.visibility).toBe('gm_only')
  })

  it('từ chối kind lạ', () => {
    const result = normalizeCard(legacyCard({ kind: 'lore' }))
    expect(result.card).toBeUndefined()
    expect(result.issues[0]?.message).toMatch(/không ánh xạ được/)
  })
})

describe('luật validate', () => {
  it('từ chối chaos ngoài 1..5 và không nguyên', () => {
    expect(normalizeCard(rsmCard({ chaos: 0 })).card).toBeUndefined()
    expect(normalizeCard(rsmCard({ chaos: 6 })).card).toBeUndefined()
    expect(normalizeCard(rsmCard({ chaos: 2.5 })).card).toBeUndefined()
  })

  it('từ chối type không phải mảng một phần tử', () => {
    expect(normalizeCard(rsmCard({ type: [] })).card).toBeUndefined()
    expect(normalizeCard(rsmCard({ type: ['npc', 'goal'] })).card).toBeUndefined()
  })

  it('bắt buộc card hidden_truth phải giấu, không được public', () => {
    const result = normalizeCard(rsmCard({ type: ['hidden_truth'], visibility: 'public' }))
    expect(result.card).toBeUndefined()
    expect(result.issues.map(i => i.message).join(' ')).toMatch(/hidden_truth không được để visibility = public/)
  })

  it('chặn fragments vượt trần — đây là ràng buộc chống nhồi lore', () => {
    const result = normalizeCard(rsmCard({
      fragments: { ...(rsmCard()['fragments'] as object), prompt: 'x'.repeat(FRAGMENT_LIMITS.prompt + 1) },
    }))
    expect(result.card).toBeUndefined()
    expect(result.issues.map(i => i.message).join(' ')).toMatch(/vượt trần 1000/)
  })

  it('giữ firstMessage của card ngoài loại opening thay vì coi là hỏng', () => {
    // Thư viện cũ thật có card world đặt firstMessage. Không được làm mất dữ liệu; tầng scene chỉ
    // đọc firstMessage của card opening nên trường này được báo lại qua ImportReport.
    const result = normalizeCard(rsmCard({
      fragments: { ...(rsmCard()['fragments'] as object), firstMessage: 'Một câu mở màn lạc chỗ.' },
    }))
    expect(result.issues).toEqual([])
    expect(result.card?.fragments.firstMessage).toBe('Một câu mở màn lạc chỗ.')
  })

  it('cho phép card opening có firstMessage', () => {
    const result = normalizeCard(rsmCard({
      type: ['opening'],
      fragments: { ...(rsmCard()['fragments'] as object), firstMessage: 'Bạn tỉnh dậy trong căn bếp đầy khói.' },
    }))
    expect(result.issues).toEqual([])
  })

  it('từ chối incompatibleTags chứa tag của chính card', () => {
    const result = normalizeCard(rsmCard({
      compatibility: { ...(rsmCard()['compatibility'] as object), incompatibleTags: ['vampire'] },
    }))
    expect(result.card).toBeUndefined()
    expect(result.issues.map(i => i.message).join(' ')).toMatch(/chứa tag của chính card/)
  })

  it('từ chối card vừa yêu cầu vừa cấm cùng một tag', () => {
    const result = normalizeCard(rsmCard({
      compatibility: { ...(rsmCard()['compatibility'] as object), requiredAnyTags: ['castle'], incompatibleTags: ['castle'] },
    }))
    expect(result.card).toBeUndefined()
    expect(result.issues.map(i => i.message).join(' ')).toMatch(/vừa yêu cầu vừa cấm/)
  })

  it('từ chối id không phải snake/kebab case', () => {
    expect(normalizeCard(rsmCard({ id: 'NPC Thử Nghiệm' })).card).toBeUndefined()
  })

  it('visibility lạ bị báo lỗi nhưng vẫn suy ra mặc định theo loại', () => {
    const result = normalizeCard(rsmCard({ visibility: 'invisible' }))
    expect(result.card).toBeUndefined()
    expect(result.issues.map(i => i.message).join(' ')).toMatch(/visibility không hợp lệ/)
  })

  it('object rác bị từ chối thay vì nổ', () => {
    expect(normalizeCard(null).issues.length).toBeGreaterThan(0)
    expect(normalizeCard([]).issues.length).toBeGreaterThan(0)
    expect(normalizeCard({ hello: 'world' }).issues.length).toBeGreaterThan(0)
  })

  it('validateCard chạy được trực tiếp trên card đã chuẩn hoá', () => {
    const card = normalizeCard(rsmCard()).card!
    expect(validateCard(card)).toEqual([])
    expect(validateCard({ ...card, chaos: 9 }).length).toBeGreaterThan(0)
  })
})

describe('nạp pool nhiều hình dạng', () => {
  it('đọc được file card riêng, pack, và mảng cũ; ưu tiên file riêng khi trùng id', () => {
    const dir = tmpDir()
    const pool = path.join(dir, 'pool')
    fs.mkdirSync(path.join(pool, 'npc'), { recursive: true })
    fs.mkdirSync(path.join(pool, 'packs'), { recursive: true })

    // File riêng: tiêu đề "Bản chính".
    fs.writeFileSync(path.join(pool, 'npc', 'npc_thu_nghiem.json'), JSON.stringify(rsmCard({ title: 'Bản chính' })))
    // Pack chứa cùng id nhưng tiêu đề khác → phải bị bỏ.
    fs.writeFileSync(path.join(pool, 'packs', 'p1.json'), JSON.stringify(pack([rsmCard({ title: 'Bản trong pack' })])))
    // Mảng cũ với một id khác.
    fs.writeFileSync(path.join(pool, 'cards.json'), JSON.stringify([legacyCard({ id: 'cast_cu', kind: 'cast' })]))

    const loaded = loadPool(pool)
    expect(loaded.packs).toHaveLength(1)
    expect(loaded.cards.map(card => card.id).sort()).toEqual(['cast_cu', 'npc_thu_nghiem'])
    const canonical = loaded.cards.find(card => card.id === 'npc_thu_nghiem')!
    expect(canonical.title).toBe('Bản chính')
    expect(loaded.migratedCount).toBe(1)
    // Card đến từ pack là bản sao nên trùng id không bị coi là vấn đề: nếu báo, mỗi pack trong thư
    // viện sẽ đổ hàng chục dòng ồn vào báo cáo.
    expect(loaded.issues.map(issue => issue.message).join(' ')).not.toMatch(/id trùng/)
  })

  it('hai file card riêng trùng id thì được báo rõ', () => {
    const dir = tmpDir()
    const pool = path.join(dir, 'pool')
    fs.mkdirSync(path.join(pool, 'npc'), { recursive: true })
    fs.writeFileSync(path.join(pool, 'npc', 'npc_thu_nghiem.json'), JSON.stringify(rsmCard({ title: 'Bản đầu' })))
    fs.writeFileSync(path.join(pool, 'npc', 'npc_thu_nghiem_ban_hai.json'), JSON.stringify(rsmCard({ title: 'Bản sau' })))

    const loaded = loadPool(pool)
    expect(loaded.cards).toHaveLength(1)
    expect(loaded.cards[0]?.title).toBe('Bản đầu')
    expect(loaded.issues.map(issue => issue.message).join(' ')).toMatch(/id trùng/)
  })

  it('báo lỗi JSON hỏng nhưng vẫn nạp phần còn lại', () => {
    const dir = tmpDir()
    const pool = path.join(dir, 'pool')
    fs.mkdirSync(path.join(pool, 'npc'), { recursive: true })
    fs.writeFileSync(path.join(pool, 'npc', 'hong.json'), '{ khong phai json')
    fs.writeFileSync(path.join(pool, 'npc', 'npc_thu_nghiem.json'), JSON.stringify(rsmCard()))

    const loaded = loadPool(pool)
    expect(loaded.cards).toHaveLength(1)
    expect(loaded.issues.some(issue => issue.message.startsWith('JSON hỏng'))).toBe(true)
  })

  it('pool rỗng trả về rỗng, không nổ', () => {
    const dir = tmpDir()
    const loaded = loadPool(path.join(dir, 'khong-co'))
    expect(loaded.cards).toEqual([])
    expect(loaded.issues).toEqual([])
  })

  it('poolSummary đếm đúng theo loại, tổng chaos và số card gm_only', () => {
    const cards = [
      normalizeCard(rsmCard()).card!,
      normalizeCard(rsmCard({ id: 'hidden_thu_nghiem', type: ['hidden_truth'], visibility: 'gm_only', chaos: 4 })).card!,
    ]
    const summary = poolSummary(cards)
    expect(summary.total).toBe(2)
    expect(summary.byType['npc']).toBe(1)
    expect(summary.byType['hidden_truth']).toBe(1)
    expect(summary.totalChaos).toBe(7)
    expect(summary.gmOnly).toBe(1)
    expect(Object.keys(summary.byType).sort()).toEqual([...CARD_TYPES].sort())
  })
})

describe('ghi và xoá card', () => {
  it('writeCard ghi đúng thư mục loại và đọc lại được', () => {
    const dir = tmpDir()
    const pool = path.join(dir, 'pool')
    const card = normalizeCard(rsmCard()).card!
    const file = writeCard(pool, card)
    expect(file).toBe(path.join(pool, 'npc', 'npc_thu_nghiem.json'))
    expect(fs.existsSync(file)).toBe(true)

    const reloaded = loadPool(pool)
    expect(reloaded.cards).toHaveLength(1)
    expect(reloaded.cards[0]?.title).toBe(card.title)
    expect(reloaded.cards[0]?.fragments.heavenRule).toBe(card.fragments.heavenRule)
  })

  it('deleteCard xoá đúng card và trả false khi không thấy', () => {
    const dir = tmpDir()
    const pool = path.join(dir, 'pool')
    writeCard(pool, normalizeCard(rsmCard()).card!)
    expect(deleteCard(pool, 'npc_thu_nghiem')).toBe(true)
    expect(deleteCard(pool, 'npc_thu_nghiem')).toBe(false)
    expect(loadPool(pool).cards).toEqual([])
  })

  it('ghi ra đúng hình dạng rsm-card-v1 để app Python cũ vẫn đọc được', () => {    const dir = tmpDir()
    const pool = path.join(dir, 'pool')
    const card = normalizeCard(rsmCard()).card!
    const file = writeCard(pool, card)
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(stored['schemaVersion']).toBe('rsm-card-v1')
    expect(stored['type']).toEqual(['npc'])
    expect(Object.keys(stored['fragments'] as object).sort()).toEqual(
      ['contentBoundary', 'firstMessage', 'heavenRule', 'hiddenTruth', 'prompt'].sort(),
    )
    expect(stored['compatibility']).toBeTruthy()
  })

  it('pack ghi ra phải đọc lại được — type phải được bọc thành mảng', () => {
    // Hồi quy: đường ghi pack từng serialize card nội bộ trực tiếp, để `type` là chuỗi, nên mọi file
    // pack ghi ra đều không nạp lại được và bộ nguồn hoàn chỉnh trở nên vô hình.
    const dir = tmpDir()
    const pool = path.join(dir, 'pool')
    const stored = toStoredCard(normalizeCard(rsmCard()).card!)
    expect(stored['type']).toEqual(['npc'])

    fs.mkdirSync(path.join(pool, 'packs'), { recursive: true })
    fs.writeFileSync(path.join(pool, 'packs', 'p.json'), JSON.stringify({
      schemaVersion: 'rsm-card-set-v1',
      id: 'p',
      title: 'Pack',
      description: '',
      recommendedChaosRange: { min: 8, max: 40 },
      sharedTags: [],
      cards: [stored],
    }))

    const loaded = loadPool(pool)
    expect(loaded.issues).toEqual([])
    expect(loaded.packs).toHaveLength(1)
    expect(loaded.packs[0]?.cards).toHaveLength(1)
    expect(loaded.packs[0]?.cards[0]?.id).toBe('npc_thu_nghiem')
  })
})

// ── Tích hợp với thư viện thật của app Python cũ ──────────────────────────

const libraryExists = fs.existsSync(RSM_LIBRARY)

describe.skipIf(!libraryExists)('import thư viện Roleplay Scene Maker thật', () => {
  it('mọi card rời trong thư viện cũ validate sạch', () => {
    const report = importRsmLibrary(RSM_LIBRARY, tmpDir(), { dryRun: true })
    const fromStandalone = report.issues.filter(issue => issue.where.includes('\\cards\\'))
    expect(fromStandalone, JSON.stringify(fromStandalone, null, 2)).toEqual([])
    expect(report.read).toBe(25)
    expect(report.migrated).toBe(0)
    for (const type of CARD_TYPES) {
      expect(report.byType[type], `thiếu loại ${type}`).toBeGreaterThan(0)
    }
    expect(report.byType['world']).toBe(4)
    expect(report.byType['npc']).toBe(3)
  })

  it('báo cáo card hỏng nằm trong pack — dữ liệu cũ thật có', () => {
    // Pack Paradise_Hell chứa card với chaos = 8 và chaos = 35, ngoài khoảng 1..5. Đây là phát hiện
    // về dữ liệu cũ, không phải lỗi của bộ nạp: card rời tương ứng vẫn hợp lệ và thắng khi trùng id.
    const report = importRsmLibrary(RSM_LIBRARY, tmpDir(), { dryRun: true })
    expect(report.issues.length).toBeGreaterThan(0)
    expect(report.issues.every(issue => issue.where.includes('\\packs\\'))).toBe(true)
    expect(report.issues.some(issue => /chaos phải là số nguyên 1\.\.5 \(nhận 35\)/.test(issue.message))).toBe(true)
  })

  it('liệt kê firstMessage ngoài loại opening đang bị tầng scene bỏ qua', () => {
    const report = importRsmLibrary(RSM_LIBRARY, tmpDir(), { dryRun: true })
    expect(report.ignoredFirstMessage).toContain('world_endless_jungle')
  })

  it('mọi mảnh văn bản của thư viện cũ nằm trong trần cứng', () => {
    const report = importRsmLibrary(RSM_LIBRARY, tmpDir(), { dryRun: true })
    for (const [key, length] of Object.entries(report.maxFragmentLength)) {
      const limit = FRAGMENT_LIMITS[key as keyof typeof FRAGMENT_LIMITS]
      expect(length, `fragments.${key} dài ${length} > trần ${limit}`).toBeLessThanOrEqual(limit)
    }
  })

  it('ghi ra pool mới và nạp lại được đủ 25 card', () => {
    const out = path.join(tmpDir(), 'pool-v2')
    const report = importRsmLibrary(RSM_LIBRARY, out, { dryRun: false })
    expect(report.written).toBe(25)
    expect(report.packsWritten).toBeGreaterThan(0)

    const reloaded = loadPool(out)
    expect(reloaded.cards).toHaveLength(25)
    expect(reloaded.migratedCount).toBe(0)
    // Card hidden_truth phải giữ được gm_only và nội dung bí mật.
    const hidden = reloaded.cards.find(card => card.type === 'hidden_truth') as Card
    expect(hidden.visibility).toBe('gm_only')
    expect(hidden.fragments.hiddenTruth.length).toBeGreaterThan(0)
  })
})
