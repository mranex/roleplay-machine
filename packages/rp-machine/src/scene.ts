/**
 * Tầng scene — sinh một ván chơi từ pool card, tất định theo seed.
 *
 * Port từ `scene_generator.py` của Roleplay Scene Maker, nhưng sửa những chỗ bản cũ chỉ ghi ra giấy
 * (xem docs/upgrade-plan.md §1). Cụ thể:
 *
 *  - Chaos là TỔNG điểm của 8 slot, thang 5 tầng như bản cũ — không phải trung bình.
 *  - "Wild but Valid" có nhánh thật (thưởng card mang tag mới), thay vì là bí danh của Balanced.
 *  - Strictness tách đúng: `strict` đòi cảnh sạch hoàn toàn, `soft` chỉ cấm vi phạm cứng, `chaotic`
 *    nhận hết nhưng phạt nặng. Bản cũ để `soft` trùng `chaotic` vì guard không bao giờ chạm.
 *  - `maxAttempts` bị bỏ hẳn (bản cũ có control nhưng không đọc).
 *  - Pool được sắp theo id trước khi sinh, nên cùng seed + cùng pool cho cùng cảnh bất kể thứ tự
 *    file trên đĩa. Bản cũ phụ thuộc thứ tự `rglob`.
 *  - `mechanics`, `playerContract`, `kamiSama.rules` được VẬT CHẤT HOÁ từ card. Bản cũ để
 *    `winCondition`/`loseCondition`/`allowed*` luôn rỗng và chỉ biên dịch `prompt` + `hiddenTruth`.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  CARD_TYPES,
  cardsOfType,
  type Card,
  type CardFragments,
  type CardType,
  type TensionMeterSpec,
} from './card-schema'
import { BASE_KAMI_RULES, checkScene, scoreCandidate } from './compatibility'
import { createRng, type Rng } from './rng'

// ── Ba chế độ chơi ─────────────────────────────────────────────────────────

export const PLAY_MODES = ['coward', 'semi_coward', 'boss_mode'] as const
export type PlayMode = (typeof PLAY_MODES)[number]

export interface ModeInfo {
  readonly label: string
  readonly maxManual: number
  readonly description: string
}

export const MODE_INFO: Readonly<Record<PlayMode, ModeInfo>> = {
  coward: {
    label: 'Tôi là người bình thường',
    maxManual: 8,
    description: 'Bạn tự chọn card cho mọi slot. Kiểm soát toàn bộ trải nghiệm.',
  },
  semi_coward: {
    label: 'Tôi có hơi bất thường',
    maxManual: 3,
    description: 'Bạn chọn tối đa 3 slot, phần còn lại do Thiên Đạo rút. Sự thật bị niêm phong.',
  },
  boss_mode: {
    label: 'Tôi là siêu anh hùng',
    maxManual: 0,
    description: 'Không chọn gì cả. Để thế giới tự chuyển động.',
  },
}

/**
 * Slot bị giấu. Theo quyết định thiết kế, chỉ `hidden_truth` là bí mật — `player_role` và `goal`
 * công khai để người chơi biết mình là ai và phải làm gì (bản cũ cũng vậy).
 */
export const HIDDEN_SLOTS: readonly CardType[] = ['hidden_truth']

// ── Chaos scale: TỔNG điểm, 5 tầng ─────────────────────────────────────────

export type ChaosLevel = 'grounded' | 'strange' | 'unstable' | 'chaotic' | 'reality_breaking'

export interface ChaosReport {
  readonly total: number
  readonly level: ChaosLevel
  readonly description: string
  /** Số lượt tối đa giữa hai biến cố cưỡng bức. */
  readonly eventEvery: number
  readonly mayBendRules: boolean
  readonly npcMayLie: boolean
}

const CHAOS_TABLE: readonly { readonly max: number; readonly level: ChaosLevel; readonly description: string }[] = [
  { max: 12, level: 'grounded', description: 'Thế giới bám đất và dễ theo.' },
  { max: 18, level: 'strange', description: 'Có nét lạ nhưng vẫn đứng vững.' },
  { max: 25, level: 'unstable', description: 'Luật thế giới bắt đầu lung lay.' },
  { max: 32, level: 'chaotic', description: 'Thiên Đạo không còn giả vờ rằng thực tại được bảo hành.' },
  { max: Number.POSITIVE_INFINITY, level: 'reality_breaking', description: 'Thực tại đã mất. Không còn gì để bám vào.' },
]

