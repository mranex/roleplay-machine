/**
 * Hạt nhân cô lập thông tin.
 *
 * Đây là file quan trọng nhất của Multi-Actor-Agent Mode. Spec §16 nói thẳng: cách làm SAI là
 *
 *     call_agent(world_lore + "hãy giả vờ mày chỉ biết những thứ này")
 *
 * và cách làm ĐÚNG là
 *
 *     call_agent(identity + allowed_knowledge + private_memory + current_perception)
 *
 * Nên ở đây chỉ có MỘT hàm dựng input cho actor, và nó không có tham số nào để nhét thêm thế giới vào.
 * Kèm theo là `assertIsolated()` — chốt chặn kiến trúc: nếu chuỗi cấm nào lọt vào prompt thì ném lỗi
 * ngay, chứ không tin vào lời dặn.
 */

import type { ActorDefinition, ActorState, WorldState } from './model'
import type { Perception } from './perception'

export interface ActorPayload {
  readonly actorId: string
  readonly name: string
  readonly role: string
  readonly personality: readonly string[]
  readonly goals: readonly string[]
  /** Những gì actor này được biết. Không có gì khác. */
  readonly knowledge: readonly string[]
  readonly memory: readonly string[]
  readonly beliefs: readonly string[]
  readonly plans: readonly string[]
  readonly selfTraits: readonly string[]
  /** Điều nó vừa quan sát được ở lượt này, đã qua perception router. */
  readonly perception: string
  readonly instruction: string
}

/** Nhãn trung tính cho giá trị 0..5 để model không phải đoán thang số. */
function traitWords(traits: Readonly<Record<string, number>>): string[] {
  const label = (value: number): string => (value >= 4 ? 'rất cao' : value >= 3 ? 'cao' : value >= 2 ? 'vừa' : 'thấp')
  return Object.entries(traits)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}: ${label(value)} (${value}/5)`)
}

export const ACTOR_INSTRUCTION = [
  'Bạn là một actor trong một ván roleplay. Bạn KHÔNG viết lời kể cho người chơi.',
  'Bạn chỉ trả về JSON theo schema đã cho, gồm:',
  '- actor_id: id của bạn, chép ĐÚNG chuỗi ở mục "Mã định danh" bên dưới.',
  '- interpretation: bạn hiểu chuyện vừa xảy ra là gì.',
  '- emotion: cảm xúc hiện tại của bạn.',
  '- intent_type, intent_target, intent_content: điều bạn MUỐN làm tiếp theo.',
  '- followup_content (tuỳ chọn): điều bạn muốn làm ngay sau đó.',
  '- belief_claims (tuỳ chọn): điều bạn bắt đầu tin sau lượt này, kèm confidence 0..1.',
  '- plan_goal, plan_trigger (tuỳ chọn): một kế hoạch riêng bạn giữ lại, và điều kiện để nó kích hoạt.',
  '',
  'Luật bất biến:',
  '1. Ý định của bạn KHÔNG phải sự thật. Người kể chuyện sẽ quyết cái gì thực sự xảy ra.',
  '2. Bạn chỉ biết những gì có trong hồ sơ này. Không suy ra, không nhớ hộ người khác.',
  '3. Bạn được phép sai. Bạn được phép nói dối: điều bạn nói và điều bạn tin là hai chuyện khác nhau.',
  '4. Không bao giờ nhắc tới luật chơi, tới "schema", tới việc bạn là AI.',
  '5. `intent_content` là việc bạn làm, không phải lời kể: với `dialogue` chỉ ghi LỜI NÓI, còn hành động và cử chỉ để ở `interpretation`.',
].join('\n')

/** Dựng payload cho một actor. Không có đường nào đưa world state vào đây. */
export function buildActorPayload(input: {
  readonly definition: ActorDefinition
  readonly state: ActorState
  readonly perception: Perception
}): ActorPayload {
  const { definition, state, perception } = input
  return {
    actorId: definition.id,
    name: definition.name,
    role: definition.role,
    personality: traitWords(definition.personality),
    goals: [...definition.goals],
    knowledge: [...definition.allowedKnowledge],
    // Chỉ ký ức của CHÍNH actor này. Không có state của actor khác.
    memory: state.memory.slice(-12).map(entry => `[lượt ${entry.turn}] ${entry.text}`),
    beliefs: state.beliefs.map(belief => `${belief.claim} (tin ${Math.round(belief.confidence * 100)}%)`),
    plans: state.plans.map(plan => `${plan.goal} — chờ: ${plan.trigger}`),
    selfTraits: traitWords(state.traits),
    perception: perception.received,
    instruction: ACTOR_INSTRUCTION,
  }
}

/** Prompt đầy đủ gửi cho subagent actor. Đây là toàn bộ những gì nó thấy. */
export function renderActorPrompt(payload: ActorPayload): string {
  const section = (title: string, lines: readonly string[]): string =>
    lines.length === 0 ? '' : `## ${title}\n${lines.map(line => `- ${line}`).join('\n')}\n`
  return [
    `# ${payload.name}${payload.role === '' ? '' : ` — ${payload.role}`}`,
    '',
    // Khai thẳng id: model hay tự chế ("lucien", "quan_gia") nếu chỉ được hỏi "id của bạn".
    `## Mã định danh\n- actor_id: ${payload.actorId}\n`,
    section('Bạn là ai', payload.personality),
    section('Điều bạn muốn', payload.goals),
    section('Điều bạn biết', payload.knowledge),
    section('Ký ức của bạn', payload.memory),
    section('Điều bạn tin', payload.beliefs),
    section('Kế hoạch riêng', payload.plans),
    section('Trạng thái của bạn', payload.selfTraits),
    section('Vừa xảy ra trước mắt bạn', payload.perception === '' ? [] : [payload.perception]),
    payload.instruction,
  ].filter(part => part !== '').join('\n')
}

