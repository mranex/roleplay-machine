import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadPool } from '../src/card-schema'
import { generateScene, type GeneratedScene } from '../src/scene'
import {
  adjustMeter,
  applyOocStrike,
  completeWinStep,
  evaluateStatus,
  findMeter,
  isEventDue,
  listRuns,
  loadRun,
  newRunState,
  oocStrikeBudget,
  progressOf,
  recordTurn,
  renderEnding,
  renderGmFrame,
  renderPublicFrame,
  saveRun,
  setMeter,
  stepsDone,
  type RunState,
} from '../src/runtime'
import { makeCleanPool, makeRichPool, realPoolDir } from './fixtures/cards'

const NOW = '2026-01-01T00:00:00.000Z'

function sceneFrom(pool = makeRichPool(), strictness: 'strict' | 'soft' | 'chaotic' = 'soft'): GeneratedScene {
  return generateScene(pool, { seed: 'runtime-test', mode: 'boss_mode', settings: { strictness }, now: NOW }).scene
}

function freshRun(pool = makeRichPool(), strictness: 'strict' | 'soft' | 'chaotic' = 'soft'): { scene: GeneratedScene; state: RunState } {
  const scene = sceneFrom(pool, strictness)
  return { scene, state: newRunState(scene, NOW) }
}

describe('khởi tạo ván', () => {
  it('thanh căng thẳng khởi tạo đúng giá trị start của card', () => {
    const { state } = freshRun()
    expect(state.meters.map(meter => meter.id)).toEqual(['nghi-ngo', 'thoi-gian'])
    expect(state.meters[0]?.value).toBe(1)
    expect(state.meters[1]?.value).toBe(0)
    expect(state.meters[0]?.failAt).toBe(5)
  })

  it('bước thắng lấy từ scene, chưa bước nào xong', () => {
    const { state } = freshRun()
    expect(state.winSteps).toHaveLength(3)
    expect(state.winSteps.every(step => !step.done)).toBe(true)
    expect(state.status).toBe('active')
    expect(state.turn).toBe(0)
  })

  it('trần cảnh cáo OOC phụ thuộc độ khắt khe của Thiên Đạo', () => {
    expect(oocStrikeBudget(5)).toBe(2)
    expect(oocStrikeBudget(3)).toBe(3)
    expect(oocStrikeBudget(2)).toBe(4)
    expect(newRunState(sceneFrom(makeRichPool(), 'strict'), NOW).maxOocStrikes).toBe(2)
    expect(newRunState(sceneFrom(makeRichPool(), 'soft'), NOW).maxOocStrikes).toBe(3)
    expect(newRunState(sceneFrom(makeRichPool(), 'chaotic'), NOW).maxOocStrikes).toBe(4)
  })

  it('ván tự chứa lời cảnh cáo nên sống độc lập với file scene', () => {
    const { scene, state } = freshRun()
    expect(state.warningLine).toBe(scene.kamiSama.warningLine)
    expect(state.terminationLine).toBe(scene.kamiSama.terminationLine)
  })
})

describe('trục 1 — cổng OOC', () => {
  it('cảnh cáo tăng dần và đủ trần thì bị trục xuất', () => {
    let { state } = freshRun()
    for (let i = 1; i <= 2; i++) {
      const result = applyOocStrike(state, `vi phạm ${i}`, NOW)
      expect(result.ok).toBe(true)
      expect(result.ejected).toBe(false)
      expect(result.state.oocStrikes).toBe(i)
      expect(result.text).toContain('Cảnh cáo')
      state = result.state
    }
    const third = applyOocStrike(state, 'vi phạm 3', NOW)
    expect(third.ejected).toBe(true)
    expect(third.state.status).toBe('ejected')
    expect(third.text).toContain(state.terminationLine)
  })

  it('độ khắt khe quyết định số lần được phép', () => {
    let strict = newRunState(sceneFrom(makeRichPool(), 'strict'), NOW)
    strict = applyOocStrike(strict, 'lần 1', NOW).state
    expect(strict.status).toBe('active')
    strict = applyOocStrike(strict, 'lần 2', NOW).state
    expect(strict.status).toBe('ejected')

    let chaotic = newRunState(sceneFrom(makeRichPool(), 'chaotic'), NOW)
    for (let i = 0; i < 3; i++) chaotic = applyOocStrike(chaotic, `lần ${i}`, NOW).state
    expect(chaotic.status).toBe('active')
    chaotic = applyOocStrike(chaotic, 'lần 4', NOW).state
    expect(chaotic.status).toBe('ejected')
  })

  it('ván đã kết thúc thì không ghi thêm cảnh cáo', () => {
    let { state } = freshRun()
    state = completeWinStep(state, 1, NOW).state
    state = completeWinStep(state, 2, NOW).state
    state = completeWinStep(state, 3, NOW).state
    expect(state.status).toBe('won')
    const after = applyOocStrike(state, 'muộn', NOW)
    expect(after.ok).toBe(false)
    expect(after.state.oocStrikes).toBe(0)
  })
})

