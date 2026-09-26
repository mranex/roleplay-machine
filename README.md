# Roleplay Machine

Công cụ roleplay nông cho [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): bạn bị thả vào
một thế giới xa lạ, biết mình là ai và phải làm gì, nhưng **không biết sự thật đang bị niêm phong** — và cái
kết do máy trạng thái quyết, không do model.

Ý tưởng cốt lõi lấy từ *Penn Zero: Part-Time Hero* — bạn tỉnh dậy trong một thế giới bạn không chọn, có một
giọng nói đều đều hướng dẫn vài câu, rồi mặc bạn tự xoay.

> **Chỉ muốn chơi?** Đọc [**Hướng dẫn sử dụng**](docs/huong-dan-su-dung.md) — viết cho người chơi, không cần
> biết gì về kỹ thuật. File bạn đang đọc là tài liệu dự án, nửa dưới dành cho người bảo trì.

---

# Phần 1 — Dùng

## Trong 60 giây

**1.** Copy thư viện card vào thư mục bạn sẽ chơi:

```powershell
New-Item -ItemType Directory -Force C:\Games\rp-sandbox\roleplay-machine | Out-Null
Copy-Item C:\Games\roleplay-machine\pool-v2 C:\Games\rp-sandbox\roleplay-machine\pool -Recurse -Force
```

**2.** Mở DSH **ngay tại thư mục đó** (`cd C:\Games\rp-sandbox` rồi mới khởi động). Cài đặt lần đầu nằm ở
[docs/install.md](docs/install.md).

**3.** Nói đúng ý này:

> **Chơi Roleplay Machine. Mode "Tôi là siêu anh hùng".**

Trợ lý rút ra một thế giới, cho bạn biết **bạn là ai** và **mục tiêu là gì**, rồi kể cảnh mở màn. Có một
thứ nó biết mà bạn không — và bạn phải tự đoán ra. Đó là toàn bộ trò chơi.

## Bạn nói gì để làm gì

Bạn **không gõ lệnh** — bạn nói chuyện. Trợ lý tự lo phần kỹ thuật.

| Bạn muốn | Nói gì |
|---|---|
| Mở ván | "Chơi Roleplay Machine. Mode ..." |
| Xem mình đang ở đâu | "Trạng thái ván thế nào?" |
| Chơi tiếp ván cũ | "Chơi tiếp ván cũ." |
| Bí quá | "Tao bí rồi." (được mở một cánh cửa, giá là một thanh căng thẳng tăng) |
| Cho NPC có đầu thật | "Bật chế độ nhiều nhân vật." |
| Lấy lịch sử ra file | "Xuất lịch sử ván này ra file." |
| **Biến ván thành truyện ngắn** | "Viết lại ván này thành truyện ngắn, góc nhìn của tao, khoảng 1000 chữ." |
| Viết bản có spoil | "Viết bản toàn tri — tao muốn biết hết." |
| So sánh nhiều góc nhìn | "Viết cả ba góc nhìn để tao so sánh." |
| Xem kho card | "Thư viện có gì?" / mở bảng bên phải |

Chi tiết, câu mẫu, và những câu dặn thêm: [docs/huong-dan-su-dung.md](docs/huong-dan-su-dung.md).

## Ba mode

| Bạn nói | Nghĩa là | Chọn card? |
|---|---|---|
| "Mode **Tôi là người bình thường**" (`coward`) | Bạn tự chọn cả 8 mảnh của thế giới | Chọn hết |
| "Mode **Tôi có hơi bất thường**" (`semi_coward`) | Bạn chọn tối đa 3 mảnh, còn lại máy rút | Chọn tối đa 3 |
| "Mode **Tôi là siêu anh hùng**" (`boss_mode`) | Không chọn gì. Thế giới tự chuyển động | Không |

## Card là gì

Tám loại, mỗi card có `chaos` 1–5 và **năm mảnh văn bản**. Một scene lấy đúng một card mỗi loại.

