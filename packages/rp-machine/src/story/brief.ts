/**
 * Writer brief — biến "viết lại thành truyện ngắn" thành một hợp đồng có tham số.
 *
 * Khác biệt cốt lõi so với việc nhờ chính quản trò viết: writer **không thấy phiên chat**. Nó chỉ thấy
 * nguyên liệu của đúng góc nhìn được yêu cầu, nên "POV1 không spoil" là chuyện của dữ liệu, không phải
 * chuyện của lời dặn.
 */

import type { ActorDefinition } from '../actor/model'
import { povLabel, renderMaterial, type Pov, type StoryExport } from './export'

export const WRITER_LENGTHS = ['short', 'medium', 'long'] as const
export type WriterLength = (typeof WRITER_LENGTHS)[number]

export const WRITER_STYLES = ['plain', 'sparse', 'lyrical', 'noir'] as const
export type WriterStyle = (typeof WRITER_STYLES)[number]

/** Nhãn `omit` dựng sẵn — người dùng hay yêu cầu nhất. Ngoài ra nhận chuỗi tự do. */
export const WRITER_OMIT = ['player_fumbles', 'ooc', 'mechanics', 'minor_turns'] as const
export type WriterOmit = (typeof WRITER_OMIT)[number]

export const LENGTH_INFO: Readonly<Record<WriterLength, { readonly words: number; readonly note: string }>> = {
  short: { words: 700, note: 'một cảnh, một mạch, không chương hồi' },
  medium: { words: 1800, note: 'hai tới bốn cảnh, có thể ngắt bằng dấu * * *' },
  long: { words: 4000, note: 'nhiều cảnh, có thể chia phần bằng tiêu đề nhỏ' },
}

export const STYLE_INFO: Readonly<Record<WriterStyle, string>> = {
  plain: 'kể trung tính, câu vừa phải, không trang trí, ưu tiên rõ ràng',
  sparse: 'câu ngắn, nhiều khoảng trắng, hành động nhiều hơn miêu tả, bỏ tính từ thừa',
  lyrical: 'giàu hình ảnh và nhịp điệu, cho phép ẩn dụ, cho phép câu dài',
  noir: 'lạnh và nghi ngờ, giác quan nặng (mùi, tối, tiếng động), nhân vật nào cũng giấu điều gì',
}

export const OMIT_INFO: Readonly<Record<WriterOmit, string>> = {
  player_fumbles: 'Bỏ hoặc nén những lượt người chơi hành xử vụng về, lạc hướng, hỏi những câu vô nghĩa. Không cần kể lại mọi lần họ lúng túng.',
  ooc: 'Không đưa bất kỳ dấu vết ngoài truyện nào vào (nhắc luật, nhắc hệ thống, xin lỗi, giải thích).',
  mechanics: 'Không nêu con số, tên thanh căng thẳng, số bước thắng, chaos, cảnh cáo. Chúng là cơ chế, không phải truyện.',
  minor_turns: 'Gộp những lượt không đẩy cốt truyện thành một câu hoặc bỏ hẳn.',
}

export interface WriterBrief {
  readonly pov: Pov
  /** Bắt buộc khi `pov === 'npc'`. */
  readonly actorId?: string
  readonly length: WriterLength
  readonly style: WriterStyle
  /** Yêu cầu tự do của người dùng. */
  readonly focus?: string
  /** Nhãn trong `WRITER_OMIT` hoặc chuỗi tự do. */
  readonly omit?: readonly string[]
  readonly language?: string
}

export const WRITER_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    notes: {
      type: 'array',
      description: 'Những chi tiết bạn TỰ THÊM mà hồ sơ không có (mùi, ánh sáng, thời tiết, cử chỉ). Để trống nếu không thêm gì.',
      items: { type: 'string' },
    },
  },
  required: ['title', 'body'],
  additionalProperties: false,
}

export interface WriterOutput {
  readonly title: string
  readonly body: string
  readonly notes: readonly string[]
}

export const WRITER_INSTRUCTION = [
  'Bạn là người viết truyện ngắn. Bạn KHÔNG phải quản trò, KHÔNG phải trợ lý, KHÔNG viết tiếp phiên chat.',
  '',
  'Luật bất biến:',
  '1. Hồ sơ dưới đây là TẤT CẢ những gì bạn biết. Không thêm sự kiện, nhân vật, địa điểm, hay quan hệ mới.',
  '2. Hồ sơ có thể chứa mục "niềm tin" — đó là điều nhân vật TIN, và nó có thể SAI so với sự thật. Giữ',
  '   nguyên cái sai đó nếu góc nhìn là của nhân vật; đừng sửa cho đúng.',
  '3. Mục "lời kể của Thiên Đạo" là bản kể CŨ, không phải sự thật: nó có thể chứa chi tiết do quản trò thêm.',
  '4. Chi tiết giác quan bạn tự thêm (mùi, ánh sáng, thời tiết, nhịp thở) thì được — nhưng phải liệt kê',
  '   ở trường `notes`. `notes` rỗng nghĩa là bạn không thêm gì ngoài hồ sơ.',
  '5. Không nhắc tới luật chơi, tới tool, tới AI, tới việc đây là một ván. Truyện phải đứng một mình.',
  '6. Không tiết lộ điều gì mà hồ sơ dưới đây không chứa.',
  '',
  'Trả về JSON theo schema: title, body, notes[]. Không kèm lời dẫn nào khác.',
].join('\n')