describe('trục 2 — thanh căng thẳng', () => {
  it('tăng giá trị và báo đúng nhãn thanh', () => {
    const { state } = freshRun()
    const result = adjustMeter(state, 'nghi-ngo', 1, 'nói hớ', NOW)
    expect(result.ok).toBe(true)
    expect(result.failed).toBe(false)
    expect(findMeter(result.state, 'nghi-ngo')?.value).toBe(2)
    expect(result.text).toContain('Nghi ngờ')
    expect(result.text).toContain('2/5')
  })

  it('chạm failAt là thua', () => {
    let { state } = freshRun()
    for (let i = 0; i < 3; i++) state = adjustMeter(state, 'nghi-ngo', 1, 'bị để ý', NOW).state
    expect(findMeter(state, 'nghi-ngo')?.value).toBe(4)
    expect(state.status).toBe('active')
    const last = adjustMeter(state, 'nghi-ngo', 1, 'bị để ý', NOW)
    expect(last.failed).toBe(true)
    expect(last.state.status).toBe('lost')
    expect(last.text).toMatch(/chạm 5/)
  })

  it('giá trị bị kẹp trong min..max', () => {
    const { state } = freshRun()
    const high = adjustMeter(state, 'nghi-ngo', 99, 'quá đà', NOW)
    expect(findMeter(high.state, 'nghi-ngo')?.value).toBe(5)
    const low = adjustMeter(state, 'thoi-gian', -10, 'lùi lại', NOW)
    expect(findMeter(low.state, 'thoi-gian')?.value).toBe(0)
  })

  it('setMeter đặt giá trị tuyệt đối', () => {
    const { state } = freshRun()
    const result = setMeter(state, 'nghi-ngo', 4, 'đặt lại', NOW)
    expect(findMeter(result.state, 'nghi-ngo')?.value).toBe(4)
  })

  it('thanh không tồn tại thì từ chối, không nổ', () => {
    const { state } = freshRun()
    const result = adjustMeter(state, 'khong-co', 1, 'x', NOW)
    expect(result.ok).toBe(false)
    expect(result.text).toMatch(/Không có thanh/)
  })

  it('thanh thứ hai cũng siết được độc lập', () => {
    let { state } = freshRun()
    for (let i = 0; i < 3; i++) state = adjustMeter(state, 'thoi-gian', 1, 'đêm trôi', NOW).state
    expect(state.status).toBe('lost')
    expect(state.ending).toMatch(/Thời gian chạm 3/)
  })
})

describe('hai trục không trộn vào nhau', () => {
  it('nói hớ trong vai làm nghi ngờ tăng nhưng KHÔNG sinh cảnh cáo OOC', () => {
    const { state } = freshRun()
    const afterMeter = adjustMeter(state, 'nghi-ngo', 2, 'lời nói hớ trong vai', NOW)
    expect(afterMeter.state.oocStrikes).toBe(0)
    const afterOoc = applyOocStrike(state, 'tự nhận có vũ khí', NOW)
    expect(findMeter(afterOoc.state, 'nghi-ngo')?.value).toBe(1)
    expect(afterOoc.state.status).toBe('active')
  })
})