| Loại | Vai trò |
|---|---|
| `world` | luật của thế giới |
| `player_role` | người chơi bắt buộc là ai |
| `npc` | nhân vật trung tâm |
| `opening` | cảnh mở màn |
| `pressure` | thanh căng thẳng và cách nó siết |
| `goal` | mục tiêu của ván |
| `hidden_truth` | sự thật bị niêm phong (luôn chỉ GM thấy) |
| `chaos` | luật hỗn loạn áp lên cả ván |

Năm mảnh: `prompt` (công khai) · `firstMessage` (chỉ card `opening`) · `hiddenTruth` (chỉ GM) · `heavenRule`
(luật phán xử riêng) · `contentBoundary` (lệnh cấm cứng chống trôi card). Trần cứng: prompt 1000, heavenRule
500, contentBoundary 1000, hiddenTruth 1000 ký tự.

**Chaos scale** = **tổng** `chaos` của 8 slot, 5 tầng: `grounded` ≤12 · `strange` ≤18 · `unstable` ≤25 ·
`chaotic` ≤32 · `reality_breaking` >32. Từ tầng `chaotic` trở lên, Thiên Đạo được phép bẻ cong luật thế
giới; tầng cuối cho NPC nói dối về chính luật đó.

## Bảng điều khiển trong DSH Web

Plugin mở một mục **Roleplay Machine** ở sidebar phải, ba màn: **Thư viện** (lọc theo loại/tag, badge chaos;
card niệm phong chỉ hiện tiêu đề cho tới khi bấm "Hiện nội dung" — có cảnh báo spoil) · **Rút bài** (3 mode
+ seed, xem trước nguồn/chaos/thanh căng thẳng/briefing công khai) · **Sửa card** (form đủ 8 loại + 5 mảnh,
đếm ký tự theo trần cứng).

Bảng dùng để *rút bài và soi kho card*. Phần *chơi* nằm trong hội thoại, vì luật Thiên Đạo đi qua kênh
systemPrompt. Bảng không bao giờ hiện `hiddenTruth` của ván đang chơi.

## Multi-Actor-Agent Mode

Bật bằng "**Bật chế độ nhiều nhân vật**". Bình thường một model đóng tất cả nhân vật — tức là chỉ có **một
cái đầu**, và cái đầu đó biết mọi thứ. Ở mode này, mỗi NPC là **một subagent DSH `spawn` độc lập**, chỉ
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

Hệ quả với người chơi: NPC **được phép hiểu sai** (quản gia tin bạn lấy hành trong khi túi bạn là tỏi — và
nó giữ nguyên niềm tin đó), và bạn **không thấy hết** chuyện xảy ra. Cả hai đều là thiết kế, không phải lỗi.
Mỗi lượt tốn nhiều token hơn: trần mặc định 4 nhân vật được đánh thức, nhân vật không liên quan tốn 0.

Diễn biến riêng của từng actor đi qua **kênh kín** trong systemPrompt — cùng đường với `hiddenTruth` — chứ
không bao giờ đi qua kết quả tool, vì kết quả tool là thứ người chơi đọc được.

Kiến trúc, năm quyết định spec không nói rõ, và ánh xạ 8 acceptance test của spec §28:
[docs/multi-actor.md](docs/multi-actor.md).

## Story — biến ván thành truyện ngắn

Ván chơi là một simulation có trạng thái thật nằm ngoài model. Truyện ngắn là bản văn học biên soạn từ bản
ghi của simulation đó — **không phải kể lại lượt chat**.

Điểm khác biệt không nằm ở "viết hay hơn", mà ở chỗ **ba góc nhìn là ba tập dữ liệu khác nhau, và code cắt
tập dữ liệu**:

| Góc nhìn | Nhận gì | Không bao giờ nhận |
|---|---|---|
| **POV1 — người chơi** | vai, mục tiêu, mở màn, những gì họ tri giác được, lời kể cũ | sự thật bị niêm phong, nội tâm ai khác, ý định riêng tư |
| **POV3 — một NPC** | kiến thức của chính nó, ký ức, niềm tin (có thể **sai**), kế hoạch riêng | bí mật ván, nội tâm người khác, lời kể của Thiên Đạo |
| **POV2 — Thiên Đạo** | tất cả: canon, sealed, các con số, ý định chưa thành sự thật | — |
| **Toàn tri** | như POV2, cộng bản đồ ai biết gì để dùng dramatic irony | — |