export function povRule(pov: Pov): string {
  switch (pov) {
    case 'player':
      return 'Kể ở ngôi thứ nhất hoặc ngôi thứ ba bám sát người chơi. Người đọc chỉ được biết những gì người chơi đã tri giác được; mọi mục khác đã bị cắt khỏi hồ sơ, nên đừng suy diễn thêm về việc người khác đang nghĩ gì.'
    case 'npc':
      return 'Kể bám sát nhân vật này. Bạn được dùng toàn bộ nội tâm của nó, và phải tôn trọng giới hạn hiểu biết của nó: điều nó không nhận được thì nó không biết, kể cả khi người đọc tò mò.'
    case 'kami':
      return 'Kể bằng giọng của thế giới, không phải của một con người: đều đều, không trấn an, không mỉa mai, như một bản ghi do thứ không hiểu con người phát ra. Bạn thấy toàn bộ sự thật, kể cả phần bị niêm phong.'
    case 'omniscient':
      return 'Kể ở ngôi thứ ba toàn tri. Người đọc biết thứ người chơi không biết — hãy dùng chính khoảng cách đó làm chất liệu (dramatic irony), chứ đừng chỉ kể lại sự việc theo thứ tự.'
  }
}

export function renderWriterPrompt(input: {
  readonly exp: StoryExport
  readonly brief: WriterBrief
  readonly definitions?: readonly ActorDefinition[]
}): string {
  const { brief } = input
  const length = LENGTH_INFO[brief.length]
  const omitLines = (brief.omit ?? []).map(entry =>
    (WRITER_OMIT as readonly string[]).includes(entry) ? OMIT_INFO[entry as WriterOmit] : entry,
  )

  const request = [
    '## Yêu cầu',
    `- Góc nhìn: ${povLabel(brief.pov, brief.actorId, input.definitions)}`,
    `- ${povRule(brief.pov)}`,
    `- Độ dài: khoảng ${length.words} từ — ${length.note}`,
    `- Giọng văn: ${STYLE_INFO[brief.style]}`,
    `- Ngôn ngữ: ${brief.language ?? 'tiếng Việt'}`,
    ...(omitLines.length === 0 ? [] : [['- Lược bỏ:', ...omitLines.map(line => `  · ${line}`)].join('\n')]),
    ...(brief.focus === undefined || brief.focus.trim() === '' ? [] : [`- Người dùng dặn thêm: ${brief.focus.trim()}`]),
  ].join('\n')

  return [
    WRITER_INSTRUCTION,
    '',
    request,
    '',
    '## Hồ sơ',
    renderMaterial(input.exp, brief.pov, brief.actorId),
    '',
    'Viết truyện từ hồ sơ trên. Trả JSON: title, body, notes[].',
  ].join('\n')
}

export function writerPersona(pov: Pov): string {
  const shapes: Record<Pov, string> = {
    player: 'Bạn viết truyện ngắn ở góc nhìn của một nhân vật, và chỉ được biết những gì nhân vật đó biết.',
    npc: 'Bạn viết truyện ngắn ở góc nhìn của một nhân vật phụ, tôn trọng giới hạn hiểu biết của người đó.',
    kami: 'Bạn viết truyện ngắn bằng giọng của thế giới: đều đều, không cảm xúc, không phán xét.',
    omniscient: 'Bạn viết truyện ngắn toàn tri, dùng khoảng cách hiểu biết giữa các nhân vật làm chất liệu.',
  }
  return `${shapes[pov]} Bạn chỉ nhận một hồ sơ và trả về JSON; bạn không có quyền đọc gì thêm.`
}

// ── Đọc output của writer ─────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** BODY_MIN: dưới ngưỡng này thì coi như writer trả rỗng, và người gọi phải biết. */
export const BODY_MIN = 200

export function parseWriterOutput(raw: unknown): { output?: WriterOutput; issues: string[] } {
  const issues: string[] = []
  const record = asRecord(raw)
  if (Object.keys(record).length === 0) return { issues: ['Writer không trả object'] }

  const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
  if (title === '') issues.push('thiếu title')

  const body = typeof record['body'] === 'string' ? record['body'].trim() : ''
  if (body === '') issues.push('thiếu body')
  else if (body.length < BODY_MIN) issues.push(`body quá ngắn (${body.length} ký tự, dưới ${BODY_MIN})`)

  const notes = Array.isArray(record['notes'])
    ? record['notes'].filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []

  if (body === '') return { issues }
  return { output: { title: title === '' ? '(không tiêu đề)' : title, body, notes }, issues }
}

/** Đếm từ thô, đủ để báo cáo độ dài. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(word => word !== '').length
}