export function chaosOf(cards: readonly Card[]): ChaosReport {
  const total = cards.reduce((sum, card) => sum + card.chaos, 0)
  const tier = CHAOS_TABLE.find(entry => total <= entry.max) ?? CHAOS_TABLE[CHAOS_TABLE.length - 1]!
  const levers = (() => {
    switch (tier.level) {
      case 'grounded':
        return { eventEvery: 4, mayBendRules: false, npcMayLie: false }
      case 'strange':
        return { eventEvery: 4, mayBendRules: false, npcMayLie: false }
      case 'unstable':
        return { eventEvery: 3, mayBendRules: false, npcMayLie: false }
      case 'chaotic':
        return { eventEvery: 2, mayBendRules: true, npcMayLie: false }
      case 'reality_breaking':
        return { eventEvery: 2, mayBendRules: true, npcMayLie: true }
    }
  })()
  return { total, level: tier.level, description: tier.description, ...levers }
}

// ── Cấu hình sinh ──────────────────────────────────────────────────────────

export const SAMPLING_MODES = ['balanced_random', 'high_compatibility', 'wild_but_valid', 'chaos_roulette'] as const
export type SamplingMode = (typeof SAMPLING_MODES)[number]

export const STRICTNESS_LEVELS = ['strict', 'soft', 'chaotic'] as const
export type Strictness = (typeof STRICTNESS_LEVELS)[number]

/**
 * Mạch lạc của cảnh — quyết định card được lấy từ đâu.
 *
 * `single_source`: lấy cả 8 slot từ MỘT bộ nguồn hoàn chỉnh (một pack). Cảnh mạch lạc theo cấu tạo,
 *   vì pack vốn được thiết kế như một thế giới. Đây là mặc định, và là thứ sửa lỗi trộn pack.
 * `mixed`: rút từng slot từ toàn pool như bản cũ. Ra thế giới Frankenstein — vui, nhưng thường vô
 *   nghĩa nếu pool không có đồ thị tương thích đủ dày.
 */
export const COHERENCE_MODES = ['single_source', 'mixed'] as const
export type Coherence = (typeof COHERENCE_MODES)[number]

export interface SceneSettings {
  readonly coherence: Coherence
  readonly samplingMode: SamplingMode
  readonly strictness: Strictness
  /** 0..100 — càng cao thì phân bố càng phẳng (đa dạng hơn). */
  readonly variety: number
  /** 0..100 — mức ảnh hưởng của điểm tương thích. */
  readonly compatibilityInfluence: number
  /** 0..100 — mức ảnh hưởng của `weight` từng card. */
  readonly cardWeightInfluence: number
  readonly avoidRecentCards: boolean
  readonly avoidSamePackClumping: boolean
}

export const DEFAULT_SETTINGS: SceneSettings = {
  coherence: 'single_source',
  samplingMode: 'balanced_random',
  strictness: 'soft',
  variety: 55,
  compatibilityInfluence: 55,
  cardWeightInfluence: 70,
  avoidRecentCards: true,
  avoidSamePackClumping: true,
}

/** Một bộ nguồn hoàn chỉnh (pack) — đơn vị mạch lạc tự nhiên của thế giới. */
export interface CardSource {
  readonly id: string
  readonly title: string
  readonly cards: readonly Card[]
}

/** Số cảnh ứng viên dựng ra trước khi chọn. Bản cũ dùng đúng bảng này. */
const CANDIDATE_COUNT: Readonly<Record<SamplingMode, number>> = {
  balanced_random: 20,
  high_compatibility: 30,
  wild_but_valid: 20,
  chaos_roulette: 10,
}

// ── Kiểu dữ liệu scene ─────────────────────────────────────────────────────

export interface SceneCore {
  readonly worldSummary: string
  readonly playerRole: string
  readonly mainNpc: string
  readonly openingSituation: string
  readonly pressure: string
  readonly goal: string
  readonly hiddenTruth: string
  readonly chaosTwist: string
}

export interface PlayerContract {
  readonly role: string
  readonly allowedAbilities: readonly string[]
  readonly allowedKnowledge: readonly string[]
  readonly allowedInventory: readonly string[]
  readonly forbiddenActions: readonly string[]
  readonly outOfCharacterExamples: readonly string[]
}

export interface KamiSama {
  readonly enabled: boolean
  /** 1..5, suy từ strictness. Bản cũ hardcode 5. */
  readonly strictness: number
  readonly policy: 'warn_then_terminate'
  readonly warningStyle: string
  readonly rules: readonly string[]
  readonly warningLine: string
  readonly terminationLine: string
}

export interface MeterSpec extends TensionMeterSpec {
  /** `true` nếu thanh này do tầng scene suy ra, không phải card khai báo. */
  readonly derived: boolean
}

/** Một bước thắng có cấu trúc mà runtime đếm được. */
export interface SceneWinStep {
  readonly id: string
  readonly description: string
}

export interface SceneMechanics {
  readonly tensionMeters: readonly MeterSpec[]
  /** Chuỗi hiển thị cho người chơi. */
  readonly winCondition: string
  readonly loseCondition: string
  /** Bước thắng có cấu trúc — runtime đếm trên danh sách này. */
  readonly winSteps: readonly SceneWinStep[]
  readonly loseConditions: readonly string[]
  readonly softFailOptions: readonly string[]
}

