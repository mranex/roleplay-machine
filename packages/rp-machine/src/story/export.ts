/**
 * Story export — bản lưu trữ của một ván, và nguyên liệu của writer.
 *
 * Nguyên tắc trung tâm: **POV không phải một giọng văn, nó là một tập dữ liệu.** Ba góc nhìn trong file
 * này không khác nhau ở lời dặn gửi cho model, mà ở chỗ mục nào của bản export được **nhét vào** prompt.
 * Đoạn chứa `hiddenTruth` không được lọc ra bằng câu "đừng tiết lộ" — nó đơn giản là không có mặt.
 *
 * Vì vậy mọi mục đều mang nhãn phân loại:
 *
 *   public     người chơi đã biết (vai, mục tiêu, áp lực, mở màn)
 *   canon      sự thật đã commit trong simulation
 *   private    ý định/niềm tin riêng của actor, chưa từng tới tay người chơi
 *   sealed     sự thật bị niêm phong và các con số của Thiên Đạo
 *   rendering  lời kể do Thiên Đạo viết — CÓ THỂ chứa chi tiết nó tự thêm, không phải canon
 *
 * Toàn bộ file này là hàm thuần: kiểm được không cần model.
 */

import type { CardFragments, CardType } from '../card-schema'
import type { ActorDefinition, WorldState } from '../actor/model'
import type { GeneratedScene } from '../scene'
import type { RunState } from '../runtime'
import type { StoryTurn } from './transcript'
import { transcriptSummary } from './transcript'

export const POVS = ['player', 'npc', 'kami', 'omniscient'] as const
export type Pov = (typeof POVS)[number]

export const CLASSIFICATIONS = ['public', 'canon', 'private', 'sealed', 'rendering'] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export interface ExportSection {
  readonly id: string
  readonly label: string
  readonly classification: Classification
  readonly body: string
}

export interface StoryExport {
  readonly sceneId: string
  readonly generatedAt: string
  readonly summary: ReturnType<typeof transcriptSummary>
  readonly sections: readonly ExportSection[]
  readonly markdown: string
  readonly json: unknown
}

const FRAGMENT_ORDER: readonly CardType[] = ['world', 'npc', 'opening', 'pressure', 'goal', 'player_role']

function bullet(text: string): string {
  return `- ${text}`
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').slice(0, 200)
}

function heading(depth: number, text: string): string {
  return `${'#'.repeat(depth)} ${text}`
}

// ── Dựng bản export ───────────────────────────────────────────────────────

export interface StoryExportInput {
  readonly sceneId: string
  readonly generatedAt: string
  readonly turns: readonly StoryTurn[]
  readonly scene?: GeneratedScene
  readonly state?: RunState
  readonly definitions?: readonly ActorDefinition[]
  readonly world?: WorldState
}

export function buildStoryExport(input: StoryExportInput): StoryExport {
  const summary = transcriptSummary(input.turns)
  const sections: ExportSection[] = []

  sections.push({ id: 'header', label: 'Ván', classification: 'public', body: headerBody(input, summary) })
  if (input.scene !== undefined) {
    sections.push({ id: 'context', label: 'Bối cảnh người chơi đã biết', classification: 'public', body: contextBody(input.scene) })
    sections.push({ id: 'texture', label: 'Bảng màu (mảnh card có tác giả)', classification: 'public', body: textureBody(input.scene) })
    sections.push({ id: 'sealed', label: 'THIÊN ĐẠO NẮM — không được lộ cho người chơi', classification: 'sealed', body: sealedBody(input.scene) })
  }
  sections.push({ id: 'timeline', label: 'Dòng thời gian sự thật', classification: 'canon', body: timelineBody(input.turns) })
  sections.push({ id: 'irony', label: 'Ai biết gì (bản đồ dramatic irony)', classification: 'canon', body: ironyTable(input.turns) })
  sections.push({ id: 'inner', label: 'Nội tâm actor (niềm tin CÓ THỂ SAI)', classification: 'private', body: innerBody(input.turns, input.definitions) })
  sections.push({ id: 'rendering', label: 'Lời kể của Thiên Đạo (rendering, KHÔNG phải canon)', classification: 'rendering', body: renderingBody(input.turns) })
  if (input.state !== undefined) {
    sections.push({ id: 'ending', label: 'Kết ván', classification: 'canon', body: endingBody(input.state, input.turns) })
  }

  const markdown = renderMarkdown(input, sections)
  return {
    sceneId: input.sceneId,
    generatedAt: input.generatedAt,
    summary,
    sections,
    markdown,
    json: exportJson(input, summary),
  }
}

