/**
 * Tầng card — schema `rsm-card-v1` (port từ Roleplay Scene Maker, app Python cũ).
 *
 * Vì sao port nguyên schema thay vì tự thiết kế lại: schema cũ đã đúng ở chỗ quan trọng nhất.
 * Mỗi card mang NĂM mảnh văn bản, và ba trong số đó là van chống "AI trả lời lãng xẹt":
 *
 *   prompt           — card cư xử thế nào trong cảnh
 *   firstMessage     — câu mở màn (chỉ card `opening` dùng)
 *   hiddenTruth      — điều GM biết mà người chơi không
 *   heavenRule       — luật phán xử của Thiên Đạo cho riêng card này
 *   contentBoundary  — lệnh cấm cứng để card không trôi khỏi mô hình
 *
 * Bản cũ lưu đủ năm mảnh nhưng CHỈ biên dịch `prompt` và `hiddenTruth` của đúng một card.
 * `contentBoundary` của mọi card và `hiddenTruth` của bảy loại còn lại chưa bao giờ được dùng
 * (xem docs/upgrade-plan.md §1). Ở đây chúng được giữ nguyên và sẽ được thi hành thật.
 *
 * Khác biệt có chủ đích so với bản cũ:
 *  - `visibility` được THI HÀNH, không chỉ hiển thị.
 *  - Trần cứng cho các mảnh chỉ thị (chống nhồi lore) — bản cũ không có trần nào.
 *  - Nhận thêm trường tuỳ chọn `mechanics` để card khai báo cơ chế có cấu trúc thay vì chỉ văn xuôi.
 *
 * Module này độc lập: không import gì từ tầng runtime hiện tại. Nó tồn tại song song để migrate dần
 * (xem docs/upgrade-plan.md §4, phase P1).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** Tám loại card. Mọi loại đều là một slot trong cảnh — kể cả `chaos`. */
export const CARD_TYPES = [
  'world',
  'player_role',
  'npc',
  'opening',
  'pressure',
  'goal',
  'hidden_truth',
  'chaos',
] as const
export type CardType = (typeof CARD_TYPES)[number]

/** Thứ tự lắp cảnh (giữ đúng thứ tự của bản cũ). */
export const ASSEMBLY_TYPES = CARD_TYPES
export type AssemblyType = CardType

export const VISIBILITY_OPTIONS = ['public', 'hidden', 'gm_only', 'locked'] as const
export type Visibility = (typeof VISIBILITY_OPTIONS)[number]

/** Mặc định theo loại: chỉ `hidden_truth` là bí mật. */
export const DEFAULT_VISIBILITY: Readonly<Record<CardType, Visibility>> = {
  world: 'public',
  player_role: 'public',
  npc: 'public',
  opening: 'public',
  pressure: 'public',
  goal: 'public',
  hidden_truth: 'gm_only',
  chaos: 'public',
}

export interface CardFragments {
  readonly prompt: string
  readonly firstMessage: string
  readonly hiddenTruth: string
  readonly heavenRule: string
  readonly contentBoundary: string
}

/** Trần ký tự cho các mảnh chỉ thị. Đây là ràng buộc chống nhồi lore, không phải gợi ý. */
export const FRAGMENT_LIMITS: Readonly<Record<keyof CardFragments, number>> = {
  prompt: 1000,
  firstMessage: 4000,
  hiddenTruth: 1000,
  heavenRule: 500,
  contentBoundary: 1000,
}

export interface CardCompatibility {
  readonly universal: boolean
  readonly domain: readonly string[]
  readonly compatibleTags: readonly string[]
  readonly requiredAnyTags: readonly string[]
  readonly requiredAllTags: readonly string[]
  readonly incompatibleTags: readonly string[]
  readonly compatibleCardIds: readonly string[]
  readonly incompatibleCardIds: readonly string[]
}

export interface GenerationHints {
  readonly tone: readonly string[]
  readonly preferredUse: string
  readonly avoidUse: string
}

export interface CardMetadata {
  readonly author: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly source: string
  readonly sourcePackId?: string
}