export interface GeneratedScene {
  readonly schemaVersion: 'rp-scene-v1'
  readonly id: string
  readonly seed: string
  readonly createdAt: string
  readonly mode: {
    readonly id: PlayMode
    readonly label: string
    readonly selectedSlots: readonly CardType[]
    readonly randomSlots: readonly CardType[]
    readonly hiddenSlots: readonly CardType[]
  }
  readonly settings: SceneSettings
  readonly chaos: ChaosReport
  /** Bộ nguồn đã dùng khi coherence = single_source; null khi trộn từ toàn pool. */
  readonly source: { readonly id: string; readonly title: string } | null
  readonly cards: Readonly<Record<CardType, Card>>
  readonly cardFragments: Readonly<Record<CardType, CardFragments>>
  readonly sceneCore: SceneCore
  readonly playerContract: PlayerContract
  readonly kamiSama: KamiSama
  readonly mechanics: SceneMechanics
  readonly compatibilityReport: {
    readonly isCompatible: boolean
    readonly score: number
    readonly errors: readonly string[]
    readonly warnings: readonly string[]
  }
  /** Trường nào do tầng scene suy ra thay vì card khai báo. Bản cũ để rỗng mà không ai biết. */
  readonly derivation: { readonly derived: readonly string[] }
}

export interface SceneRequest {
  readonly seed: string
  readonly mode: PlayMode
  readonly picks?: Partial<Record<CardType, string>>
  readonly settings?: Partial<SceneSettings>
  /** Bộ nguồn hoàn chỉnh để dùng khi coherence = single_source. */
  readonly sources?: readonly CardSource[]
  /** Id card đã dùng gần đây, để giảm khả năng lặp. */
  readonly recentCardIds?: readonly string[]
  readonly now?: string
}

export interface GenerationOutcome {
  readonly scene: GeneratedScene
  readonly notes: readonly string[]
  readonly considered: number
}

// ── Tiện ích ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'seed'
}

/** Chọn theo trọng số. Trả undefined khi danh sách rỗng. */
function pickWeighted<T>(items: readonly T[], weights: readonly number[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined
  const total = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0)
  if (!(total > 0)) return items[Math.floor(rng.next() * items.length)]
  let threshold = rng.next() * total
  for (let i = 0; i < items.length; i++) {
    threshold -= Math.max(weights[i] ?? 0, 0)
    if (threshold <= 0) return items[i]
  }
  return items[items.length - 1]
}

/** Tách câu để biến `contentBoundary` thành danh sách việc bị cấm. */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  return trimmed
    .split(/(?<=[.!?;])\s+/)
    .map(part => part.trim().replace(/[.;]+$/, ''))
    .filter(part => part.length > 8)
}

function tagsOf(cards: readonly Card[]): Set<string> {
  const tags = new Set<string>()
  for (const card of cards) for (const tag of card.tags) tags.add(tag)
  return tags
}

function packIdOf(card: Card): string {
  return card.metadata.sourcePackId ?? card.metadata.source
}

// ── Sinh scene ─────────────────────────────────────────────────────────────

export interface CardWeightContext {
  /** Điểm cặp cộng dồn giữa card này và phần scene đã chọn. */
  readonly pairScore: number
  readonly settings: SceneSettings
  readonly isRecent: boolean
  /** Số card cùng nguồn (pack) đã có trong scene. */
  readonly packCount: number
  readonly sceneTags: ReadonlySet<string>
}

/**
 * Trọng số rút của một card. Hàm thuần để test được từng chế độ sampling một cách tất định,
 * thay vì phải suy ra hành vi từ thống kê qua nhiều seed.
 *
 * Công thức gốc của bản cũ: `(score+20)^1.1 * weight^1.4` rồi lấy căn bậc `temperature`.
 * Phần khác nhau giữa các chế độ nằm ở các hệ số nhân SAU bước lấy căn.
 */
export function cardWeight(card: Card, ctx: CardWeightContext): number {
  const compatInfluence = ctx.settings.compatibilityInfluence / 50
  const weightInfluence = ctx.settings.cardWeightInfluence / 50
  const temperature = 0.5 + ctx.settings.variety / 50

  const normalised = clamp(ctx.pairScore, -20, 100)
  const scorePart = Math.max(normalised + 20, 1)
  let probability = scorePart ** compatInfluence * Math.max(card.weight, 0) ** weightInfluence
  probability = probability ** (1 / temperature)

  if (ctx.settings.avoidRecentCards && ctx.isRecent) probability *= 0.35

  if (ctx.settings.avoidSamePackClumping) {
    if (ctx.packCount >= 4) probability *= 0.25
    else if (ctx.packCount >= 2) probability *= 0.55
  }

  if (ctx.settings.samplingMode === 'chaos_roulette' && card.chaos >= 4) probability *= 1.5

  // Điểm khác biệt thật của "Wild but Valid": thưởng card mang tag CHƯA có trong scene.
  // Bản cũ để chế độ này là bí danh của Balanced Random.
  if (ctx.settings.samplingMode === 'wild_but_valid') {
    const novelty = card.tags.filter(tag => !ctx.sceneTags.has(tag)).length
    probability *= 1 + 0.3 * novelty
  }

  return probability
}

