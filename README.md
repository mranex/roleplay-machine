# Roleplay Machine

Công cụ roleplay nông cho [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): người chơi bị thả vào
một thế giới xa lạ, biết mình là ai và phải làm gì, nhưng **không biết sự thật đang bị niêm phong** — và cái kết do
máy trạng thái quyết, không do model.

Ý tưởng cốt lõi lấy từ *Penn Zero: Part-Time Hero* — bạn tỉnh dậy trong một thế giới bạn không chọn, có một giọng
nói đều đều hướng dẫn vài câu, rồi mặc bạn tự xoay.

## Vấn Đề Nó Giải Quyết

| Nền tảng card cũ | Roleplay Machine |
|---|---|
| Card là lorebook, mỗi lượt nhồi cả đống thế giới quan | Card là **chỉ thị hành vi**, có trần cứng từng mảnh; mỗi lượt chỉ nạp card đang hoạt động |
| Người chơi tự viết card ⇒ đã biết trước cái kết | Thư viện rút ngẫu nhiên có seed; `hidden_truth` là card riêng, và cảnh mạch lạc vì ưu tiên rút trọn một pack |
| Xúc xắc là cảm hứng của model | Chaos scale, nhịp biến cố, thanh căng thẳng, bước thắng đều do code quyết |
| Không có cái kết thật | Máy trạng thái đếm bằng code: đủ bước thắng ⇒ kết thật, thanh chạm trần ⇒ thua, đủ cảnh cáo ⇒ bị trục xuất |
| Vi phạm OOC và nguy hiểm trong truyện trộn vào một counter | Hai trục tách hẳn: `oocStrikes` và nhiều `tensionMeters` |

## Cài Đặt

```powershell
pnpm install
pnpm build
pnpm import:rsm    # nạp thư viện card từ app Python cũ vào pool-v2 (một lần)
```

Rồi cài vào một DSH profile — xem [docs/install.md](docs/install.md).

## Chơi Một Ván

Thư viện card nằm trong workspace, mỗi card một file theo loại:

```
<workspace>/roleplay-machine/pool/<type>/<id>.json
<workspace>/roleplay-machine/pool/packs/*.json     ← bộ 8 card = một thế giới hoàn chỉnh
```

Copy [`pool-v2/`](pool-v2) (25 card + 6 pack đã import từ app Python cũ) vào workspace rồi chơi.

Trạng thái ván nằm ở `<workspace>/roleplay-machine/runs/<sceneId>/state.json` — **không** nằm trong lịch sử chat.
Đóng trình duyệt, mở lại, gọi `rp_state` là chơi tiếp được.

Ba mode:

| Mode | Ai chọn card |
|---|---|
| `coward` — "Tôi là người bình thường" | bạn chọn cả 8 slot |
| `semi_coward` — "Tôi có hơi bất thường" | bạn chọn tối đa 3, còn lại máy rút |
| `boss_mode` — "Tôi là siêu anh hùng" | không chọn gì, để thế giới tự chuyển động |

## Card Là Gì

Tám loại, mỗi card có `chaos` 1–5 và **năm mảnh văn bản**. Một scene lấy đúng một card mỗi loại.

| Loại | Vai trò |
|---|---|
| `world` | luật của thế giới |
| `player_role` | người chơi bắt buộc là ai |
| `npc` | nhân vật trung tâm |
| `opening` | cảnh mở màn |
| `pressure` | thanh căng thẳng và cách nó siết |
| `goal` | mục tiêu của ván |
| `hidden_truth` | sự thật bị niêm phong (luôn `gm_only`) |
| `chaos` | luật hỗn loạn áp lên cả ván |

Năm mảnh: `prompt` (công khai) · `firstMessage` (chỉ card `opening`) · `hiddenTruth` (chỉ GM) · `heavenRule` (luật
phán xử riêng) · `contentBoundary` (lệnh cấm cứng chống trôi card). Trần cứng: prompt 1000, heavenRule 500,
contentBoundary 1000, hiddenTruth 1000 ký tự.