function headerBody(input: StoryExportInput, summary: ReturnType<typeof transcriptSummary>): string {
  const lines = [
    bullet(`Scene: ${input.sceneId}`),
    bullet(`Sinh lúc: ${input.generatedAt}`),
    bullet(`Chế độ chơi: ${summary.modes.join(', ') || '(chưa có lượt)'}`),
    bullet(`Số lượt: ${summary.turns} — trong đó ${summary.narrated} lượt có lời kể`),
    bullet(`Sự thật đã commit: ${summary.events} (riêng tư: ${summary.privateEvents}, ngoài tầm người chơi: ${summary.withheld})`),
  ]
  if (input.scene !== undefined) {
    lines.push(bullet(`Nguồn: ${input.scene.source?.title ?? '(trộn từ toàn pool)'}`))
    lines.push(bullet(`Chaos: ${input.scene.chaos.total}/40 (${input.scene.chaos.level})`))
    lines.push(bullet(`Mode: ${input.scene.mode.label}`))
  }
  if (input.state !== undefined) {
    lines.push(bullet(`Trạng thái: ${input.state.status}${input.state.ending === undefined ? '' : ` — ${input.state.ending}`}`))
  }
  return lines.join('\n')
}

function contextBody(scene: GeneratedScene): string {
  const core = scene.sceneCore
  return [
    bullet(`Vai của người chơi: ${core.playerRole}`),
    bullet(`Mục tiêu: ${core.goal}`),
    bullet(`Thế giới: ${core.worldSummary}`),
    bullet(`Nhân vật chính: ${core.mainNpc}`),
    bullet(`Mở màn: ${core.openingSituation}`),
    bullet(`Áp lực: ${core.pressure}`),
    '',
    'Ranh giới nhân vật chính (điều họ có thể và không thể làm):',
    ...scene.playerContract.forbiddenActions.map(action => bullet(`KHÔNG: ${action}`)),
    ...scene.playerContract.allowedAbilities.map(ability => bullet(`CÓ: ${ability}`)),
  ].join('\n')
}

/**
 * Bảng màu: mảnh `prompt`/`firstMessage` của card là văn CÓ TÁC GIẢ, dùng để writer tô chi tiết giác quan
 * thay vì tự bịa ra thế giới mới. `hiddenTruth` không nằm ở đây — nó thuộc mục sealed.
 */
function textureBody(scene: GeneratedScene): string {
  const parts: string[] = []
  for (const type of FRAGMENT_ORDER) {
    const fragments: CardFragments | undefined = scene.cardFragments[type]
    if (fragments === undefined) continue
    const card = scene.cards[type]
    const lines = [
      fragments.prompt.trim() === '' ? '' : `Chỉ thị nhập vai: ${fragments.prompt.trim()}`,
      fragments.firstMessage.trim() === '' ? '' : `Câu mở đầu có sẵn: ${fragments.firstMessage.trim()}`,
    ].filter(line => line !== '')
    if (lines.length === 0) continue
    parts.push(`**${type}** — ${card?.title ?? '(không rõ)'}`, ...lines.map(line => bullet(line)))
  }
  return parts.length === 0 ? '(không có mảnh card nào)' : parts.join('\n')
}