/** Một thanh căng thẳng có cấu trúc. Bản cũ hardcode đúng một thanh tên `suspicion`. */
export interface TensionMeterSpec {
  readonly id: string
  readonly label: string
  readonly min: number
  readonly max: number
  readonly start: number
  readonly failAt: number
  readonly description: string
}

/**
 * Cơ chế khai báo có cấu trúc — phần mở rộng của schema gốc.
 *
 * Bản cũ để `mechanics.winCondition`, `loseCondition`, `playerContract.allowed*` LUÔN rỗng và thanh
 * căng thẳng hardcode, còn card thì mô tả cơ chế bằng văn xuôi ("wins if he eats three courses before
 * Suspicion reaches 5") nên không ai cưỡng chế được. Trường này cho card khai báo thẳng thứ máy đọc
 * được; khi vắng mặt, tầng scene sẽ suy ra từ `fragments` và ghi lại mức độ tin cậy.
 */
export interface CardMechanics {
  readonly meters?: readonly TensionMeterSpec[]
  readonly winSteps?: readonly string[]
  readonly loseConditions?: readonly string[]
  readonly forbiddenActions?: readonly string[]
  readonly allowedAbilities?: readonly string[]
  readonly allowedKnowledge?: readonly string[]
  readonly allowedInventory?: readonly string[]
}

export interface Card {
  readonly schemaVersion: 'rsm-card-v1'
  readonly id: string
  readonly type: CardType
  readonly title: string
  readonly description: string
  readonly chaos: number
  readonly tags: readonly string[]
  readonly compatibility: CardCompatibility
  readonly visibility: Visibility
  readonly weight: number
  readonly fragments: CardFragments
  readonly generationHints: GenerationHints
  readonly qualityNotes: readonly string[]
  readonly metadata: CardMetadata
  readonly mechanics?: CardMechanics
}

export interface CardIssue {
  readonly where: string
  readonly message: string
}

export const PACK_SCHEMA_VERSION = 'rsm-card-set-v1'

export interface CardPack {
  readonly schemaVersion: 'rsm-card-set-v1'
  readonly id: string
  readonly title: string
  readonly description: string
  readonly recommendedChaosRange: { readonly min: number; readonly max: number }
  readonly sharedTags: readonly string[]
  readonly cards: readonly Card[]
}

const ID_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/
const TEXT_KEYS = ['prompt', 'firstMessage', 'hiddenTruth', 'heavenRule', 'contentBoundary'] as const
const COMPATIBILITY_LIST_KEYS = [
  'domain',
  'compatibleTags',
  'requiredAnyTags',
  'requiredAllTags',
  'incompatibleTags',
  'compatibleCardIds',
  'incompatibleCardIds',
] as const

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nowIso(): string {
  return new Date().toISOString()
}

function emptyCompatibility(): CardCompatibility {
  return {
    universal: false,
    domain: [],
    compatibleTags: [],
    requiredAnyTags: [],
    requiredAllTags: [],
    incompatibleTags: [],
    compatibleCardIds: [],
    incompatibleCardIds: [],
  }
}

function emptyFragments(): CardFragments {
  return { prompt: '', firstMessage: '', hiddenTruth: '', heavenRule: '', contentBoundary: '' }
}

/** Loại card của MVP trước → loại của schema gốc. */
const LEGACY_TYPE_MAP: Readonly<Record<string, CardType>> = {
  world: 'world',
  cast: 'npc',
  opening: 'opening',
  interaction: 'pressure',
  mystery: 'hidden_truth',
  goal: 'goal',
  chaos: 'chaos',
  player_role: 'player_role',
  npc: 'npc',
  pressure: 'pressure',
  hidden_truth: 'hidden_truth',
}

export interface NormalizeResult {
  readonly card?: Card
  readonly issues: readonly CardIssue[]
  /** Card này đã phải chuyển đổi từ schema MVP trước. */
  readonly migrated: boolean
}

/**
 * Chuẩn hoá một card thô về `Card`. Nhận hai hình dạng:
 *  1. `rsm-card-v1` (bản cũ) — `type` là mảng một phần tử, `fragments` là object.
 *  2. Schema MVP trước — `kind`/`directive`/`scale`/`requires`/`forbids`.
 * Không ném lỗi: card hỏng trả `issues` để pool bỏ qua nó mà vẫn dùng được phần còn lại.
 */