/** Text dùng cho tuỳ chọn `persona` của subagent DSH (shadow persona cho riêng đứa con này). */
export function actorPersona(definition: ActorDefinition): string {
  return [
    `Bạn là ${definition.name}${definition.role === '' ? '' : `, ${definition.role}`}.`,
    'Bạn là một actor trong một ván roleplay nhiều nhân vật.',
    'Bạn chỉ biết những gì được ghi trong hồ sơ của mình; bạn không có quyền đọc trạng thái thế giới,',
    'không có quyền quyết định điều gì là thật, và không viết lời kể cho người chơi.',
    'Bạn trả về JSON theo schema, trong đó ý định của bạn là đề xuất chứ không phải kết quả.',
  ].join(' ')
}

// ── Chốt chặn cô lập ───────────────────────────────────────────────────────

/**
 * Gom mọi chuỗi KHÔNG được xuất hiện trong prompt của `actorId`: bí mật của ván, kiến thức và ký ức
 * của mọi actor khác, và các item canonical. Dùng cho `assertIsolated` và cho test.
 *
 * Lọc bỏ chuỗi ngắn (< 6 ký tự) để tránh báo động giả trên các từ phổ biến.
 */
export function buildForbiddenList(input: {
  readonly actorId: string
  readonly definitions: readonly ActorDefinition[]
  readonly world: WorldState
  readonly secretFacts: readonly string[]
}): string[] {
  const forbidden = new Set<string>()
  const add = (text: string | undefined): void => {
    if (text === undefined) return
    const trimmed = text.trim()
    if (trimmed.length >= 6) forbidden.add(trimmed)
  }

  for (const fact of input.secretFacts) add(fact)
  for (const [key, item] of Object.entries(input.world.items)) {
    add(key)
    add(item.location)
  }

  for (const definition of input.definitions) {
    if (definition.id === input.actorId) continue
    for (const line of definition.allowedKnowledge) add(line)
    for (const belief of definition.initialBeliefs) add(belief.claim)
    const state = input.world.actors[definition.id]
    if (state === undefined) continue
    for (const observation of state.memory) add(observation.text)
    for (const belief of state.beliefs) add(belief.claim)
    for (const plan of state.plans) add(plan.goal)
  }

  return [...forbidden].sort()
}

export class IsolationError extends Error {
  constructor(readonly leaked: readonly string[]) {
    super(`Prompt của actor chứa ${leaked.length} chuỗi bị cấm: ${leaked.slice(0, 3).join(' | ')}`)
    this.name = 'IsolationError'
  }
}

/**
 * Ném lỗi nếu prompt chứa chuỗi bị cấm. Trường `perception` được miễn kiểm vì nó là lời của chính
 * người chơi đã qua định tuyến — kiểm nó sẽ báo động giả khi người chơi tự nói ra điều gì đó.
 */
export function assertIsolated(prompt: string, forbidden: readonly string[]): void {
  const leaked = forbidden.filter(text => prompt.includes(text))
  if (leaked.length > 0) throw new IsolationError(leaked)
}

// ── Hợp đồng output của actor ──────────────────────────────────────────────

export const ACTOR_INTENT_TYPES = [
  'dialogue',
  'question',
  'move',
  'inspect',
  'command',
  'attack',
  'conceal',
  'wait',
  'none',
] as const
export type ActorIntentType = (typeof ACTOR_INTENT_TYPES)[number]