function sealedBody(scene: GeneratedScene): string {
  const core = scene.sceneCore
  return [
    bullet(`SỰ THẬT BỊ NIÊM PHONG: ${core.hiddenTruth}`),
    bullet(`Twist hỗn loạn: ${core.chaosTwist}`),
    bullet(`Chaos: ${scene.chaos.total}/40 — tầng ${scene.chaos.level}`),
    '',
    'Luật Thiên Đạo:',
    ...scene.kamiSama.rules.map(rule => bullet(rule)),
    '',
    'Bước thắng (máy trạng thái đếm):',
    ...scene.mechanics.winSteps.map((step, index) => bullet(`${index + 1}. ${step.description}`)),
    '',
    'Thanh căng thẳng (chạm failAt là thua):',
    ...scene.mechanics.tensionMeters.map(meter => bullet(`${meter.label}: bắt đầu ${meter.start}, thua ở ${meter.failAt}/${meter.max}`)),
  ].join('\n')
}

function timelineBody(turns: readonly StoryTurn[]): string {
  if (turns.length === 0) return '(chưa có lượt nào)'
  return turns.map(turn => {
    const lines = [heading(3, `Lượt ${turn.turn}`), bullet(`Người chơi (${turn.playerActionType}): ${turn.playerAction}`), bullet(`Ở: ${turn.playerLocation}`)]
    if (turn.events.length === 0) lines.push(bullet('(không có sự thật nào được commit)'))
    for (const event of turn.events) {
      const tag = event.visibility === 'private' ? ' [RIÊNG TƯ]' : ''
      lines.push(bullet(`${event.id} · ${event.type} · ${event.sourceName} @ ${event.location}${tag}: ${event.text}`))
    }
    if (turn.privateEvents.length > 0) lines.push(bullet(`Ý định chưa thành sự thật: ${turn.privateEvents.join(' / ')}`))
    if (turn.withheld.length > 0) lines.push(bullet(`Ngoài tầm tri giác người chơi: ${turn.withheld.join(' / ')}`))
    if (turn.outcome !== undefined && turn.outcome !== '') lines.push(bullet(`Hệ quả (Thiên Đạo khai): ${turn.outcome}`))
    return lines.join('\n')
  }).join('\n\n')
}

/**
 * Bản đồ dramatic irony: mỗi sự kiện, ai nhận được nó ở mức nào.
 *
 * Đây là thứ không app roleplay qua turn chat nào có, và nó gần như miễn phí — `BroadcastResult` đã tính
 * sẵn mỗi lượt, trước đây chỉ bị vứt đi.
 */