describe('bước thắng và cái kết', () => {
  it('xong hết bước thì thắng', () => {
    let { state } = freshRun()
    for (const step of [1, 2]) {
      const result = completeWinStep(state, step, NOW)
      expect(result.ok).toBe(true)
      expect(result.finished).toBe(false)
      state = result.state
    }
    const last = completeWinStep(state, 3, NOW)
    expect(last.finished).toBe(true)
    expect(last.state.status).toBe('won')
    expect(renderEnding(last.state)).toMatch(/KẾT THẬT/)
  })

  it('thông điệp gọn: chỉ số thứ tự, không lặp lại văn bản của card', () => {
    const { state } = freshRun()
    const description = state.winSteps[0]!.description
    const result = completeWinStep(state, 1, NOW)
    expect(result.text).not.toContain(description)
    expect(result.text).toContain('1/3')
  })

  it('không đánh dấu lại bước đã xong, không nhận bước không tồn tại', () => {
    let { state } = freshRun()
    state = completeWinStep(state, 1, NOW).state
    expect(completeWinStep(state, 1, NOW).ok).toBe(false)
    expect(completeWinStep(state, 99, NOW).ok).toBe(false)
    // Id tự sinh là slug của mô tả, nên thông điệp lỗi không được in id ra.
    expect(completeWinStep(state, 'buoc-khong-co', NOW).text).not.toContain('buoc-khong-co')
  })

  it('trạng thái kết thúc DÍNH: thắng rồi thì thanh chạm trần cũng không đổi kết quả', () => {
    let { state } = freshRun()
    state = completeWinStep(state, 1, NOW).state
    state = completeWinStep(state, 2, NOW).state
    state = completeWinStep(state, 3, NOW).state
    expect(state.status).toBe('won')
    const after = adjustMeter(state, 'nghi-ngo', 99, 'muộn', NOW)
    expect(after.state.status).toBe('won')
    expect(after.ok).toBe(false)
  })

  it('tiến độ tính trên số bước đã xong', () => {
    let { state } = freshRun()
    expect(progressOf(state)).toBe(0)
    state = completeWinStep(state, 1, NOW).state
    expect(stepsDone(state)).toBe(1)
    expect(progressOf(state)).toBe(33)
  })

  it('evaluateStatus trả lý do rõ ràng', () => {
    const { state } = freshRun()
    expect(evaluateStatus(state)).toEqual({ status: 'active', reason: 'đang chơi' })
  })
})

describe('lượt và nhịp biến cố', () => {
  it('recordTurn tăng lượt và ghi history', () => {
    const { state } = freshRun()
    const next = recordTurn(state, 'mở cửa', 'cửa kẹt', NOW)
    expect(next.turn).toBe(1)
    expect(next.history).toHaveLength(1)
    expect(next.history[0]?.action).toBe('mở cửa')
  })

  it('history bị chặn trần để file trạng thái không phình vô hạn', () => {
    let { state } = freshRun()
    for (let i = 0; i < 250; i++) state = recordTurn(state, `hành động ${i}`, '', NOW)
    expect(state.history.length).toBeLessThanOrEqual(200)
    expect(state.turn).toBe(250)
  })

  it('ván kết thúc thì không mở lượt mới', () => {
    let { state } = freshRun()
    state = applyOocStrike(state, 'a', NOW).state
    state = applyOocStrike(state, 'b', NOW).state
    state = applyOocStrike(state, 'c', NOW).state
    expect(state.status).toBe('ejected')
    expect(recordTurn(state, 'tiếp', '', NOW).turn).toBe(0)
  })

  it('biến cố tới hạn đúng chu kỳ của chaos', () => {
    const { state } = freshRun()
    expect(isEventDue(state, 3)).toBe(false)
    let next = state
    for (let i = 0; i < 3; i++) next = recordTurn(next, 'x', '', NOW)
    expect(isEventDue(next, 3)).toBe(true)
    expect(isEventDue(next, 2)).toBe(false)
  })
})

describe('ranh giới hai kênh render', () => {
  it('khung công khai không chứa bí mật bị niêm phong', () => {
    const { scene, state } = freshRun(makeCleanPool())
    const frame = renderPublicFrame(state)
    expect(frame).not.toContain(scene.sceneCore.hiddenTruth)
    expect(frame).toContain('Thanh căng thẳng')
    expect(frame).toContain('Cảnh cáo OOC')
    expect(frame).toContain('bước thắng')
  })

  it('khung GM chứa bí mật, mô tả bước và luật Thiên Đạo', () => {
    const { scene, state } = freshRun(makeCleanPool())
    const gm = renderGmFrame(state, scene)
    expect(gm).toContain(scene.sceneCore.hiddenTruth)
    for (const step of state.winSteps) expect(gm).toContain(step.description)
    expect(gm).toContain('Thiên Đạo')
    expect(gm).toContain('GIỚI HẠN (player_role)')
  })

  it('renderEnding nói đúng loại kết thúc', () => {
    const { scene } = freshRun()
    expect(renderEnding({ ...newRunState(scene, NOW), status: 'active' })).toMatch(/chưa kết thúc/)
    expect(renderEnding({ ...newRunState(scene, NOW), status: 'lost', ending: 'X chạm 5' })).toMatch(/BAD END/)
    expect(renderEnding({ ...newRunState(scene, NOW), status: 'ejected', ending: 'vượt trần' })).toMatch(/trục xuất/)
  })
})