/** Schema phẳng, nằm trong tập con object-rooted mà DSH hỗ trợ (không minimum/maximum/pattern). */
export const ACTOR_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    actor_id: { type: 'string' },
    interpretation: { type: 'string' },
    emotion: { type: 'string' },
    intent_type: { type: 'string', enum: [...ACTOR_INTENT_TYPES] },
    intent_target: { type: 'string' },
    intent_content: { type: 'string' },
    followup_content: { type: 'string' },
    belief_claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: { claim: { type: 'string' }, confidence: { type: 'number' } },
        required: ['claim', 'confidence'],
        additionalProperties: false,
      },
    },
    plan_goal: { type: 'string' },
    plan_trigger: { type: 'string' },
  },
  required: ['actor_id', 'interpretation', 'emotion', 'intent_type', 'intent_content'],
  additionalProperties: false,
}

export interface ActorIntent {
  readonly type: ActorIntentType
  readonly target?: string
  readonly content: string
}

export interface ActorOutput {
  readonly actorId: string
  readonly interpretation: string
  readonly emotion: string
  readonly intent: ActorIntent
  readonly followup?: ActorIntent
  readonly beliefClaims: readonly { readonly claim: string; readonly confidence: number }[]
  readonly plan?: { readonly goal: string; readonly trigger: string }
}

export interface ActorOutputIssue {
  readonly where: string
  readonly message: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Đọc output thô của actor. Actor là model nên nó có thể trả thiếu trường hoặc bịa `intent_type`:
 * ở đây không ném, chỉ hạ cấp về giá trị an toàn và ghi lại vấn đề.
 */
export function parseActorOutput(raw: unknown, expectedActorId: string): {
  output?: ActorOutput
  issues: ActorOutputIssue[]
} {
  const issues: ActorOutputIssue[] = []
  const record = asRecord(raw)
  if (Object.keys(record).length === 0) {
    return { issues: [{ where: expectedActorId, message: 'Actor không trả object' }] }
  }

  const actorId = typeof record['actor_id'] === 'string' && record['actor_id'].trim() !== ''
    ? record['actor_id'].trim()
    : expectedActorId
  if (actorId !== expectedActorId) {
    issues.push({ where: expectedActorId, message: `actor_id lệch: nhận "${actorId}"` })
  }

  const interpretation = typeof record['interpretation'] === 'string' ? record['interpretation'].trim() : ''
  if (interpretation === '') issues.push({ where: expectedActorId, message: 'thiếu interpretation' })

  const emotion = typeof record['emotion'] === 'string' ? record['emotion'].trim() : ''
  const rawType = typeof record['intent_type'] === 'string' ? record['intent_type'].trim() : ''
  const type = (ACTOR_INTENT_TYPES as readonly string[]).includes(rawType) ? (rawType as ActorIntentType) : 'wait'
  if (rawType !== type) issues.push({ where: expectedActorId, message: `intent_type lạ: ${JSON.stringify(rawType)} → wait` })

  const content = typeof record['intent_content'] === 'string' ? record['intent_content'].trim() : ''
  if (content === '') issues.push({ where: expectedActorId, message: 'thiếu intent_content' })
  const target = typeof record['intent_target'] === 'string' && record['intent_target'].trim() !== ''
    ? record['intent_target'].trim()
    : undefined

  const followupContent = typeof record['followup_content'] === 'string' ? record['followup_content'].trim() : ''
  const followup = followupContent === '' ? undefined : { type: 'dialogue' as ActorIntentType, content: followupContent }

  const beliefClaims: { claim: string; confidence: number }[] = []
  if (Array.isArray(record['belief_claims'])) {
    for (const entry of record['belief_claims']) {
      const belief = asRecord(entry)
      const claim = typeof belief['claim'] === 'string' ? belief['claim'].trim() : ''
      if (claim === '') continue
      const rawConfidence = typeof belief['confidence'] === 'number' ? belief['confidence'] : 0.5
      beliefClaims.push({ claim, confidence: Math.min(1, Math.max(0, rawConfidence)) })
    }
  }

  const planGoal = typeof record['plan_goal'] === 'string' ? record['plan_goal'].trim() : ''
  const planTrigger = typeof record['plan_trigger'] === 'string' ? record['plan_trigger'].trim() : ''
  const plan = planGoal === '' || planTrigger === '' ? undefined : { goal: planGoal, trigger: planTrigger }

  return {
    output: {
      actorId: expectedActorId,
      interpretation,
      emotion,
      intent: { type, content, ...(target === undefined ? {} : { target }) },
      ...(followup === undefined ? {} : { followup }),
      beliefClaims,
      ...(plan === undefined ? {} : { plan }),
    },
    issues,
  }
}