interface SlotFill {
  readonly cards: Partial<Record<CardType, Card>>
  readonly notes: string[]
}

function fillSlots(
  pool: readonly Card[],
  request: SceneRequest,
  settings: SceneSettings,
  rng: Rng,
): SlotFill {
  const notes: string[] = []
  const picks = request.picks ?? {}
  const info = MODE_INFO[request.mode]
  const pickedTypes = CARD_TYPES.filter(type => {
    const value = picks[type]
    return typeof value === 'string' && value !== ''
  })
  if (pickedTypes.length > info.maxManual) {
    throw new Error(`Mode "${info.label}" chỉ cho tự chọn ${info.maxManual} slot, nhưng nhận ${pickedTypes.length}.`)
  }

  const cards: Partial<Record<CardType, Card>> = {}

  // 1. Slot người chơi chỉ định trước.
  for (const type of pickedTypes) {
    const wanted = picks[type] as string
    const found = cardsOfType(pool, type).find(card => card.id === wanted)
    if (found === undefined) {
      notes.push(`Không thấy card "${wanted}" cho slot ${type}; đã rút ngẫu nhiên thay thế.`)
      continue
    }
    cards[type] = found
  }

  // 2. Các slot còn lại, thứ tự xáo theo seed.
  const missing = rng.shuffle(CARD_TYPES.filter(type => cards[type] === undefined))
  const recent = new Set(request.recentCardIds ?? [])

  for (const type of missing) {
    const candidates = cardsOfType(pool, type).filter(card => card.weight > 0)
    if (candidates.length === 0) {
      throw new Error(`Pool thiếu card loại "${type}" có weight > 0 — không lắp được scene.`)
    }
    const chosenSoFar = Object.values(cards).filter((card): card is Card => card !== undefined)
    const sceneTags = tagsOf(chosenSoFar)
    const packCounts = new Map<string, number>()
    for (const card of chosenSoFar) {
      const key = packIdOf(card)
      packCounts.set(key, (packCounts.get(key) ?? 0) + 1)
    }

    const viable: Card[] = []
    const weights: number[] = []
    for (const card of candidates) {
      const scored = scoreCandidate(card, chosenSoFar)
      // Loại cứng: không bao giờ ghép một cặp vi phạm, ở mọi strictness — strictness chỉ quyết định
      // mức khắt khe với CẢNH, không phải cho phép ghép cặp hỏng.
      if (scored.errors.length > 0) continue

      viable.push(card)
      weights.push(cardWeight(card, {
        pairScore: scored.score,
        settings,
        isRecent: recent.has(card.id),
        packCount: packCounts.get(packIdOf(card)) ?? 0,
        sceneTags,
      }))
    }

    // Không còn ứng viên nào ghép được: nới lỏng và ghi lại, thay vì để scene chết.
    let picked: Card | undefined
    if (viable.length > 0) {
      if (settings.samplingMode === 'high_compatibility') {
        const ranked = viable
          .map((card, index) => ({ card, weight: weights[index] ?? 0 }))
          .sort((a, b) => b.weight - a.weight)
        const keep = Math.max(3, Math.floor(ranked.length * 0.2))
        const shortlist = ranked.slice(0, keep)
        picked = pickWeighted(shortlist.map(entry => entry.card), shortlist.map(entry => entry.weight), rng)
      } else {
        picked = pickWeighted(viable, weights, rng)
      }
    } else {
      picked = candidates[Math.floor(rng.next() * candidates.length)]
      if (picked !== undefined) {
        notes.push(`Slot ${type}: mọi card đều xung đột với phần đã chọn, đã nới lỏng và nhận "${picked.title}".`)
      }
    }

    if (picked === undefined) throw new Error(`Không rút được card cho slot "${type}".`)
    cards[type] = picked
  }

  return { cards, notes }
}

function orderedCards(cards: Partial<Record<CardType, Card>>, type: CardType): Card {
  const card = cards[type]
  if (card === undefined) throw new Error(`Scene thiếu slot ${type}`)
  return card
}

// ── Vật chất hoá ───────────────────────────────────────────────────────────

const KAMI_STRICTNESS: Readonly<Record<Strictness, number>> = { strict: 5, soft: 3, chaotic: 2 }

