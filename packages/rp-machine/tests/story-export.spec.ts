import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ALL_ACTORS, SECRET_FACTS, actorAction, makeCastleWorld } from './fixtures/actors'
import { runActorTurn } from '../src/actor/turn'
import { createScriptedActorRunner } from '../src/actor/session'
import { newRunState } from '../src/runtime'
import { makeRichPool } from './fixtures/cards'
import { generateScene } from '../src/scene'
import type { GeneratedScene } from '../src/scene'
import {
  appendNarration,
  appendTurn,
  loadStoryTurns,
  readTranscript,
  transcriptFileOf,
  transcriptSummary,
  turnRecordFromActorTurn,
  turnRecordFromSingleTurn,
  withTurnOutcome,
} from '../src/story/transcript'
import {
  buildStoryExport,
  ironyTable,
  povSectionIds,
  povSections,
  renderMaterial,
} from '../src/story/export'
import { PovViolation, assertPovSafe, povForbidden, povLeaksIn } from '../src/story/guard'

/**
 * Export history — tất cả ở đây chạy không cần model.
 *
 * Trọng tâm: ba góc nhìn là ba tập dữ liệu, và việc cắt theo POV phải kiểm được bằng cách soi nguyên liệu
 * thật sự được dựng ra.
 */

const TEMP_DIRS: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-story-'))
  TEMP_DIRS.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const NOW = '2026-01-01T00:00:00.000Z'

function castleScene(): GeneratedScene {
  return generateScene(makeRichPool(), { seed: 'story-export', mode: 'boss_mode', now: NOW }).scene
}

/** Chạy hai lượt thật bằng runner giả, rồi dựng transcript từ chính kết quả đó. */
async function twoTurnTranscript(scene: GeneratedScene): Promise<{
  root: string
  scene: GeneratedScene
  turns: ReturnType<typeof loadStoryTurns>
  state: ReturnType<typeof newRunState>
}> {
  const root = tempDir()
  const sceneId = 'scene-story'
  let state = { ...newRunState(scene, '2026-01-01T00:00:00.000Z'), sceneId }

  // Lượt 1: quản gia ở ngưỡng cửa bếp (cùng phòng với người chơi) đáp lời; Lucien ở phòng ăn nín thở và nấp.
  const world1 = makeCastleWorld()
  const first = await runActorTurn(
    { world: world1, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), turn: 1, secretFacts: SECRET_FACTS },
    {
      runner: createScriptedActorRunner({
        npc_butler: {
          actorId: 'npc_butler',
          interpretation: 'Đầu bếp vừa gọi ta.',
          emotion: 'điềm tĩnh',
          intent: { type: 'dialogue', content: 'Dạ, thưa ngài.' },
          beliefClaims: [{ claim: 'Đầu bếp đang giấu một kế hoạch bí mật.', confidence: 0.7 }],
          plan: { goal: 'theo dõi đầu bếp', trigger: 'player_leaves_kitchen' },
        },
        npc_lucien: {
          actorId: 'npc_lucien',
          interpretation: 'Có kẻ lạ trong lâu đài.',
          emotion: 'cảnh giác',
          intent: { type: 'conceal', target: 'player', content: 'Nín thở sau cánh cửa.' },
          beliefClaims: [],
        },
      }),
      force: ['npc_lucien', 'npc_butler'],
      seed: 's',
    },
  )
  state = { ...state, turn: 1, history: [{ turn: 1, action: actorAction().text, outcome: '', at: '2026-01-01T00:01:00.000Z' }] }
  appendTurn(root, turnRecordFromActorTurn({ sceneId, at: '2026-01-01T00:01:00.000Z', state, definitions: ALL_ACTORS, action: actorAction({ volume: 'loud' }), result: first }))

  // Lượt 2: người chơi đi sang kho.
  const second = await runActorTurn(
    { world: first.world, definitions: ALL_ACTORS, action: actorAction({ type: 'move', toLocation: 'pantry', text: 'Tôi đi vào kho.', volume: 'whisper' }), turn: 2 },
    { runner: createScriptedActorRunner({}), seed: 's' },
  )
  state = { ...state, turn: 2, history: [...state.history, { turn: 2, action: 'Tôi đi vào kho.', outcome: '', at: '2026-01-01T00:02:00.000Z' }] }
  appendTurn(root, turnRecordFromActorTurn({ sceneId, at: '2026-01-01T00:02:00.000Z', state, definitions: ALL_ACTORS, action: actorAction({ type: 'move', toLocation: 'pantry', text: 'Tôi đi vào kho.', volume: 'whisper' }), result: second }))

  // Lời kể nộp muộn, và nộp lệch thứ tự: lượt 2 trước, rồi mới tới lượt 1.
  appendNarration(root, { sceneId, turn: 2, at: '2026-01-01T00:02:30.000Z', narration: 'Kho tối và lạnh.', outcome: 'Người chơi đã ở trong kho.' })
  appendNarration(root, { sceneId, turn: 1, at: '2026-01-01T00:01:30.000Z', narration: 'Giọng nói vọng ra từ phòng ăn.' })

  return { root, scene, turns: loadStoryTurns(root, sceneId), state }
}