export function normalizeCard(raw: unknown, where = '(không rõ)'): NormalizeResult {
  const issues: CardIssue[] = []
  if (!isRecord(raw)) return { issues: [{ where, message: 'Card không phải object' }], migrated: false }

  // ── Đường 1: schema gốc ──────────────────────────────────────────────────
  if (raw['schemaVersion'] === 'rsm-card-v1') {
    const id = str(raw['id']).trim()
    const typeRaw = raw['type']
    const type = Array.isArray(typeRaw) && typeRaw.length === 1 ? String(typeRaw[0]) : ''
    const fragmentsRaw = isRecord(raw['fragments']) ? raw['fragments'] : {}
    const compatRaw = isRecord(raw['compatibility']) ? raw['compatibility'] : {}
    const hintsRaw = isRecord(raw['generationHints']) ? raw['generationHints'] : {}
    const metaRaw = isRecord(raw['metadata']) ? raw['metadata'] : {}

    const fragments: CardFragments = {
      prompt: str(fragmentsRaw['prompt']),
      firstMessage: str(fragmentsRaw['firstMessage']),
      hiddenTruth: str(fragmentsRaw['hiddenTruth']),
      heavenRule: str(fragmentsRaw['heavenRule']),
      contentBoundary: str(fragmentsRaw['contentBoundary']),
    }
    const compatibility: CardCompatibility = {
      universal: compatRaw['universal'] === true,
      domain: strList(compatRaw['domain']),
      compatibleTags: strList(compatRaw['compatibleTags']),
      requiredAnyTags: strList(compatRaw['requiredAnyTags']),
      requiredAllTags: strList(compatRaw['requiredAllTags']),
      incompatibleTags: strList(compatRaw['incompatibleTags']),
      compatibleCardIds: strList(compatRaw['compatibleCardIds']),
      incompatibleCardIds: strList(compatRaw['incompatibleCardIds']),
    }
    const visibilityRaw = str(raw['visibility'])
    const visibility = (VISIBILITY_OPTIONS as readonly string[]).includes(visibilityRaw)
      ? (visibilityRaw as Visibility)
      : defaultVisibilityFor(type)

    const card: Card = {
      schemaVersion: 'rsm-card-v1',
      id,
      type: type as CardType,
      title: str(raw['title']).trim(),
      description: str(raw['description']),
      chaos: typeof raw['chaos'] === 'number' ? raw['chaos'] : Number.NaN,
      tags: strList(raw['tags']),
      compatibility,
      visibility,
      weight: typeof raw['weight'] === 'number' ? raw['weight'] : 10,
      fragments,
      generationHints: {
        tone: strList(hintsRaw['tone']),
        preferredUse: str(hintsRaw['preferredUse']),
        avoidUse: str(hintsRaw['avoidUse']),
      },
      qualityNotes: strList(raw['qualityNotes']),
      metadata: {
        author: str(metaRaw['author']),
        createdAt: str(metaRaw['createdAt']),
        updatedAt: str(metaRaw['updatedAt']),
        source: str(metaRaw['source']),
        ...(str(metaRaw['sourcePackId']) === '' ? {} : { sourcePackId: str(metaRaw['sourcePackId']) }),
      },
      ...(isRecord(raw['mechanics']) ? { mechanics: normalizeMechanics(raw['mechanics'], where, issues) } : {}),
    }
    if (visibilityRaw !== '' && !(VISIBILITY_OPTIONS as readonly string[]).includes(visibilityRaw)) {
      issues.push({ where, message: `visibility không hợp lệ: ${JSON.stringify(visibilityRaw)}` })
    }
    issues.push(...validateCard(card, where))
    return issues.length > 0 ? { issues, migrated: false } : { card, issues: [], migrated: false }
  }

  // ── Đường 2: schema MVP trước ────────────────────────────────────────────
  if (typeof raw['kind'] === 'string' && typeof raw['directive'] === 'string') {
    const kindRaw = String(raw['kind'])
    const type = LEGACY_TYPE_MAP[kindRaw]
    if (type === undefined) {
      return { issues: [{ where, message: `kind cũ không ánh xạ được sang loại mới: ${kindRaw}` }], migrated: true }
    }
    const stamp = nowIso()
    const card: Card = {
      schemaVersion: 'rsm-card-v1',
      id: str(raw['id']).trim(),
      type,
      title: str(raw['title']).trim(),
      description: '',
      chaos: typeof raw['scale'] === 'number' ? raw['scale'] : Number.NaN,
      tags: strList(raw['tags']),
      compatibility: {
        ...emptyCompatibility(),
        // `requires` cũ nghĩa là "phải có tag này"; `forbids` là "không được có tag này".
        requiredAnyTags: strList(raw['requires']),
        incompatibleTags: strList(raw['forbids']),
      },
      visibility: DEFAULT_VISIBILITY[type],
      weight: 10,
      fragments: { ...emptyFragments(), prompt: String(raw['directive']) },
      generationHints: { tone: [], preferredUse: '', avoidUse: '' },
      qualityNotes: [],
      metadata: { author: '', createdAt: stamp, updatedAt: stamp, source: 'legacy-mvp-migration' },
    }
    issues.push(...validateCard(card, where))
    return issues.length > 0 ? { issues, migrated: true } : { card, issues: [], migrated: true }
  }

  return { issues: [{ where, message: 'Không nhận ra schema card (thiếu schemaVersion hoặc kind/directive)' }], migrated: false }
}