**Chaos scale** = **tổng** `chaos` của 8 slot, thang 5 tầng: `grounded` ≤12 · `strange` ≤18 · `unstable` ≤25 ·
`chaotic` ≤32 · `reality_breaking` >32. Từ tầng `chaotic` trở lên, Thiên Đạo được phép bẻ cong luật thế giới;
tầng cuối cho NPC nói dối về chính luật đó.

## Tool

| Tool | Việc |
|---|---|
| `rp_pool_status` | tình trạng thư viện, pack, scene, ván |
| `rp_list_cards` / `rp_add_card` / `rp_delete_card` | xem, tạo, xoá card |
| `rp_new_scene` | sinh scene theo mode, khởi tạo ván, trả briefing công khai |
| `rp_state` | khung trạng thái công khai, dùng để phục hồi |
| `rp_turn` | mở lượt, nhận tín hiệu OOC/"bí", báo biến cố tới hạn |
| `rp_step` | đánh dấu một bước thắng đã xong |
| `rp_meter` | đổi một thanh căng thẳng (nguy hiểm trong truyện) |
| `rp_strike` | cảnh cáo OOC (đủ trần ⇒ trục xuất) |
| `rp_grace` | Thiên Đạo ban ơn khi người chơi bí (giá: một thanh +1) |
| `rp_end` | chốt ván, ghi epilogue |
| `rp_actor_cast` | khai dàn actor cho Multi-Actor-Agent Mode (mỗi NPC một agent riêng) |
| `rp_actor_turn` | một lượt ở actor mode: NPC tự quyết, Resolver chốt canon, phát chọn lọc |
| `rp_actor_state` | ai đang ở đâu, ai đã từng được đánh thức (phần công khai) |

## Multi-Actor-Agent Mode

Mỗi NPC là **một subagent DSH `spawn` độc lập** — không phải một dòng trong prompt của quản trò. Nó chỉ
nhận đúng hồ sơ của mình: danh tính, `allowedKnowledge`, ký ức riêng, niềm tin riêng, và những gì nó vừa
tri giác được. Không có đường code nào đưa trạng thái thế giới vào payload của nó.

Cô lập thông tin đến từ kiến trúc, không từ lời dặn:

| Cơ chế | Chặn được gì |
|---|---|
| `spawn` (không bao giờ `fork`) | `fork` chép hội thoại cha vào con ⇒ actor đọc được cả bí mật |
| `toolFilter: { allow: [] }` | Actor không đọc được file, không đọc được pool card |
| `outputSchema` riêng + `assertIsolated` | Prompt lọt chuỗi cấm thì **ném lỗi trước khi gọi model** |
| Kênh GM chỉ gắn cho agent cấp cao nhất | Subagent không bao giờ nhận `hiddenTruth` |
| `validateEvent` trong Resolver | Ý định không tự thành sự thật; không bịa trait, không nhảy phòng, không xuyên cửa niêm phong |
| Phát chọn lọc theo tri giác | Không ai biết điều nó không quan sát được; narrator chỉ thấy event người chơi thấy |

Diễn biến riêng của từng actor (nó hiểu gì, muốn gì, tin gì) đi qua **kênh kín** trong systemPrompt — cùng
đường với `hiddenTruth` — chứ không bao giờ đi qua kết quả tool, vì kết quả tool là thứ người chơi đọc được.

Chi tiết kiến trúc, năm quyết định spec không nói rõ, và ánh xạ 8 acceptance test của spec §28:
[docs/multi-actor.md](docs/multi-actor.md).

## Phát Triển

```powershell
pnpm verify        # test + typecheck + build + smoke trên artifact đã build
pnpm test          # 335 test
pnpm smoke         # nạp lib/index.js trong tiến trình Node sạch, chơi trọn một ván
pnpm import:rsm    # nạp thư viện card của app Python cũ vào pool-v2
pnpm demo:scene    # sinh scene từ thư viện thật ở cả 3 mode
pnpm demo:runtime  # chơi scripted 3 đường: thắng / thua / bị trục xuất
```

Cấu trúc:

```
packages/rp-machine/src/
  card-schema.ts  schema rsm-card-v1: 8 loại, 5 fragments, visibility, weight, compatibility
  compatibility.ts đồ thị tương thích có chấm điểm (cặp + mức cảnh)
  scene.ts        engine sinh scene tất định: coherence, 4 chế độ sampling, chaos = tổng,
                  vật chất hoá mechanics / playerContract / kamiSama.rules
  runtime.ts      trạng thái ván: hai trục tách biệt, trạng thái kết thúc dính, hai kênh render
  tools-scene.ts  15 tool cho DSH
  web-api.ts      API host cho UI (POST /rp-machine/api/<method>, header x-rp-request)
  prompt.ts       kênh bí mật qua systemPrompt (chỉ agent cấp cao nhất)
  rng.ts          RNG có seed
  index.ts        điểm vào plugin
  actor/          Multi-Actor-Agent Mode: model, perception router, hạt nhân cô lập (payload),
                  wake rules, event vocabulary, Resolver, phát chọn lọc, adapter subagent,
                  pipeline một lượt, khai báo dàn actor
  client/         UI web: thư viện card, màn rút bài, editor card (React, tab sidebar phải)
packages/rp-machine/skills/   rp-game-master, rp-create-card
packages/rp-machine/tests/    335 test
```

## Giao Diện Trong DSH Web

Plugin mở một tab **Roleplay Machine** ở sidebar phải, ba màn: **Thư viện** (lọc, badge chaos, card bị
niệm phong chỉ hiện tiêu đề cho tới khi bấm "Hiện nội dung (có spoil)"), **Rút bài** (3 mode + seed, hiện
nguồn/chaos/thanh căng thẳng/briefing công khai) và **Sửa card** (form đủ 8 loại + 5 mảnh, đếm ký tự theo
trần cứng).

UI để *rút bài và soi thư viện*; phần *chơi* vẫn do trợ lý trong hội thoại đảm nhiệm, vì luật Thiên Đạo
nằm ở kênh systemPrompt. UI không bao giờ hiện `hiddenTruth` của ván đang chơi.

Trạng thái nâng cấp và các phát hiện trên dữ liệu thật: [docs/upgrade-plan.md](docs/upgrade-plan.md).

## Giới Hạn Đã Biết

- **Trust mode.** `hiddenTruth` được inject vào systemPrompt qua kênh GM, không bao giờ đi qua output của tool —
  nhưng nó vẫn nằm trong session log. Người chơi tò mò mở trajectory là thấy. Sealed mode là nâng cấp sau; điểm
  cắt đã sẵn trong `prompt.ts`.
- **UI đã render-kiểm trong DOM ảo, chưa nhìn bằng mắt.** Test mount panel thật trong `happy-dom`: hiện đủ
  ba tab, nạp thư viện qua `fetch`, che nội dung card niệm phong, chuyển màn, và luồng rút bài gọi API rồi
  hiện briefing. Bố cục và màu sắc thật vẫn cần một lần mở trình duyệt.
- **Card thật chưa khai báo `mechanics` có cấu trúc.** 25 card import từ app cũ không có `winSteps`/`meters`, nên
  tầng scene suy ra một bước thắng và một thanh căng thẳng. Muốn câu đố nhiều bước thì card `goal`/`pressure` phải
  khai báo — đó là việc của phase nội dung.
- **Chi phí token mỗi lượt.** Kênh GM chở luật Thiên Đạo của cả 8 card (~600–900 token). Cắt được nếu cần, nhưng
  đó chính là thứ giữ cho card không trôi.
- **Actor mode gọi model song song.** Trần mặc định 4 actor mỗi lượt; actor ngủ tốn 0. Đắt hơn hẳn mode một
  model, và trần `maxAwake` là van chi phí chứ không phải trang trí.
- **Actor mode vẫn là trust mode.** `runs/<sceneId>/actors.json` chứa niềm tin và kế hoạch riêng của **mọi**
  actor. Nó cùng mức nhạy cảm với kênh GM: người chơi tự nguyện không mở. Prompt của actor cũng còn dấu vết
  danh tính/môi trường của host (persona chỉ shadow phần persona) — sửa hẳn thì cần một preset DSH riêng.
- **Dàn actor do Thiên Đạo khai, chưa tự suy từ card.** `rp_actor_cast` nhận `cast` + `locations` thủ công vì
  vị trí và `allowedKnowledge` là quyết định kể chuyện, không phải suy diễn. Tự suy từ card là việc của phase sau.

## Giấy Phép

MIT.