function materialize(cards: Readonly<Record<CardType, Card>>, settings: SceneSettings): {
  sceneCore: SceneCore
  playerContract: PlayerContract
  kamiSama: KamiSama
  mechanics: SceneMechanics
  derived: string[]
} {
  const derived: string[] = []
  const f = (type: CardType): CardFragments => cards[type].fragments
  /** Lấy một mảnh; rỗng thì lui về `description` để cảnh không bao giờ có ô trống. */
  const text = (type: CardType, key: keyof CardFragments): string => {
    const value = f(type)[key]
    return value.trim() !== '' ? value : cards[type].description
  }

  const sceneCore: SceneCore = {
    worldSummary: text('world', 'prompt'),
    playerRole: text('player_role', 'prompt'),
    mainNpc: text('npc', 'prompt'),
    // Card opening của dữ liệu thật có khi chỉ đặt firstMessage mà để prompt rỗng — cảnh không được
    // phép có ô mở màn trống (demo trên pool thật đã bắt được đúng lỗi này).
    openingSituation: f('opening').prompt.trim() !== ''
      ? f('opening').prompt
      : f('opening').firstMessage.trim() !== ''
        ? f('opening').firstMessage
        : cards['opening'].description,
    pressure: text('pressure', 'prompt'),
    goal: text('goal', 'prompt'),
    hiddenTruth: f('hidden_truth').hiddenTruth.trim() !== ''
      ? f('hidden_truth').hiddenTruth
      : text('hidden_truth', 'prompt'),
    chaosTwist: text('chaos', 'prompt'),
  }

  // ── Player contract ──
  const roleMechanics = cards['player_role'].mechanics
  let forbiddenActions = [...(roleMechanics?.forbiddenActions ?? [])]
  if (forbiddenActions.length === 0) {
    const fromBoundary = splitSentences(f('player_role').contentBoundary)
    if (fromBoundary.length > 0) {
      forbiddenActions = fromBoundary
      derived.push('playerContract.forbiddenActions (suy từ contentBoundary của card player_role)')
    }
  }
  const playerContract: PlayerContract = {
    role: sceneCore.playerRole,
    allowedAbilities: [...(roleMechanics?.allowedAbilities ?? [])],
    allowedKnowledge: [...(roleMechanics?.allowedKnowledge ?? [])],
    allowedInventory: [...(roleMechanics?.allowedInventory ?? [])],
    forbiddenActions,
    outOfCharacterExamples: forbiddenActions.slice(0, 6).map(action => `Người chơi tự cho mình quyền: ${action}`),
  }
  if (
    playerContract.allowedAbilities.length === 0 &&
    playerContract.allowedKnowledge.length === 0 &&
    playerContract.allowedInventory.length === 0
  ) {
    derived.push('playerContract.allowed* (card không khai báo — sẽ in cảnh báo thay vì bịa năng lực)')
  }

  // ── Kami-sama ──
  const rules: string[] = [...BASE_KAMI_RULES]
  for (const type of CARD_TYPES) {
    const heaven = cards[type].fragments.heavenRule.trim()
    if (heaven !== '') rules.push(heaven)
  }
  // Đây là chỗ bản cũ để rơi mất: contentBoundary được lưu nhưng chưa bao giờ vào prompt.
  for (const type of CARD_TYPES) {
    const boundary = cards[type].fragments.contentBoundary.trim()
    if (boundary !== '') rules.push(`GIỚI HẠN (${type}): ${boundary}`)
  }
  const kamiSama: KamiSama = {
    enabled: true,
    strictness: KAMI_STRICTNESS[settings.strictness],
    policy: 'warn_then_terminate',
    warningStyle: 'đều đều, không cảm xúc',
    rules,
    warningLine: '【Thiên Đạo】Cảnh cáo. Ngươi phải chơi theo luật của thế giới này.',
    terminationLine: '【Thiên Đạo】Ngươi đã vượt giới hạn. Thế giới này không còn chỗ cho ngươi.',
  }

  // ── Mechanics ──
  const declaredMeters: MeterSpec[] = []
  for (const type of CARD_TYPES) {
    for (const meter of cards[type].mechanics?.meters ?? []) {
      declaredMeters.push({ ...meter, derived: false })
    }
  }
  let tensionMeters: MeterSpec[] = declaredMeters
  if (tensionMeters.length === 0) {
    tensionMeters = [
      {
        id: 'cang-thang',
        label: cards['pressure'].title,
        min: 0,
        max: 5,
        start: 1,
        failAt: 5,
        description: sceneCore.pressure,
        derived: true,
      },
    ]
    derived.push('mechanics.tensionMeters (card pressure không khai báo meter có cấu trúc)')
  }

  const goalMechanics = cards['goal'].mechanics
  const declaredSteps = goalMechanics?.winSteps ?? []
  const winSteps: SceneWinStep[] = declaredSteps.length > 0
    ? declaredSteps.map((description, index) => ({ id: `buoc-${index + 1}`, description }))
    : [{ id: 'buoc-1', description: sceneCore.goal }]

  let winCondition = ''
  if (declaredSteps.length > 0) {
    winCondition = `Hoàn thành: ${declaredSteps.join(' → ')}`
  } else {
    winCondition = sceneCore.goal
    derived.push('mechanics.winCondition (suy từ prompt của card goal)')
    derived.push('mechanics.winSteps (card goal không khai báo bước — chỉ có một bước là chính mục tiêu)')
  }

  let loseCondition = ''
  let loseConditions: string[] = []
  if ((goalMechanics?.loseConditions?.length ?? 0) > 0) {
    loseConditions = [...(goalMechanics?.loseConditions ?? [])]
    loseCondition = loseConditions.join(' | ')
  } else {
    loseConditions = tensionMeters.map(meter => `Khi ${meter.label} chạm ${meter.failAt}`)
    loseCondition = loseConditions.join(' | ')
    derived.push('mechanics.loseCondition (suy từ failAt của các thanh căng thẳng)')
  }

  const mechanics: SceneMechanics = {
    tensionMeters,
    winCondition,
    loseCondition,
    winSteps,
    loseConditions,
    softFailOptions: [],
  }

  return { sceneCore, playerContract, kamiSama, mechanics, derived }
}