describe('transcript — ghi và đọc', () => {
  it('dựng bản ghi một lượt từ kết quả pipeline, không cần model', async () => {
    const scene = castleScene()
    const { turns } = await twoTurnTranscript(scene)

    expect(turns).toHaveLength(2)
    expect(turns[0]?.mode).toBe('actor')
    expect(turns[0]?.playerAction).toContain('năm trăm năm')
    // Lượt 1 có lời thoại của quản gia và một ý định riêng tư của Lucien.
    const types = turns[0]?.events.map(event => event.type) ?? []
    expect(types).toContain('npc_dialogue')
    expect(types).toContain('observation')
    const privateEvent = turns[0]?.events.find(event => event.visibility === 'private')
    expect(privateEvent?.text).toContain('Dự định này chưa được thực hiện')
    // Người chơi ở phòng ăn cùng phòng với quản gia nên nhận nguyên văn.
    expect(turns[0]?.playerPerceived.join(' ')).toContain('Dạ, thưa ngài.')
  })

  it('bản đồ irony có mặt trong event, và event riêng tư không được tính là ai biết', async () => {
    const scene = castleScene()
    const { turns } = await twoTurnTranscript(scene)
    const dialogue = turns[0]?.events.find(event => event.type === 'npc_dialogue')
    expect(dialogue?.playerFidelity).toBe('full')
    // Lucien là nguồn nói? Không — nguồn là quản gia; Lucien không hề có mặt trong danh sách người nhận.
    expect(dialogue?.perceivedBy.some(entry => entry.actorId === 'npc_lucien')).toBe(false)

    const table = ironyTable(turns)
    expect(table).toContain('| Lượt | Sự kiện | Người chơi | Actor |')
    expect(table).not.toContain('Dự định này chưa được thực hiện')
  })

  it('Lucien nín thở và nấp là ý định riêng tư: không lượt nào nói nó thành sự thật', async () => {
    const scene = castleScene()
    const { turns } = await twoTurnTranscript(scene)
    expect(turns[0]?.privateEvents.join(' ')).toContain('Nín thở')
    expect(turns[0]?.events.some(event => event.type === 'actor_trait')).toBe(false)
    // Niềm tin của quản gia nằm trong nội tâm, không nằm trong canon.
    const butler = turns[0]?.actors.find(actor => actor.id === 'npc_butler')
    expect(butler?.beliefs.join(' ')).toContain('kế hoạch bí mật')
    expect(butler?.plan).toContain('theo dõi đầu bếp')
  })

  it('lời kể nộp lệch thứ tự vẫn gắn đúng lượt của nó', async () => {
    const scene = castleScene()
    const { turns } = await twoTurnTranscript(scene)
    expect(turns[0]?.turn).toBe(1)
    expect(turns[0]?.narration).toBe('Giọng nói vọng ra từ phòng ăn.')
    expect(turns[0]?.outcome).toBeUndefined()
    expect(turns[1]?.narration).toBe('Kho tối và lạnh.')
    expect(turns[1]?.outcome).toBe('Người chơi đã ở trong kho.')
  })

  it('dòng hỏng trong file append-only bị bỏ qua, không làm mất cả transcript', async () => {
    const scene = castleScene()
    const { root, turns } = await twoTurnTranscript(scene)
    const file = transcriptFileOf(root, 'scene-story')
    fs.appendFileSync(file, 'đây không phải json\n{"kind":"turn","version":"rp-transcript-v0"}\n', 'utf8')
    // Hai dòng rác bị bỏ; hai lượt và hai lời kể vẫn nguyên.
    expect(readTranscript(root, 'scene-story').filter(record => record.kind === 'turn')).toHaveLength(2)
    expect(loadStoryTurns(root, 'scene-story')).toHaveLength(2)
  })

  it('chế độ một-model ghi được cùng schema, actors rỗng', () => {
    const root = tempDir()
    const scene = castleScene()
    const state = { ...newRunState(scene, '2026-01-01T00:00:00.000Z'), sceneId: 'scene-single', turn: 1 }
    appendTurn(root, turnRecordFromSingleTurn({
      sceneId: 'scene-single',
      at: '2026-01-01T00:00:10.000Z',
      state,
      action: actorAction({ text: 'Tôi mở cửa.' }),
      playerLocation: '',
    }))
    const turns = loadStoryTurns(root, 'scene-single')
    expect(turns).toHaveLength(1)
    expect(turns[0]?.mode).toBe('single')
    expect(turns[0]?.actors).toEqual([])
    expect(turns[0]?.playerAction).toBe('Tôi mở cửa.')
  })

  it('withTurnOutcome vá đúng lượt trong state.json', () => {
    const scene = castleScene()
    const state = { ...newRunState(scene, 't'), sceneId: 'x', turn: 2, history: [
      { turn: 1, action: 'a', outcome: '', at: 't1' },
      { turn: 2, action: 'b', outcome: '', at: 't2' },
    ] }
    const patched = withTurnOutcome(state, 1, 'Cửa đã mở.')
    expect(patched.history[0]?.outcome).toBe('Cửa đã mở.')
    expect(patched.history[1]?.outcome).toBe('')
    expect(withTurnOutcome(state, 1, '   ')).toBe(state)
  })

  it('summary đếm đúng, không chứa nội dung', async () => {
    const scene = castleScene()
    const { turns } = await twoTurnTranscript(scene)
    const summary = transcriptSummary(turns)
    expect(summary.turns).toBe(2)
    expect(summary.narrated).toBe(2)
    expect(summary.modes).toEqual(['actor'])
    expect(summary.actorTurns).toBeGreaterThan(0)
    expect(JSON.stringify(summary)).not.toContain('kế hoạch bí mật')
  })
})