"POV1 không spoil" không phải một lời dặn trong prompt: **đoạn chứa `hiddenTruth` không được nhét vào
prompt của nó**, và `assertPovSafe` soi lại bản văn trước khi ghi ra đĩa — truyện rò rỉ thì không bao giờ
được lưu.

Writer là **subagent `spawn` với context sạch**: `toolFilter: { allow: [] }`, không kế thừa ngữ cảnh phiên,
chỉ nhận hồ sơ đã cắt. Nó không đọc được file, không gọi được tool nào.

Tham số: `view` (`player`/`npc`/`kami`/`omniscient`) × `length` (short ~700 từ · medium ~1800 · long ~4000) ×
`style` (plain/sparse/lyrical/noir) × `omit` (`player_fumbles`, `ooc`, `mechanics`, `minor_turns`, hoặc câu tự
do) × `focus` tự do. `allViews: true` viết song song POV1 + POV2 + POV3 từng actor — cùng một sự thật, ba bản
văn khác nhau.

Hồ sơ lưu trữ và thư viện truyện nằm trong `runs/<tên ván>/export/` và `runs/<tên ván>/stories/`.
Thiết kế đầy đủ, bản đồ dramatic irony, và các giới hạn: [docs/story.md](docs/story.md).

## Ván của bạn nằm ở đâu

```
<chỗ bạn mở DSH>\roleplay-machine\
    pool\              kho card (mỗi card một file) + pool\packs\ (bộ 8 card)
    scenes\            thế giới đã rút ra
    runs\<tên ván>\
        state.json       trạng thái ván: lượt, thanh căng thẳng, bước thắng
        actors.json      trí nhớ và niềm tin riêng của từng nhân vật
        transcript.jsonl lịch sử từng lượt
        ending.md        đoạn kết, sau khi chốt ván
        export\          hồ sơ xuất ra (story.md, story.json, material-*.md)
        stories\         truyện ngắn theo từng góc nhìn
```

Ván nằm trên máy bạn, **không** nằm trong lịch sử chat. Đóng trình duyệt rồi mở lại vẫn chơi tiếp được.

---

# Phần 2 — Dành cho người phát triển

## Vấn đề nó giải quyết

| Nền tảng card cũ | Roleplay Machine |
|---|---|
| Card là lorebook, mỗi lượt nhồi cả đống thế giới quan | Card là **chỉ thị hành vi**, có trần cứng từng mảnh; mỗi lượt chỉ nạp card đang hoạt động |
| Người chơi tự viết card ⇒ đã biết trước cái kết | Thư viện rút ngẫu nhiên có seed; `hidden_truth` là card riêng, và cảnh mạch lạc vì ưu tiên rút trọn một pack |
| Xúc xắc là cảm hứng của model | Chaos scale, nhịp biến cố, thanh căng thẳng, bước thắng đều do code quyết |
| Không có cái kết thật | Máy trạng thái đếm bằng code: đủ bước thắng ⇒ kết thật, thanh chạm trần ⇒ thua, đủ cảnh cáo ⇒ bị trục xuất |
| Vi phạm OOC và nguy hiểm trong truyện trộn vào một counter | Hai trục tách hẳn: `oocStrikes` và nhiều `tensionMeters` |

## Bộ tool (18)

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
| `rp_log` | nộp lời kể vừa viết + hệ quả thật của lượt vào transcript |
| `rp_export` | xuất cả ván thành hồ sơ lưu trữ có nhãn, và nguyên liệu cắt sẵn theo từng góc nhìn |
| `rp_write` | viết lại ván thành truyện ngắn theo một góc nhìn, bằng subagent có context sạch |

## Cài đặt & kiểm chứng