function defaultVisibilityFor(type: string): Visibility {
  return (DEFAULT_VISIBILITY as Readonly<Record<string, Visibility>>)[type] ?? 'public'
}

function normalizeMechanics(
  raw: Record<string, unknown>,
  where: string,
  issues: CardIssue[],
): CardMechanics {
  const mechanics: {
    meters?: TensionMeterSpec[]
    winSteps?: string[]
    loseConditions?: string[]
    forbiddenActions?: string[]
    allowedAbilities?: string[]
    allowedKnowledge?: string[]
    allowedInventory?: string[]
  } = {}

  if (Array.isArray(raw['meters'])) {
    const meters: TensionMeterSpec[] = []
    for (const [index, entry] of raw['meters'].entries()) {
      if (!isRecord(entry)) {
        issues.push({ where: `${where}.mechanics.meters[${index}]`, message: 'meter phải là object' })
        continue
      }
      const meter: TensionMeterSpec = {
        id: str(entry['id']),
        label: str(entry['label']),
        min: typeof entry['min'] === 'number' ? entry['min'] : 0,
        max: typeof entry['max'] === 'number' ? entry['max'] : 5,
        start: typeof entry['start'] === 'number' ? entry['start'] : 0,
        failAt: typeof entry['failAt'] === 'number' ? entry['failAt'] : 5,
        description: str(entry['description']),
      }
      if (meter.id === '') issues.push({ where: `${where}.mechanics.meters[${index}]`, message: 'meter thiếu id' })
      if (meter.failAt <= meter.start) {
        issues.push({ where: `${where}.mechanics.meters[${index}]`, message: `failAt (${meter.failAt}) phải lớn hơn start (${meter.start})` })
      }
      if (meter.max < meter.failAt) {
        issues.push({ where: `${where}.mechanics.meters[${index}]`, message: `max (${meter.max}) phải >= failAt (${meter.failAt})` })
      }
      meters.push(meter)
    }
    mechanics.meters = meters
  }

  for (const key of ['winSteps', 'loseConditions', 'forbiddenActions', 'allowedAbilities', 'allowedKnowledge', 'allowedInventory'] as const) {
    const value = raw[key]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
      issues.push({ where: `${where}.mechanics.${key}`, message: 'phải là mảng chuỗi' })
      continue
    }
    mechanics[key] = strList(value)
  }
  return mechanics
}