describe('export — nhãn phân loại và bản đồ irony', () => {
  it('đủ chín mục, đúng nhãn, và bản đầy đủ có chứa sự thật bị niêm phong (nó là hồ sơ phía Thiên Đạo)', async () => {
    const scene = castleScene()
    const { turns, state } = await twoTurnTranscript(scene)
    const exp = buildStoryExport({ sceneId: 'scene-story', generatedAt: 'now', turns, scene, state, definitions: ALL_ACTORS })

    expect(exp.sections.map(section => section.id)).toEqual([
      'header', 'context', 'texture', 'sealed', 'timeline', 'irony', 'inner', 'rendering', 'ending',
    ])
    expect(exp.sections.find(section => section.id === 'sealed')?.classification).toBe('sealed')
    expect(exp.sections.find(section => section.id === 'rendering')?.classification).toBe('rendering')
    expect(exp.markdown).toContain(scene.sceneCore.hiddenTruth)
    expect(exp.markdown).toContain('kế hoạch bí mật')
    expect(exp.markdown).toContain('Giọng nói vọng ra từ phòng ăn.')
  })

  it('bảng màu lấy mảnh card có tác giả, và không lấy hiddenTruth', async () => {
    const scene = castleScene()
    const { turns, state } = await twoTurnTranscript(scene)
    const exp = buildStoryExport({ sceneId: 'scene-story', generatedAt: 'now', turns, scene, state, definitions: ALL_ACTORS })
    const texture = exp.sections.find(section => section.id === 'texture')?.body ?? ''
    const cardsWithPrompt = Object.values(scene.cardFragments).filter(fragment => fragment.prompt.trim() !== '')
    if (cardsWithPrompt.length > 0) expect(texture).toContain(cardsWithPrompt[0]?.prompt.trim().slice(0, 40) ?? '')
    expect(texture).not.toContain(scene.sceneCore.hiddenTruth)
  })
})