// ── API chính ──────────────────────────────────────────────────────────────

/**
 * Sinh một scene tất định từ pool. Cùng `seed` + cùng pool ⇒ cùng scene, bất kể thứ tự file trên
 * đĩa (pool được sắp theo id trước khi sinh).
 */
export function generateScene(pool: readonly Card[], request: SceneRequest): GenerationOutcome {
  if (pool.length === 0) throw new Error('Pool rỗng — không sinh được scene.')
  const settings: SceneSettings = { ...DEFAULT_SETTINGS, ...request.settings }
  const byId = (a: Card, b: Card): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const sortedPool = [...pool].sort(byId)
  const rng = createRng(`${request.seed}:${request.mode}`)
  const notes: string[] = []

  // ── Chọn bộ nguồn ──
  // Đây là chỗ sửa lỗi nghiêm trọng nhất tìm thấy khi chạy demo trên pool thật: rút từng slot từ
  // toàn pool sinh ra cảnh trộn ba pack khác nhau (rừng rậm + ma cà rồng + vũ hội của một thế lực
  // khác), vì đồ thị tương thích của dữ liệu thật không đủ dày để chặn. Pack vốn ĐÃ là một thế giới
  // hoàn chỉnh, nên đơn vị mạch lạc đúng là pack.
  let activePool = sortedPool
  let source: { id: string; title: string } | null = null
  if (settings.coherence === 'single_source' && (request.sources?.length ?? 0) > 0) {
    const complete = (request.sources ?? []).filter(candidate =>
      CARD_TYPES.every(type => candidate.cards.some(card => card.type === type)),
    )
    const pickedIds = Object.values(request.picks ?? {}).filter(
      (value): value is string => typeof value === 'string' && value !== '',
    )
    const eligible = complete.filter(candidate =>
      pickedIds.every(id => candidate.cards.some(card => card.id === id)),
    )
    const chosen = pickWeighted(eligible, eligible.map(() => 1), rng)
    if (chosen !== undefined) {
      activePool = [...chosen.cards].sort(byId)
      source = { id: chosen.id, title: chosen.title }
    } else if (complete.length === 0) {
      notes.push(`Không có bộ nguồn nào đủ ${CARD_TYPES.length} loại; đã trộn từ toàn pool.`)
    } else if (pickedIds.length > 0) {
      notes.push('Lựa chọn của bạn không nằm trong bộ nguồn hoàn chỉnh nào; đã trộn từ toàn pool để tôn trọng lựa chọn.')
    }
  }

  const attempts = CANDIDATE_COUNT[settings.samplingMode]
  const candidates: { cards: Record<CardType, Card>; report: ReturnType<typeof checkScene> }[] = []

  for (let attempt = 0; attempt < attempts; attempt++) {
    const fill = fillSlots(activePool, request, settings, rng)
    notes.push(...fill.notes)
    const complete = {} as Record<CardType, Card>
    for (const type of CARD_TYPES) complete[type] = orderedCards(fill.cards, type)
    const ordered = CARD_TYPES.map(type => complete[type])
    candidates.push({ cards: complete, report: checkScene(ordered) })
  }

  const passes = (report: ReturnType<typeof checkScene>): boolean => {
    if (settings.strictness === 'strict') return report.errors.length === 0 && report.warnings.length === 0
    if (settings.strictness === 'soft') return report.errors.length === 0
    return true
  }

  let pool_ = candidates.filter(candidate => passes(candidate.report))
  if (pool_.length === 0) {
    pool_ = candidates
    notes.push(
      `Không cảnh nào đạt mức "${settings.strictness}" trong ${attempts} lần dựng; đã hạ xuống cảnh tốt nhất.`,
    )
  }

  let finalists = pool_
  if (settings.samplingMode === 'high_compatibility') {
    const sorted = [...finalists].sort((a, b) => b.report.score - a.report.score)
    finalists = sorted.slice(0, Math.max(3, Math.floor(sorted.length * 0.3)))
  }

  const finalWeights = finalists.map(candidate => {
    const totalChaos = CARD_TYPES.reduce((sum, type) => sum + candidate.cards[type].chaos, 0)
    let weight = Math.max(candidate.report.score + 50, 1)
    if (settings.samplingMode === 'chaos_roulette') weight *= 1 + totalChaos / 20
    // Ở mức chaotic, cảnh có vi phạm cứng vẫn được nhận nhưng bị đẩy xuống.
    if (candidate.report.errors.length > 0) weight *= 0.25
    return weight
  })

  const winner = pickWeighted(finalists, finalWeights, rng) ?? finalists[0]!
  if (winner.report.errors.length > 0) {
    notes.push(`Cảnh được chọn có ${winner.report.errors.length} vi phạm cứng (mức strictness "${settings.strictness}").`)
  }

  const materialised = materialize(winner.cards, settings)
  const orderedCardsList = CARD_TYPES.map(type => winner.cards[type])
  const chaos = chaosOf(orderedCardsList)

  const selectedSlots = CARD_TYPES.filter(type => {
    const value = request.picks?.[type]
    return typeof value === 'string' && value !== '' && winner.cards[type].id === value
  })
  const randomSlots = CARD_TYPES.filter(type => !selectedSlots.includes(type))

  const stamp = request.now ?? new Date().toISOString()
  const cardFragments = {} as Record<CardType, CardFragments>
  for (const type of CARD_TYPES) cardFragments[type] = winner.cards[type].fragments

  const scene: GeneratedScene = {
    schemaVersion: 'rp-scene-v1',
    id: `scene-${request.mode}-${slug(request.seed)}`,
    seed: request.seed,
    createdAt: stamp,
    mode: {
      id: request.mode,
      label: MODE_INFO[request.mode].label,
      selectedSlots,
      randomSlots,
      hiddenSlots: HIDDEN_SLOTS,
    },
    settings,
    chaos,
    source,
    cards: winner.cards,
    cardFragments,
    sceneCore: materialised.sceneCore,
    playerContract: materialised.playerContract,
    kamiSama: materialised.kamiSama,
    mechanics: materialised.mechanics,
    compatibilityReport: {
      isCompatible: winner.report.compatible,
      score: winner.report.score,
      errors: winner.report.errors,
      warnings: winner.report.warnings,
    },
    derivation: { derived: [...new Set(materialised.derived)].sort() },
  }

  return { scene, notes: [...new Set(notes)].sort(), considered: attempts }
}