/** Kiểm tra một card đã chuẩn hoá. Trả về danh sách lỗi (rỗng = hợp lệ). */
export function validateCard(card: Card, where = card.id || '(không rõ)'): CardIssue[] {
  const issues: CardIssue[] = []
  if (!ID_PATTERN.test(card.id)) {
    issues.push({ where, message: `id phải là snake_case hoặc kebab-case: ${JSON.stringify(card.id)}` })
  }
  if (card.title === '') issues.push({ where, message: 'thiếu title' })
  if (!(CARD_TYPES as readonly string[]).includes(card.type)) {
    issues.push({ where, message: `type không hợp lệ: ${JSON.stringify(card.type)} (phải là một trong ${CARD_TYPES.join(', ')})` })
  }
  if (!Number.isInteger(card.chaos) || card.chaos < 1 || card.chaos > 5) {
    issues.push({ where, message: `chaos phải là số nguyên 1..5 (nhận ${JSON.stringify(card.chaos)})` })
  }
  if (!Number.isInteger(card.weight) || card.weight < 0) {
    issues.push({ where, message: `weight phải là số nguyên >= 0 (nhận ${JSON.stringify(card.weight)})` })
  }
  if (!(VISIBILITY_OPTIONS as readonly string[]).includes(card.visibility)) {
    issues.push({ where, message: `visibility không hợp lệ: ${JSON.stringify(card.visibility)}` })
  }
  if (card.type === 'hidden_truth' && card.visibility === 'public') {
    issues.push({ where, message: 'card hidden_truth không được để visibility = public: nội dung của nó là bí mật của ván' })
  }
  // Trần cứng chống nhồi lore — bản cũ không có, và đây là lý do card cũ phình thành lorebook.
  for (const key of TEXT_KEYS) {
    const text = card.fragments[key]
    const limit = FRAGMENT_LIMITS[key]
    if (text.length > limit) {
      issues.push({
        where,
        message: `fragments.${key} vượt trần ${limit} ký tự (${text.length}) — đây là chỉ thị hành vi, không phải tư liệu thế giới`,
      })
    }
  }
  if (card.type !== 'opening' && card.fragments.firstMessage !== '') {
    // Không phải lỗi: dữ liệu cũ có card đặt firstMessage ngoài loại opening (ví dụ
    // world_endless_jungle). Tầng scene chỉ đọc firstMessage của card opening, nên trường này bị
    // bỏ qua chứ không bị coi là hỏng — xem ImportReport.ignoredFirstMessage để biết nội dung nào
    // đang bị bỏ qua.
  }
  const comp = card.compatibility
  for (const key of COMPATIBILITY_LIST_KEYS) {
    if (!Array.isArray(comp[key])) issues.push({ where, message: `compatibility.${key} phải là mảng` })
  }
  for (const tag of comp.incompatibleTags) {
    if (card.tags.includes(tag)) {
      issues.push({ where, message: `compatibility.incompatibleTags chứa tag của chính card: ${tag}` })
    }
  }
  const overlap = comp.incompatibleTags.filter(
    tag => comp.requiredAnyTags.includes(tag) || comp.requiredAllTags.includes(tag),
  )
  if (overlap.length > 0) {
    issues.push({ where, message: `card vừa yêu cầu vừa cấm cùng tag: ${overlap.join(', ')}` })
  }
  return issues
}

export function emptyCard(type: CardType, id: string, title: string): Card {
  const stamp = nowIso()
  return {
    schemaVersion: 'rsm-card-v1',
    id,
    type,
    title,
    description: '',
    chaos: 2,
    tags: [],
    compatibility: emptyCompatibility(),
    visibility: DEFAULT_VISIBILITY[type],
    weight: 10,
    fragments: emptyFragments(),
    generationHints: { tone: [], preferredUse: '', avoidUse: '' },
    qualityNotes: [],
    metadata: { author: '', createdAt: stamp, updatedAt: stamp, source: 'manual' },
  }
}

// ── Đọc / ghi pool ─────────────────────────────────────────────────────────

export interface LoadedPool {
  readonly cards: readonly Card[]
  readonly packs: readonly CardPack[]
  readonly issues: readonly CardIssue[]
  /** Số card phải chuyển đổi từ schema MVP trước. */
  readonly migratedCount: number
}

function readJsonFile(file: string, issues: CardIssue[]): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch (error) {
    issues.push({ where: file, message: `JSON hỏng: ${error instanceof Error ? error.message : String(error)}` })
    return undefined
  }
}