```powershell
pnpm install
pnpm build         # 5 bundle esbuild
pnpm import:rsm    # nạp thư viện card từ app Python cũ vào pool-v2 (một lần)

pnpm verify        # test + typecheck + build + smoke trên artifact đã build
pnpm test          # 376 test
pnpm smoke         # nạp lib/index.js trong tiến trình Node sạch, chơi trọn một ván
pnpm demo:scene    # sinh scene từ thư viện thật ở cả 3 mode
pnpm demo:runtime  # chơi scripted 3 đường: thắng / thua / bị trục xuất
```

Cài plugin vào một DSH profile: [docs/install.md](docs/install.md) — kèm bảng xử lý sự cố và nhật ký kiểm
chứng trên DSH thật (6 đợt).

`pnpm build` tự chép `docs/*.md` vào `packages/rp-machine/docs/` để tài liệu đi theo gói cài (không chép thì
README trong gói đã cài trỏ tới file không tồn tại). **Sửa tài liệu ở `docs/` tại gốc repo**, đừng sửa bản
trong package — nó bị ghi đè mỗi lần build.

Cấu trúc:

```
packages/rp-machine/src/
  card-schema.ts  schema rsm-card-v1: 8 loại, 5 fragments, visibility, weight, compatibility
  compatibility.ts đồ thị tương thích có chấm điểm (cặp + mức cảnh)
  scene.ts        engine sinh scene tất định: coherence, 4 chế độ sampling, chaos = tổng,
                  vật chất hoá mechanics / playerContract / kamiSama.rules
  runtime.ts      trạng thái ván: hai trục tách biệt, trạng thái kết thúc dính, hai kênh render
  tools-scene.ts  18 tool cho DSH
  web-api.ts      API host cho UI (POST /rp-machine/api/<method>, header x-rp-request)
  prompt.ts       kênh bí mật qua systemPrompt (chỉ agent cấp cao nhất)
  rng.ts          RNG có seed
  index.ts        điểm vào plugin
  actor/          Multi-Actor-Agent Mode: model, perception router, hạt nhân cô lập (payload),
                  wake rules, event vocabulary, Resolver, phát chọn lọc, adapter subagent,
                  pipeline một lượt, khai báo dàn actor
  story/          transcript JSONL, export có nhãn + cắt theo POV, bản đồ irony,
                  guard chống rò rỉ theo góc nhìn, writer brief + adapter
  client/         UI web: thư viện card, màn rút bài, editor card (React, tab sidebar phải)
packages/rp-machine/skills/   rp-game-master, rp-create-card, rp-writer
packages/rp-machine/tests/    376 test
```

## Giới hạn đã biết

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
- **Truyện viết từ bộ xương nếu ván chơi trước khi có `rp_log`.** Sim không mô hình hoá mùi vị, ánh sáng,
  nhịp thở; phần đó chỉ lời kể của Thiên Đạo mới có. Thiếu nó thì writer vẫn viết được, nhưng phải tự tô,
  và những gì nó tô được liệt kê ở cuối tệp truyện.
- **Ván dưới ~5 lượt cho truyện rất mỏng,** và mỗi góc nhìn là một model call. `allViews` trên cast đông
  là cách nhanh nhất để đốt token.

## Tài liệu khác

| File | Cho ai |
|---|---|
| [docs/huong-dan-su-dung.md](docs/huong-dan-su-dung.md) | **Người chơi.** Không kỹ thuật |
| [docs/install.md](docs/install.md) | Người cài đặt. Cài profile, xử lý sự cố, nhật ký kiểm chứng |
| [docs/multi-actor.md](docs/multi-actor.md) | Kiến trúc Multi-Actor-Agent Mode |
| [docs/story.md](docs/story.md) | Kiến trúc Story: export, góc nhìn, guard |
| [docs/upgrade-plan.md](docs/upgrade-plan.md) | Kế hoạch nâng cấp và phát hiện trên dữ liệu thật |
| [docs/design.md](docs/design.md) | Lý do thiết kế ban đầu. **Thuật ngữ còn từ bản MVP đầu** (`directive`, "6 card") — đọc như lịch sử, không phải tài liệu hiện hành |

## Giấy phép

MIT.