describe('cắt theo POV — đây là chỗ cô lập được cưỡng chế', () => {
  async function exported() {
    const scene = castleScene()
    const { turns, state } = await twoTurnTranscript(scene)
    const exp = buildStoryExport({ sceneId: 'scene-story', generatedAt: 'now', turns, scene, state, definitions: ALL_ACTORS })
    return { exp, scene, turns, state }
  }

  it('POV1 không chứa sự thật bị niêm phong, không chứa nội tâm ai', async () => {
    const { exp, scene } = await exported()
    const material = renderMaterial(exp, 'player')

    expect(material).not.toContain(scene.sceneCore.hiddenTruth)
    expect(material).not.toContain(scene.sceneCore.chaosTwist)
    expect(material).not.toContain('kế hoạch bí mật')
    expect(material).not.toContain('theo dõi đầu bếp')
    expect(material).not.toContain('Nín thở')
    expect(material).not.toContain('Tin:')
    // Nhưng phải có thứ người chơi đã biết.
    expect(material).toContain(scene.sceneCore.playerRole)
    expect(material).toContain('Dạ, thưa ngài.')
    // Không có mục nào ngoài danh sách cho phép.
    expect(povSectionIds('player')).toEqual(['header', 'context', 'texture', 'timeline', 'rendering', 'ending'])
  })

  it('POV1 chỉ thấy sự thật nó tri giác được', async () => {
    const { exp } = await exported()
    const player = renderMaterial(exp, 'player')
    const kami = renderMaterial(exp, 'kami')
    // Lượt 2 chỉ có player_move — người chơi luôn biết việc mình làm.
    expect(player).toContain('player_move')
    expect(kami).toContain('player_move')
    // Lượt 1 có một observation riêng tư: POV1 mù, POV2 thấy.
    const timeline = exp.sections.find(section => section.id === 'timeline')?.body ?? ''
    expect(timeline).toContain('RIÊNG TƯ')
    expect(player).not.toContain('Dự định này chưa được thực hiện')
  })

  it('POV3 chỉ thấy kiến thức và nội tâm của chính nó', async () => {
    const { exp, scene } = await exported()
    const lucien = renderMaterial(exp, 'npc', 'npc_lucien')
    const butler = renderMaterial(exp, 'npc', 'npc_butler')

    const butlerDefinition = ALL_ACTORS.find(definition => definition.id === 'npc_butler')!
    expect(butler).toContain(butlerDefinition.allowedKnowledge[0] as string)
    expect(lucien).not.toContain(butlerDefinition.allowedKnowledge[0] as string)
    // Nội tâm: quản gia có niềm tin và kế hoạch của nó, Lucien thì không.
    expect(butler).toContain('kế hoạch bí mật')
    expect(lucien).not.toContain('kế hoạch bí mật')
    expect(lucien).toContain('Nín thở')
    expect(butler).not.toContain('Nín thở')
    // POV3 không được thấy bí mật ván, và không được thấy lời kể (lời kể có thể chứa thứ nó không biết).
    expect(butler).not.toContain(scene.sceneCore.hiddenTruth)
    expect(butler).not.toContain('Giọng nói vọng ra từ phòng ăn.')
    expect(povSectionIds('npc')).toEqual(['header', 'texture', 'timeline', 'inner', 'ending'])
  })

  it('POV2 và toàn tri thấy tất cả', async () => {
    const { exp, scene } = await exported()
    for (const pov of ['kami', 'omniscient'] as const) {
      const material = renderMaterial(exp, pov)
      expect(material).toContain(scene.sceneCore.hiddenTruth)
      expect(material).toContain('kế hoạch bí mật')
      expect(material).toContain('Ai biết gì')
    }
  })

  it('povSections trả đúng tập mục cho từng góc nhìn', async () => {
    const { exp } = await exported()
    expect(povSections(exp, 'player').map(section => section.id)).not.toContain('sealed')
    expect(povSections(exp, 'player').map(section => section.id)).not.toContain('inner')
    expect(povSections(exp, 'npc', 'npc_butler').map(section => section.id)).toContain('inner')
    expect(povSections(exp, 'kami').map(section => section.id)).toContain('sealed')
  })
})

describe('guard — rò rỉ là lỗi kiến trúc, không phải lỗi văn phong', () => {
  async function setup() {
    const scene = castleScene()
    const { turns, state } = await twoTurnTranscript(scene)
    const exp = buildStoryExport({ sceneId: 'scene-story', generatedAt: 'now', turns, scene, state, definitions: ALL_ACTORS })
    const material = renderMaterial(exp, 'player')
    const forbidden = povForbidden({ pov: 'player', scene, definitions: ALL_ACTORS, turns, material })
    return { forbidden, scene, turns, material }
  }

  it('bí mật ván nằm trong danh sách cấm của POV1', async () => {
    const { forbidden, scene } = await setup()
    expect(forbidden.map(entry => entry.text)).toContain(scene.sceneCore.hiddenTruth)
    expect(forbidden.map(entry => entry.classification)).toContain('sealed')
  })

  it('câu người chơi ĐÃ nghe không bị coi là rò rỉ (không báo động giả)', async () => {
    const { forbidden } = await setup()
    const heard = 'Dạ, thưa ngài.'
    expect(forbidden.map(entry => entry.text)).not.toContain(heard)
  })

  it('truyện POV1 nhắc tới bí mật thì bị chặn', async () => {
    const { forbidden, scene } = await setup()
    const bad = `Đêm ấy, hắn lén bỏ thuốc độc vào bát canh. ${scene.sceneCore.hiddenTruth}`
    expect(() => assertPovSafe(bad, forbidden, 'player')).toThrow(PovViolation)
    expect(povLeaksIn(bad, forbidden)).toHaveLength(1)
  })

  it('truyện POV1 sạch thì qua', async () => {
    const { forbidden } = await setup()
    expect(() => assertPovSafe('Quản gia cúi đầu và lùi lại nửa bước.', forbidden, 'player')).not.toThrow()
  })

  it('POV2 không cấm gì: hàng rào ở đó là người chơi đã yêu cầu có spoil', async () => {
    const { scene, turns } = await setup()
    const material = renderMaterial(buildStoryExport({ sceneId: 's', generatedAt: 'now', turns, scene, definitions: ALL_ACTORS }), 'kami')
    expect(povForbidden({ pov: 'kami', scene, definitions: ALL_ACTORS, turns, material })).toEqual([])
  })
})