function parsePack(raw: Record<string, unknown>, where: string, issues: CardIssue[]): CardPack | undefined {
  if (raw['schemaVersion'] !== PACK_SCHEMA_VERSION) return undefined
  const cardsRaw = Array.isArray(raw['cards']) ? raw['cards'] : []
  const cards: Card[] = []
  for (const [index, entry] of cardsRaw.entries()) {
    const result = normalizeCard(entry, `${where}.cards[${index}]`)
    issues.push(...result.issues)
    if (result.card !== undefined) cards.push(result.card)
  }
  const rangeRaw = isRecord(raw['recommendedChaosRange']) ? raw['recommendedChaosRange'] : {}
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    id: str(raw['id']) === '' ? path.basename(where).replace(/\.json$/, '') : str(raw['id']),
    title: str(raw['title']),
    description: str(raw['description']),
    recommendedChaosRange: {
      min: typeof rangeRaw['min'] === 'number' ? rangeRaw['min'] : 8,
      max: typeof rangeRaw['max'] === 'number' ? rangeRaw['max'] : 40,
    },
    sharedTags: strList(raw['sharedTags']),
    cards,
  }
}

interface CollectTarget {
  cards: Card[]
  packs: CardPack[]
  migrated: number
}

interface StagedCard {
  readonly card: Card
  /** Card này đến từ một pack (bản sao), không phải file card riêng. */
  readonly fromPack: boolean
}

function collectCardFile(file: string, issues: CardIssue[], out: CollectTarget, into: { entries: StagedCard[] }): void {
  const parsed = readJsonFile(file, issues)
  if (parsed === undefined) return

  if (Array.isArray(parsed)) {
    // pool/cards.json của MVP trước: một mảng card.
    for (const [index, entry] of parsed.entries()) {
      const result = normalizeCard(entry, `${file}[${index}]`)
      issues.push(...result.issues)
      if (result.card === undefined) continue
      into.entries.push({ card: result.card, fromPack: false })
      if (result.migrated) out.migrated++
    }
    return
  }
  if (!isRecord(parsed)) {
    issues.push({ where: file, message: 'Nội dung phải là object hoặc array' })
    return
  }
  const pack = parsePack(parsed, file, issues)
  if (pack !== undefined) {
    out.packs.push(pack)
    for (const card of pack.cards) into.entries.push({ card, fromPack: true })
    return
  }
  const result = normalizeCard(parsed, file)
  issues.push(...result.issues)
  if (result.card === undefined) return
  into.entries.push({ card: result.card, fromPack: false })
  if (result.migrated) out.migrated++
}

function listJsonFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(entry => path.join(dir, entry.name))
    .sort()
}

export interface LoadPoolOptions {
  /**
   * Ghi lại issue khi hai card trùng id. Đặt false khi nạp một thư mục chỉ chứa pack: pack vốn là
   * bản sao của cùng một bộ card nên trùng id giữa các pack là bình thường, không phải vấn đề.
   */
  readonly reportDuplicates?: boolean
}

/**
 * Nạp pool từ thư mục. Nhận đồng thời ba hình dạng để migrate dần:
 *   <pool>/<type>/<id>.json   (layout của bản cũ — nguồn chính)
 *   <pool>/packs/*.json       (rsm-card-set-v1)
 *   <pool>/cards.json         (mảng card của MVP trước)
 * Card trùng id: bản đọc trước thắng. Thứ tự ưu tiên là file card riêng > pack > mảng cũ, vì
 * file card riêng là nguồn chính còn pack chỉ chứa bản sao.
 */