export function ironyTable(turns: readonly StoryTurn[]): string {
  const rows: string[] = []
  for (const turn of turns) {
    for (const event of turn.events) {
      if (event.visibility === 'private') continue
      const known = event.perceivedBy.map(entry => `${entry.name}:${entry.fidelity}`).join(', ')
      rows.push(`| ${turn.turn} | ${cell(event.text)} | ${event.playerFidelity} | ${cell(known === '' ? '(không ai)' : known)} |`)
    }
  }
  if (rows.length === 0) return '(chưa có sự kiện công khai nào)'
  return [
    '| Lượt | Sự kiện | Người chơi | Actor |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function innerBody(turns: readonly StoryTurn[], definitions: readonly ActorDefinition[] | undefined): string {
  const byActor = new Map<string, { name: string; lines: string[] }>()
  for (const definition of definitions ?? []) {
    byActor.set(definition.id, {
      name: definition.name,
      lines: [`Điều nó ĐƯỢC BIẾT ngay từ đầu (ranh giới cô lập):`, ...definition.allowedKnowledge.map(knowledge => bullet(`  ${knowledge}`))],
    })
  }

  for (const turn of turns) {
    for (const actor of turn.actors) {
      const entry = byActor.get(actor.id) ?? { name: actor.name, lines: [] }
      byActor.set(actor.id, entry)
      entry.lines.push(
        `${heading(4, `Lượt ${turn.turn} — ${actor.name}`)}`,
        bullet(`Nhận được: ${actor.perceived === '' ? '(không gì)' : actor.perceived}`),
        bullet(`Hiểu là: ${actor.interpretation}`),
        bullet(`Cảm xúc: ${actor.emotion}`),
        bullet(`Muốn: ${actor.intent}${actor.target === undefined ? '' : ` → ${actor.target}`}${actor.intentContent === '' ? '' : ` — "${actor.intentContent}"`}`),
        ...(actor.plan === undefined ? [] : [bullet(`Kế hoạch riêng: ${actor.plan}`)]),
        ...(actor.beliefs.length === 0 ? [] : [bullet(`Tin: ${actor.beliefs.join(' | ')}`)]),
      )
    }
  }

  if (byActor.size === 0) return '(ván này không có actor)'
  const parts: string[] = [
    'Niềm tin dưới đây là niềm tin CỦA NHÂN VẬT, không phải sự thật. Nhân vật được phép sai, và cái sai đó',
    'là chất liệu, không phải lỗi cần sửa.',
  ]
  for (const [id, entry] of [...byActor.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    parts.push(heading(3, `${entry.name} (${id})`), entry.lines.join('\n'))
  }
  return parts.join('\n')
}

function renderingBody(turns: readonly StoryTurn[]): string {
  const narrated = turns.filter(turn => turn.narration !== undefined && turn.narration !== '')
  if (narrated.length === 0) return '(Thiên Đạo chưa nộp lời kể nào cho ván này.)'
  return [
    'Đây là bản kể của Thiên Đạo, KHÔNG phải canon: nó có thể chứa chi tiết giác quan do Thiên Đạo thêm.',
    '',
    ...narrated.map(turn => [heading(3, `Lượt ${turn.turn}`), turn.narration ?? ''].join('\n')),
  ].join('\n')
}

function endingBody(state: RunState, turns: readonly StoryTurn[]): string {
  const last = turns[turns.length - 1]
  return [
    bullet(`Trạng thái: ${state.status}`),
    bullet(`Lý do: ${state.ending ?? '(chưa chốt)'}`),
    bullet(`Số lượt: ${state.turn}`),
    bullet(`Bước thắng: ${state.winSteps.filter(step => step.done).length}/${state.winSteps.length}`),
    bullet(`Cảnh cáo OOC: ${state.oocStrikes}/${state.maxOocStrikes}`),
    ...state.meters.map(meter => bullet(`${meter.label}: ${meter.value}/${meter.max} (thua ở ${meter.failAt})`)),
    ...(last?.ending === undefined ? [] : [bullet(`Ghi chú cuối: ${last.ending}`)]),
  ].join('\n')
}

function renderMarkdown(input: StoryExportInput, sections: readonly ExportSection[]): string {
  const lines: string[] = [heading(1, `Ván ${input.sceneId}`), '']
  for (const section of sections) {
    lines.push(`${heading(2, section.label)}  <!-- ${section.classification} -->`, '', section.body, '')
  }
  return lines.join('\n')
}

function exportJson(input: StoryExportInput, summary: ReturnType<typeof transcriptSummary>): unknown {
  return {
    schemaVersion: 'rp-story-export-v1',
    sceneId: input.sceneId,
    generatedAt: input.generatedAt,
    summary,
    scene: input.scene === undefined ? null : {
      id: input.scene.id,
      seed: input.scene.seed,
      mode: input.scene.mode.id,
      chaos: input.scene.chaos,
      source: input.scene.source,
      sceneCore: input.scene.sceneCore,
      playerContract: input.scene.playerContract,
      kamiSama: input.scene.kamiSama,
      mechanics: input.scene.mechanics,
    },
    state: input.state ?? null,
    cast: input.definitions ?? [],
    world: input.world ?? null,
    turns: input.turns,
  }
}

// ── Cắt theo POV ──────────────────────────────────────────────────────────

/**
 * Mục nào được vào prompt của POV nào.
 *
 * Cột `timeline` bị lọc theo từng sự kiện nữa, không chỉ theo mục — xem `povSections`.
 *
 * | POV | context | texture | sealed | timeline | irony | inner | rendering |
 * |---|---|---|---|---|---|---|---|
 * | player | có | có | KHÔNG | chỉ thứ họ tri giác | KHÔNG | KHÔNG | có |
 * | npc:<id> | KHÔNG | có | KHÔNG | chỉ thứ nó tri giác | KHÔNG | chỉ chính nó | KHÔNG |
 * | kami | có | có | có | tất cả | có | có | có |
 * | omniscient | có | có | có | tất cả | có | có | có |
 */
export function povSectionIds(pov: Pov): readonly string[] {
  switch (pov) {
    case 'player':
      return ['header', 'context', 'texture', 'timeline', 'rendering', 'ending']
    case 'npc':
      return ['header', 'texture', 'timeline', 'inner', 'ending']
    case 'kami':
    case 'omniscient':
      return ['header', 'context', 'texture', 'sealed', 'timeline', 'irony', 'inner', 'rendering', 'ending']
  }
}

function timelineForPov(turns: readonly StoryTurn[], pov: Pov, actorId: string | undefined): string {
  if (pov === 'kami' || pov === 'omniscient') return timelineBody(turns)

  const visible = turns.map(turn => {
    const events = pov === 'player'
      // Người chơi biết sự thật nào nó tri giác được, và không bao giờ thấy event riêng tư.
      ? turn.events.filter(event => event.visibility === 'public' && event.playerFidelity !== 'none')
      : turn.events.filter(event => event.visibility !== 'private' && event.perceivedBy.some(entry => entry.actorId === actorId))
    return { ...turn, events, privateEvents: [], withheld: [] as string[] }
  })
  return timelineBody(visible)
}

function innerForPov(turns: readonly StoryTurn[], actorId: string | undefined, definitions: readonly ActorDefinition[] | undefined): string {
  const only = (definitions ?? []).filter(definition => definition.id === actorId)
  return innerBody(turns.map(turn => ({ ...turn, actors: turn.actors.filter(actor => actor.id === actorId) })), only)
}

/** Các mục của bản export, đã cắt theo POV. */
export function povSections(exp: StoryExport, pov: Pov, actorId?: string): ExportSection[] {
  const allowed = new Set(povSectionIds(pov))
  return exp.sections
    .filter(section => allowed.has(section.id))
    .map(section => {
      if (section.id === 'timeline') return { ...section, body: timelineForPov(exp.json === undefined ? [] : turnsOf(exp), pov, actorId) }
      if (section.id === 'inner' && pov === 'npc') return { ...section, body: innerForPov(turnsOf(exp), actorId, definitionsOf(exp)) }
      return section
    })
}

/**
 * Truy vết ngược từ `StoryExport` về dữ liệu có cấu trúc.
 *
 * `povSections` cần lượt và định nghĩa actor; nhét chúng vào `json` là để bản export tự đủ, không phải
 * giữ thêm một bản sao ngoài hàm. Đây là chỗ duy nhất đọc lại, và nó không chứa logic.
 */
function turnsOf(exp: StoryExport): StoryTurn[] {
  const json = exp.json as { turns?: StoryTurn[] }
  return json.turns ?? []
}

function definitionsOf(exp: StoryExport): ActorDefinition[] {
  const json = exp.json as { cast?: ActorDefinition[] }
  return json.cast ?? []
}

/** Nhãn POV cho tên tệp và cho writer. */
export function povLabel(pov: Pov, actorId: string | undefined, definitions: readonly ActorDefinition[] | undefined): string {
  if (pov === 'player') return 'POV1 — người chơi'
  if (pov === 'npc') {
    const name = (definitions ?? []).find(definition => definition.id === actorId)?.name ?? actorId ?? '(không rõ)'
    return `POV3 — ${name}`
  }
  if (pov === 'kami') return 'POV2 — Thiên Đạo'
  return 'Toàn tri (canon + riêng tư, độc giả biết thứ người chơi không biết)'
}

/** Nguyên liệu gửi cho writer: chỉ những mục POV này được phép thấy. */
export function renderMaterial(exp: StoryExport, pov: Pov, actorId?: string): string {
  const sections = povSections(exp, pov, actorId)
  const lines = [
    heading(1, `Nguyên liệu — ${povLabel(pov, actorId, definitionsOf(exp))}`),
    '',
    'Mọi mục dưới đây được cắt theo góc nhìn này. Không có mục nào khác tồn tại trong hồ sơ của bạn.',
    '',
  ]
  for (const section of sections) {
    lines.push(`${heading(2, section.label)}  <!-- ${section.classification} -->`, '', section.body, '')
  }
  return lines.join('\n')
}