// ── Render ─────────────────────────────────────────────────────────────────

function meterLine(meter: MeterSpec): string {
  return `${meter.label} (${meter.min}–${meter.max}, bắt đầu ${meter.start}, thua ở ${meter.failAt})${meter.derived ? ' [suy ra]' : ''}`
}

/** Kênh CÔNG KHAI: người chơi đọc được. Không chứa hidden_truth. */
export function renderPlayerBriefing(scene: GeneratedScene): string {
  const lines: string[] = []
  lines.push(`【Ván】${scene.id} · mode ${scene.mode.label} · chaos ${scene.chaos.total} (${scene.chaos.level})`)
  lines.push(`【Thế giới】${scene.sceneCore.worldSummary}`)
  lines.push(`【Vai của bạn】${scene.playerContract.role}`)
  lines.push(`【Nhân vật trung tâm】${scene.sceneCore.mainNpc}`)
  lines.push(`【Mở màn】${scene.sceneCore.openingSituation}`)
  lines.push(`【Áp lực】${scene.sceneCore.pressure}`)
  lines.push(`【Mục tiêu】${scene.mechanics.winCondition}`)
  if (scene.mechanics.tensionMeters.length > 0) {
    lines.push(`【Thanh căng thẳng】${scene.mechanics.tensionMeters.map(meterLine).join(' · ')}`)
  }
  lines.push(`【Thua khi】${scene.mechanics.loseCondition}`)
  if (scene.playerContract.forbiddenActions.length > 0) {
    lines.push('【Bạn KHÔNG được tự cho mình】')
    for (const action of scene.playerContract.forbiddenActions) lines.push(`  - ${action}`)
  }
  if (scene.playerContract.allowedAbilities.length === 0 && scene.playerContract.allowedKnowledge.length === 0) {
    lines.push('【Năng lực được khai báo】Không có khai báo riêng — chỉ dùng thứ hợp lý với vai trên.')
  }
  return lines.join('\n')
}