export function loadPool(poolDir: string, options: LoadPoolOptions = {}): LoadedPool {
  const issues: CardIssue[] = []
  const out: CollectTarget = { cards: [], packs: [], migrated: 0 }
  const seen = new Set<string>()

  const files: string[] = []
  for (const type of CARD_TYPES) {
    const dir = path.join(poolDir, type)
    if (fs.existsSync(dir)) files.push(...listJsonFiles(dir))
  }
  const packsDir = path.join(poolDir, 'packs')
  if (fs.existsSync(packsDir)) files.push(...listJsonFiles(packsDir))
  const legacyArray = path.join(poolDir, 'cards.json')
  if (fs.existsSync(legacyArray)) files.push(legacyArray)

  for (const file of files) {
    const staged = { entries: [] as StagedCard[] }
    collectCardFile(file, issues, out, staged)
    for (const entry of staged.entries) {
      if (seen.has(entry.card.id)) {
        // Card đến từ pack là bản sao của file card riêng, nên trùng id ở đó là chuyện bình thường.
        if (options.reportDuplicates !== false && !entry.fromPack) {
          issues.push({ where: file, message: `id trùng, bỏ qua bản sau: ${entry.card.id}` })
        }
        continue
      }
      seen.add(entry.card.id)
      out.cards.push(entry.card)
    }
  }

  return { cards: out.cards, packs: out.packs, issues, migratedCount: out.migrated }
}

/**
 * Chuyển card nội bộ về hình dạng dây `rsm-card-v1` để ghi ra đĩa. Dùng chung cho cả file card riêng
 * và card nằm trong pack — trước đây hai đường ghi khác nhau, và đường ghi pack quên bọc `type`
 * thành mảng nên mọi pack ghi ra đều không nạp lại được.
 */
export function toStoredCard(card: Card): Record<string, unknown> {
  return {
    schemaVersion: card.schemaVersion,
    id: card.id,
    title: card.title,
    type: [card.type],
    description: card.description,
    chaos: card.chaos,
    tags: [...card.tags],
    compatibility: {
      universal: card.compatibility.universal,
      domain: [...card.compatibility.domain],
      compatibleTags: [...card.compatibility.compatibleTags],
      requiredAnyTags: [...card.compatibility.requiredAnyTags],
      requiredAllTags: [...card.compatibility.requiredAllTags],
      incompatibleTags: [...card.compatibility.incompatibleTags],
      compatibleCardIds: [...card.compatibility.compatibleCardIds],
      incompatibleCardIds: [...card.compatibility.incompatibleCardIds],
    },
    visibility: card.visibility,
    weight: card.weight,
    fragments: { ...card.fragments },
    generationHints: {
      tone: [...card.generationHints.tone],
      preferredUse: card.generationHints.preferredUse,
      avoidUse: card.generationHints.avoidUse,
    },
    qualityNotes: [...card.qualityNotes],
    ...(card.mechanics === undefined ? {} : { mechanics: card.mechanics }),
    metadata: { ...card.metadata, updatedAt: nowIso() },
  }
}