describe('lưu và phục hồi ván', () => {
  it('ghi rồi đọc lại đúng trạng thái', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-run-'))
    const { state } = freshRun()
    let played = recordTurn(state, 'mở cửa', 'gió lạnh', NOW)
    played = adjustMeter(played, 'nghi-ngo', 2, 'bị để ý', NOW).state
    saveRun(ws, played)

    const reloaded = loadRun(ws, played.sceneId) as RunState
    expect(reloaded.turn).toBe(1)
    expect(findMeter(reloaded, 'nghi-ngo')?.value).toBe(3)
    expect(reloaded.winSteps).toHaveLength(3)
  })

  it('liệt kê ván để phục hồi sau gián đoạn', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-run-'))
    const { state } = freshRun()
    saveRun(ws, state)
    expect(listRuns(ws).map(run => run.sceneId)).toEqual([state.sceneId])
  })

  it('ván không tồn tại trả undefined', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-run-'))
    expect(loadRun(ws, 'khong-co')).toBeUndefined()
    expect(listRuns(ws)).toEqual([])
  })
})

// ── Tích hợp: chơi trọn ván trên pool thật ────────────────────────────────

const realLoaded = loadPool(realPoolDir())
const hasRealPool = realLoaded.cards.length > 0
const realSources = realLoaded.packs.map(pack => ({ id: pack.id, title: pack.title, cards: pack.cards }))

describe.skipIf(!hasRealPool)('chơi trọn ván trên pool thật', () => {
  function realScene(): GeneratedScene {
    return generateScene(realLoaded.cards, { seed: 'runtime-that', mode: 'boss_mode', sources: realSources, now: NOW }).scene
  }

  it('ván thật khởi tạo được với thanh căng thẳng và bước thắng suy ra', () => {
    const scene = realScene()
    const state = newRunState(scene, NOW)
    expect(state.meters.length).toBeGreaterThan(0)
    expect(state.winSteps.length).toBeGreaterThan(0)
    expect(state.status).toBe('active')
    // Card thật không khai báo bước nên chỉ có một bước là chính mục tiêu.
    expect(scene.derivation.derived.join(' ')).toMatch(/winSteps/)
  })

  it('đường thua: nghi ngờ chạm trần thì ván kết thúc với bad end', () => {
    const scene = realScene()
    let state = newRunState(scene, NOW)
    const meter = state.meters[0]!
    for (let i = meter.value; i < meter.failAt; i++) {
      state = adjustMeter(state, meter.id, 1, 'lời nói hớ', NOW).state
    }
    expect(state.status).toBe('lost')
    expect(renderEnding(state)).toMatch(/BAD END/)
    expect(renderPublicFrame(state)).toContain('trạng thái lost')
  })

  it('đường thắng: hoàn thành bước thắng duy nhất', () => {
    const scene = realScene()
    let state = newRunState(scene, NOW)
    state = recordTurn(state, 'dọn ba món tỏi', 'hắn ăn hết', NOW)
    const result = completeWinStep(state, 1, NOW)
    expect(result.finished).toBe(true)
    expect(result.state.status).toBe('won')
  })

  it('đường bị trục xuất: phá khung đủ trần', () => {
    const scene = realScene()
    let state = newRunState(scene, NOW)
    while (state.status === 'active') state = applyOocStrike(state, 'tự định nghĩa nhân vật chính', NOW).state
    expect(state.status).toBe('ejected')
    expect(state.ending).toMatch(/cảnh cáo OOC/)
  })

  it('khung công khai của ván thật không rò rỉ sự thật bị niêm phong', () => {
    const scene = realScene()
    const state = newRunState(scene, NOW)
    expect(renderPublicFrame(state)).not.toContain(scene.sceneCore.hiddenTruth)
    expect(renderGmFrame(state, scene)).toContain(scene.sceneCore.hiddenTruth)
  })
})