/** Kênh GM: chứa bí mật + toàn bộ luật Thiên Đạo. Không được đưa vào output của tool. */
export function renderGmContext(scene: GeneratedScene): string {
  const lines: string[] = []
  lines.push(`【Scene】${scene.id} · seed ${scene.seed} · mode ${scene.mode.label}`)
  lines.push(`【Chaos】${scene.chaos.total}/40 (${scene.chaos.level}) — ${scene.chaos.description}`)
  lines.push(`Biến cố cưỡng bức mỗi ${scene.chaos.eventEvery} lượt${scene.chaos.mayBendRules ? '; được bẻ cong luật thế giới nhưng phải báo trước bằng dấu hiệu giác quan' : ''}${scene.chaos.npcMayLie ? '; NPC được nói dối về chính luật thế giới' : ''}.`)
  lines.push('')
  lines.push(`【SỰ THẬT BỊ NIÊM PHONG — không bao giờ nói thẳng】${scene.sceneCore.hiddenTruth}`)
  lines.push('')
  lines.push(`【Mục tiêu thật】${scene.mechanics.winCondition}`)
  lines.push(`【Thua khi】${scene.mechanics.loseCondition}`)
  lines.push(`【Chaos twist】${scene.sceneCore.chaosTwist}`)
  lines.push('')
  lines.push(`【Thiên Đạo — strictness ${scene.kamiSama.strictness}/5, policy ${scene.kamiSama.policy}】`)
  for (const rule of scene.kamiSama.rules) lines.push(`  - ${rule}`)
  lines.push(`  Cảnh cáo: ${scene.kamiSama.warningLine}`)
  lines.push(`  Trục xuất: ${scene.kamiSama.terminationLine}`)
  if (scene.derivation.derived.length > 0) {
    lines.push('')
    lines.push(`【Trường do máy suy ra, không phải card khai báo】${scene.derivation.derived.join(' · ')}`)
  }
  return lines.join('\n')
}

// ── Lưu / đọc ──────────────────────────────────────────────────────────────

export function sceneDirOf(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'roleplay-machine', 'scenes')
}

export function saveScene(workspaceRoot: string, scene: GeneratedScene): string {
  const dir = sceneDirOf(workspaceRoot)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${scene.id}.json`)
  fs.writeFileSync(file, `${JSON.stringify(scene, null, 2)}\n`, 'utf8')
  return file
}

export function loadScene(workspaceRoot: string, id: string): GeneratedScene | undefined {
  const file = path.join(sceneDirOf(workspaceRoot), `${id}.json`)
  if (!fs.existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as GeneratedScene
    return parsed?.schemaVersion === 'rp-scene-v1' ? parsed : undefined
  } catch {
    return undefined
  }
}

export function listScenes(workspaceRoot: string): { id: string; mode: PlayMode; createdAt: string; chaosTotal: number }[] {
  const dir = sceneDirOf(workspaceRoot)
  if (!fs.existsSync(dir)) return []
  const out: { id: string; mode: PlayMode; createdAt: string; chaosTotal: number }[] = []
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    const scene = loadScene(workspaceRoot, entry.replace(/\.json$/, ''))
    if (scene === undefined) continue
    out.push({ id: scene.id, mode: scene.mode.id, createdAt: scene.createdAt, chaosTotal: scene.chaos.total })
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// ── Lịch sử card đã dùng gần đây ───────────────────────────────────────────

const RECENT_FILE = 'recent.json'
const MAX_RECENT_CARDS = 80

export function recentPathOf(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'roleplay-machine', RECENT_FILE)
}

/** Card đã xuất hiện trong các scene gần đây — nguồn cho `avoidRecentCards`. */
export function loadRecentCards(workspaceRoot: string): string[] {
  const file = recentPathOf(workspaceRoot)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { recentCardIds?: unknown }
    return Array.isArray(parsed.recentCardIds) ? parsed.recentCardIds.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Ghi thêm card vừa dùng, giữ trần FIFO. Trả về danh sách sau khi cập nhật. */
export function recordRecentCards(workspaceRoot: string, ids: readonly string[]): string[] {
  const existing = loadRecentCards(workspaceRoot)
  const merged = [...new Set([...ids, ...existing])].slice(0, MAX_RECENT_CARDS)
  const file = recentPathOf(workspaceRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 'rp-recent-v1', recentCardIds: merged, maxRecentCards: MAX_RECENT_CARDS }, null, 2)}\n`, 'utf8')
  return merged
}