/** Ghi một card vào đúng thư mục loại của nó. Trả về đường dẫn file. */
export function writeCard(poolDir: string, card: Card): string {
  const dir = path.join(poolDir, card.type)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${card.id}.json`)
  fs.writeFileSync(file, `${JSON.stringify(toStoredCard(card), null, 2)}\n`, 'utf8')
  return file
}

export function deleteCard(poolDir: string, id: string): boolean {
  for (const type of CARD_TYPES) {
    const file = path.join(poolDir, type, `${id}.json`)
    if (fs.existsSync(file)) {
      fs.rmSync(file)
      return true
    }
  }
  return false
}

export function cardsOfType(cards: readonly Card[], type: CardType): Card[] {
  return cards.filter(card => card.type === type)
}

/** Một dòng gọn cho prompt: một card một dòng, không xuống dòng. */
export function renderCardLine(card: Card): string {
  return `- [${card.type} ${card.chaos}/5] ${card.title} — ${card.fragments.prompt}`
}

/** Card có bị giấu khỏi người chơi không (chỉ `public` là người chơi thấy). */
export function isGmOnly(card: Card): boolean {
  return card.visibility !== 'public'
}

// ── Import từ thư viện của app Python cũ ───────────────────────────────────

export interface ImportReport {
  readonly read: number
  readonly written: number
  readonly packsWritten: number
  readonly migrated: number
  readonly issues: readonly CardIssue[]
  readonly byType: Readonly<Record<string, number>>
  /** Độ dài lớn nhất từng mảnh, để đối chiếu với trần cứng. */
  readonly maxFragmentLength: Readonly<Record<string, number>>
  /**
   * Id của những card có `fragments.firstMessage` nhưng không phải loại `opening`. Trường này bị
   * tầng scene bỏ qua, nên liệt kê ra để nội dung không biến mất trong im lặng.
   */
  readonly ignoredFirstMessage: readonly string[]
}

/**
 * Đọc thư viện của app Python cũ (`roleplay-machine` gốc) và ghi ra layout pool mới.
 *
 * Layout nguồn có hai gốc khác nhau nên phải nạp hai lần:
 *   <data>/cards/<type>/*.json   (một card một file)
 *   <data>/packs/*.json          (rsm-card-set-v1)
 * Thư mục `_invalid` và `_invalid_pack_imports` bị bỏ qua vì không nằm trong CARD_TYPES.
 *
 * `dryRun` chỉ đọc và báo cáo, không ghi gì.
 */
export function importRsmLibrary(
  sourceDataDir: string,
  outPoolDir: string,
  options?: { readonly dryRun?: boolean },
): ImportReport {
  const issues: CardIssue[] = []
  const cards = new Map<string, Card>()
  const packs = new Map<string, CardPack>()

  const cardsDir = path.join(sourceDataDir, 'cards')
  const sources = [fs.existsSync(cardsDir) ? cardsDir : undefined, sourceDataDir].filter(
    (entry): entry is string => entry !== undefined,
  )

  for (const source of sources) {
    // Nguồn thứ hai là gốc `data/` chỉ để lấy pack; trùng id giữa các pack là bình thường.
    const loaded = loadPool(source, { reportDuplicates: source === cardsDir })
    issues.push(...loaded.issues)
    for (const card of loaded.cards) {
      if (!cards.has(card.id)) cards.set(card.id, card)
    }
    for (const pack of loaded.packs) {
      if (!packs.has(pack.id)) packs.set(pack.id, pack)
    }
  }

  const byType: Record<string, number> = {}
  for (const type of CARD_TYPES) byType[type] = 0
  const maxFragmentLength: Record<string, number> = {}
  for (const key of TEXT_KEYS) maxFragmentLength[key] = 0
  const ignoredFirstMessage: string[] = []
  let migrated = 0

  for (const card of cards.values()) {
    byType[card.type] = (byType[card.type] ?? 0) + 1
    for (const key of TEXT_KEYS) {
      maxFragmentLength[key] = Math.max(maxFragmentLength[key] ?? 0, card.fragments[key].length)
    }
    if (card.type !== 'opening' && card.fragments.firstMessage !== '') ignoredFirstMessage.push(card.id)
    if (card.metadata.source === 'legacy-mvp-migration') migrated++
  }

  let written = 0
  let packsWritten = 0
  if (options?.dryRun !== true) {
    for (const card of cards.values()) {
      const file = writeCard(outPoolDir, card)
      void file
      written++
    }
    const packsOut = path.join(outPoolDir, 'packs')
    fs.mkdirSync(packsOut, { recursive: true })
    for (const pack of packs.values()) {
      const stored = {
        schemaVersion: pack.schemaVersion,
        id: pack.id,
        title: pack.title,
        description: pack.description,
        recommendedChaosRange: { ...pack.recommendedChaosRange },
        sharedTags: [...pack.sharedTags],
        cards: pack.cards.map(toStoredCard),
      }
      fs.writeFileSync(path.join(packsOut, `${pack.id}.json`), `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
      packsWritten++
    }
  }

  return {
    read: cards.size,
    written,
    packsWritten,
    migrated,
    issues,
    byType,
    maxFragmentLength,
    ignoredFirstMessage,
  }
}

/** Thống kê nhanh cho tool/UI. */
export function poolSummary(cards: readonly Card[]): {
  total: number
  byType: Record<string, number>
  totalChaos: number
  gmOnly: number
} {
  const byType: Record<string, number> = {}
  for (const type of CARD_TYPES) byType[type] = 0
  let totalChaos = 0
  let gmOnly = 0
  for (const card of cards) {
    byType[card.type] = (byType[card.type] ?? 0) + 1
    totalChaos += card.chaos
    if (isGmOnly(card)) gmOnly++
  }
  return { total: cards.length, byType, totalChaos, gmOnly }
}
