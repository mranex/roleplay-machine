# Kế Hoạch Nâng Cấp — Gộp RSM vào DSH

## Trạng thái

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **P1** | Tầng card `rsm-card-v1` + importer thư viện Python | ✅ xong — 25 card import sạch |
| **P2** | Tầng scene: sinh scene tất định, chaos = tổng, vật chất hoá mechanics/playerContract | ✅ xong |
| **P3** | Runtime: hai trục tách biệt, nhiều tensionMeters, cổng OOC | ✅ xong |
| **P4** | Nối runtime vào bộ tool DSH, gỡ tầng MVP cũ | ✅ xong — 12 tool mới, đã chạy thật trong DSH |
| **P5** | UI DSH web: thư viện card, editor, màn rút bài | ✅ xong — tab sidebar + API host chạy thật trong DSH web, panel render-kiểm trong DOM ảo |
| **P6** | Nội dung: pool mới theo chuẩn 5 fragments + `mechanics` có cấu trúc | chưa bắt đầu |

Tổng: 246 test, 5 bundle (`index`, `card-schema`, `scene`, `runtime`, `client`), `pnpm verify` xanh.

**Hướng mới (đang làm):** [Multi-Actor-Agent Mode](multi-actor.md) — mỗi nhân vật là một subagent DSH độc
lập, chỉ biết những gì nó được phép biết. M1 (actor model + perception router + hạt nhân cô lập + wake
rules) đã xong với 32 test phủ cả 8 acceptance test của spec, không cần gọi model.
Tầng MVP cũ (`cards.ts`, `draw.ts`, `truth.ts`, `state.ts`, `rules.ts`, `tools.ts`) đã bị xoá ở P4.

## 0. Quyết định đã chốt

| | Chốt |
|---|---|
| Nền | **C — gộp hẳn vào DSH**: thư viện card, editor, màn rút bài đều thành UI trong DSH web client |
| Bí mật | **Như RSM**: `player_role` và `goal` công khai; chỉ `hidden_truth` là `gm_only` |
| Ưu tiên | Cả bốn: 5 fragments · playerContract + tensionMeters · UI · độ khó & tính công bằng |

## 1. Bản cũ thực chất đang chạy được những gì

Audit ba tầng cho một kết quả quan trọng: **RSM có schema rất giàu, nhưng phần lớn schema đó chưa bao giờ được
thi hành.** Cụ thể, đây là những thứ *trông như tính năng* mà thực tế là dữ liệu chết:

| Thứ | Trạng thái thật | Nguồn |
|---|---|---|
| `visibility` (public/hidden/gm_only/locked) | **Không được đọc ở đâu cả** ngoài UI hiển thị và validator | grep toàn `rsm/`; chỉ có ở `card_validator.py:60-63`, `ui_card_tile.py:47` |
| `contentBoundary` của mọi card | Được lưu vào scene, **không bao giờ được biên dịch vào prompt** | `scene_generator.py:152`, `prompt_compiler.py` không đọc |
| `hiddenTruth` của 7 loại card còn lại | Lưu trong `cardFragments`, **không bao giờ phát ra** | `scene_generator.py:143-153` |
| `playerContract.allowedAbilities/Knowledge/Inventory` | **Luôn rỗng** — không có gì đổ vào | `scene_generator.py:172-173` |
| `mechanics.winCondition` / `loseCondition` | **Luôn chuỗi rỗng**; block `# MECHANICS` in ra trống | `scene_generator.py:205-206` + `prompt_compiler.py:219-222` |
| `mechanics.tensionMeters` | Hardcode đúng **một** meter tên `suspicion` | `scene_generator.py:193-208` |
| `kamiSama` | Hardcode: `strictness:5`, 3 rule cố định + heavenRule của card | `scene_generator.py:184-192` |
| Sampling mode "Wild but Valid" | **Không có nhánh nào** — y hệt Balanced Random | `scene_generator.py:324` là chỗ duy nhất nhắc tới |
| Strictness "Soft" | **Tương đương "Chaotic"**; guard `score < -500` không bao giờ chạm (điểm thấp nhất ≈ −140) | `scene_generator.py:355,385`; `compatibility.py:84-86` |
| `maxAttempts` | Gán rồi **không đọc lại** | `scene_generator.py:322` |
| Anti-clumping | Key theo `metadata.sourcePackId`, mà card viết tay chỉ có `metadata.source` ⇒ **vô hiệu** | `scene_generator.py:258,281` vs `card_pack_importer.py:53-54` |
| "Re-import Pack Cards" | Gọi sai chữ ký hàm ⇒ `TypeError` | `ui_pack_manager.py:213` vs `card_pack_importer.py:24` |
| LLM JSON schema cho card/pack | **Không khớp validator**: thiếu `description/compatibility/visibility/fragments/generationHints/qualityNotes/metadata`, bịa thêm `content`; pack thiếu `sharedTags` | `llm_json_schemas.py:1-41` vs `card_validator.py:34-100` |
| `json_repair.py` | Không sửa gì — chỉ trích xuất JSON từ text | `json_repair.py:1-28` |
| API key | Lưu **plaintext**, không có `.gitignore` trong repo | `provider_config.py:231-233`, `secrets.local.json` |

Hệ quả cho kế hoạch: **không port nguyên trạng**. Port *schema* và *ý định*, nhưng thi hành thật những chỗ RSM
chỉ ghi ra giấy. Đây thực ra là cơ hội — phần lớn giá trị nằm ở những field đã có sẵn mà chưa ai dùng.

## 2. Kiến trúc đích

Toàn bộ nằm trong `packages/rp-machine`, chạy trong DSH. Không còn app Python như một runtime thứ hai.

```
pool/                                  ← thư viện card, một file một card (layout của RSM)
  world/*.json  player_role/*.json  npc/*.json  opening/*.json
  pressure/*.json  goal/*.json  hidden_truth/*.json  chaos/*.json
  packs/*.json                         ← rsm-card-set-v1
runs/<runId>/state.json                ← trạng thái ván + scene đã chốt
```

Bốn tầng trong plugin:

1. **Card layer** — schema `rsm-card-v1` (8 loại, 5 fragments, visibility, weight, compatibility graph) +
   validate + nạp/ghi theo thư mục. Đây là nguồn sự thật.
2. **Scene layer** — engine sinh scene tất định: sampling có trọng số, N candidate, strictness, anti-repetition,
   anti-clumping, chaos = **tổng** điểm (không phải trung bình như MVP hiện tại), và **vật chất hoá** các field
   mà RSM để trống: `mechanics.winCondition/loseCondition`, `tensionMeters`, `playerContract.allowed*`.
3. **Runtime layer** — vòng chơi DSH: niêm phong scene, cưỡng chế `playerContract` + `kamiSama.rules` + các
   tensionMeters bằng code, thẻ ẩn chỉ `hidden_truth` là gm_only.
4. **UI layer** — DSH web client (`ctx.slots.register`): thư viện card, editor card, màn rút bài 3 mode với
   theming xanh/amber/đỏ như RSM.

### Bỏ hẳn khi gộp

| Bỏ | Lý do |
|---|---|
| `provider_base/runner/gemini/openai_compatible`, `provider_config`, `ui_provider_settings`, `llm_json_schemas`, `json_repair` | DSH đã có model. 17KB config + 34KB màn settings + 2 provider HTTP trở thành vô nghĩa. Đây là **cắt giảm lớn nhất** — và xoá luôn vấn đề plaintext key. |
| `ui_ai_card_generator` (23KB) | Thay bằng skill + tool của DSH; agent tự sinh card rồi gọi `rp_add_card`. |
| `prompt_preview.py` | Dead code, format cũ. |
| Pack Manager dạng UI | Giữ *dữ liệu* pack; việc bulk (rename tag, normalize, health check) giao cho agent + tool, không dựng 23KB giao diện. |

### Đơn giản hoá nhờ DSH

Thư viện card vẫn cần UI để *xem và sửa*. Nhưng "rename tag trên 200 card", "tìm card sai thư mục",
"tìm id trùng", "chuẩn hoá tag" — đó là việc của agent gọi tool, không phải của một màn hình 23KB.

## 3. Hai điểm schema phải chốt trước khi code

### 3.1 Chaos scale: đổi từ trung bình sang tổng

MVP hiện tại: `chaosScale = round(mean(scale))`. RSM: `total = Σ card.chaos`, ngưỡng
`≤12 grounded → ≤18 strange → ≤25 unstable → ≤32 chaotic → >32 reality_breaking` (`scene_generator.py:59-82`).

Đề bài gốc của mày nói "có điểm tổng các card" — **RSM đúng, MVP của tao sai**. Bản mới dùng tổng, và giữ 5 tầng
nhãn của RSM.

### 3.2 Tách thang OOC khỏi thanh căng thẳng

RSM trộn hai thứ vào một chỗ (`kamiSama.policy = warn_then_terminate` + meter `suspicion`). MVP của tao cũng
trộn. Thiết kế đúng là **hai cơ chế tách biệt**:

| | Là gì | Nguồn | Đầy thì sao |
|---|---|---|---|
| `oocStrikes` | Người chơi phá khung: tự định nghĩa nhân vật, godmoding, nói ngoài truyện, dùng kiến thức ngoài thế giới | `playerContract.forbiddenActions` + `outOfCharacterExamples` + rubric | Bị trục xuất (bad end) |
| `tensionMeters[]` | Nguy hiểm trong truyện: Suspicion, và các meter khác do card `pressure` khai báo | `pressure` card → `mechanics.tensionMeters` | Chạm `failAt` thì thua theo cách của meter đó |

Lý do tách: một câu nói hớ trong vai làm Suspicion tăng là **nội dung**, không phải vi phạm. Gộp hai thứ lại thì
hoặc là phạt oan người chơi nhập vai, hoặc là không bao giờ trục xuất được ai.

### 3.3 Mô hình bí mật mới

```
public      world, npc, opening, pressure, goal, player_role   →  người chơi biết
gm_only     hidden_truth                                        →  chỉ vào prompt GM, không vào tool output
locked      dành cho card chưa mở khoá nội dung
```

Khác MVP hiện tại ở đúng một điểm: **`player_role` và `goal` giờ công khai**. Người chơi biết mình là đầu bếp và
biết mình phải làm ma cà rồng ăn ba món tỏi; họ chỉ không biết các hiệp sĩ đang trốn dưới sàn bếp và tại sao tỏi
lại quan trọng. Đây là điều làm ván chơi công bằng hơn và bớt "khó vô lý" — vấn đề mày gặp ở hero mode.

## 4. Các phase

Bảng trạng thái ở đầu tài liệu là nguồn sự thật. Thứ tự và tiêu chí "xong":

| Phase | Nội dung | Xong khi |
|---|---|---|
| **P1** | Card layer: `rsm-card-v1` trong TS, validate, nạp/ghi pool theo thư mục, importer từ app Python | 25 card + 6 pack nạp được, validate sạch, có test |
| **P2** | Scene layer: engine sinh scene tất định + chaos tổng + vật chất hoá `mechanics`/`playerContract` | Cùng seed + cùng pool ⇒ cùng scene; win/lose không còn rỗng |
| **P3** | Runtime: hai trục tách biệt, trần OOC theo strictness, nhiều tensionMeters | Chơi scripted được cả ba đường: thắng / thua / trục xuất |
| **P4** | Nối runtime vào bộ tool DSH + skills, gỡ tầng MVP cũ | Chơi được trong GUI bằng tool mới; smoke + test chống rò rỉ vẫn xanh |
| **P5** | UI: thư viện card → editor → màn rút bài 3 mode | Rút và chơi được từ GUI, không cần gõ lệnh |
| **P6** | Nội dung: pool mới theo chuẩn 5 fragments | Pool đủ rộng, và card khai báo `mechanics` có cấu trúc |

P1 làm trước vì mọi phase sau đều đọc/ghi theo schema này, và nó không phá gì: pool cũ (43 card) được nạp qua
đường tương thích, chuyển dần.

## 4b. P3 — vì sao hai trục phải tách

Đây là quyết định thiết kế trung tâm của runtime, và cả hai bản trước đều làm sai:

| | RSM (Python) | MVP trước | Bây giờ |
|---|---|---|---|
| Phá khung | `kamiSama.policy = warn_then_terminate` (2 mức, cứng) | 3 cảnh cáo cố định | `oocStrikes` với trần suy từ `kamiSama.strictness`: strict 2, soft 3, chaotic 4 |
| Nguy hiểm trong truyện | Một thanh `suspicion` hardcode | Một counter `suspicion` | Nhiều `tensionMeters` do card `pressure` khai báo, mỗi thanh có `failAt` riêng |
| Quan hệ giữa hai trục | Trộn một phần | Trộn hoàn toàn (một counter gánh cả hai) | **Tách hẳn** |

Gộp lại thì hoặc là phạt oan người nhập vai (nói hớ trong vai bị tính là vi phạm), hoặc là không bao giờ trục
xuất được ai (mọi thứ đều thành "nghi ngờ"). Demo `pnpm demo:runtime` chứng minh hai trục chạy độc lập: ván bị
trục xuất giữ thanh căng thẳng nguyên vẹn ở 1/5, và ván thua vì thanh chạm trần giữ 0 cảnh cáo OOC.

Hai chi tiết nữa đáng ghi:
- **Trạng thái kết thúc dính.** Thắng rồi thì một thanh chạm trần không thể đổi kết quả. Bản cũ không có khái
  niệm này vì nó không có máy trạng thái nào cả.
- **Ván tự chứa phần cưỡng chế.** Nhãn thanh, trần, lời cảnh cáo được sao vào trạng thái ván, nên
  `state.json` sống độc lập với file scene; chỉ phần render kênh GM mới cần đọc lại scene.

## 4c. P4 — cái gì đã thay và cái gì đã bị xoá

Bộ tool cũ mô phỏng lại mọi thứ bằng tay: `rp_new_run` rút card theo bảy loại, `rp_seal_truth` niêm phong một
"thẻ ẩn" do model tự nghĩ, `rp_suspicion` là một counter duy nhất. Bộ mới lấy tất cả từ thư viện card:

| Cũ | Mới | Vì sao |
|---|---|---|
| `rp_new_run` + `rp_seal_truth` | `rp_new_scene` | Bí mật là card `hidden_truth` trong thư viện, không phải thứ model tự nghĩ ra rồi tự niêm phong |
| `rp_state` | `rp_state` | Giữ tên, đọc từ runtime thay vì state cũ |
| `rp_turn` | `rp_turn` | Giữ tên, thêm nhịp biến cố theo chaos và tín hiệu "bí" |
| `rp_suspicion` | `rp_meter` | Nhiều thanh do card khai báo, mỗi thanh có `failAt` riêng |
| `rp_step` | `rp_step` | Giữ tên, đếm trên `mechanics.winSteps` có cấu trúc |
| `rp_strike` | `rp_strike` | Giữ tên, trần suy từ `kamiSama.strictness` thay vì cố định 3 |
| `rp_grace` | `rp_grace` | Giá là "+1 trên một thanh căng thẳng", không còn deck biến cố |
| `rp_open_seed` | (bỏ) | Không còn "seed thẻ ẩn" — bí mật đến từ thư viện |
| — | `rp_delete_card` | Thư viện cần xoá được |

Đã xoá hẳn sáu module của tầng MVP cũ cùng tám file spec của chúng. Tổng số test giảm từ 243 xuống 186 vì
phần lớn test cũ kiểm mô hình card 7 loại không còn tồn tại.

### Một cái bẫy khi cài lại plugin

`dsh plugin --profile X remove <pkg>` rồi `add` lại **không** khôi phục entry trong profile: lần `add` thứ hai
báo "Already up to date" và bỏ qua bước ghi patch. Kết quả: gói đã cài trong `node_modules` nhưng
`dsh --profile X --dump-config` không có plugin, và model không thấy tool nào. Cách khắc phục: chạm vào
`<DSH_HOME>/profiles/X/cordis.patch.yml` (ghi lại nội dung) để DSH soạn lại cây cấu hình. Sau đó plugin xuất
hiện đúng **một lần** qua `dsh.bundle.patch` của chính gói — không cần thêm entry thủ công, và thêm thủ công
sẽ gây trùng.

## 4d. P5 — ba cái bẫy khi nối UI vào DSH

Ba lỗi dưới đây đều **không báo lỗi**: boot vẫn in URL, không exception, không log. Tìm ra chúng mất khá
nhiều thời gian, nên ghi lại:

| Triệu chứng | Nguyên nhân thật | Cách sửa |
|---|---|---|
| `apply` không chạy chút nào | `dsh plugin add` sau một lần `remove` báo "Already up to date" và bỏ qua bước ghi cấu hình; gói có trong `node_modules` nhưng không nằm trong `dsh.profile.bundles` | Thêm tên gói vào `dsh.profile.bundles` trong `package.json` của profile |
| Boot chạy, `apply` chạy trọn vẹn, nhưng tool không có và tab UI không hiện | Đã khai trong `bundles` **và** chèn thêm vào `cordis.patch.yml` → trùng id → boot bỏ qua plugin trong im lặng | Để `cordis.patch.yml` là `[]`; bundle layer tự chèn dòng của nó |
| API luôn trả 405 dù plugin đã nạp | Route khai `path: '/rp-machine/api/'`. DSH khớp prefix theo `path + '/'` nên thành `/rp-machine/api//` và không bao giờ khớp | Bỏ `/` cuối, dùng `/rp-machine/api` (đúng hình dạng plugin cùng họ dùng) |

Cộng thêm một lỗi thứ tư, cũng im lặng: `package.json` **thiếu `exports["./client"]`**. Không có nó thì
`lib/client.js` có trong tarball nhưng module client không bao giờ vào boot graph của trang web — tab
sidebar đơn giản là không tồn tại. Cách kiểm: tìm chuỗi `dsh-roleplay-machine` trong HTML mà DSH phục vụ;
nếu không thấy thì module chưa được nạp.

Công cụ để lần sau không phải đoán: biến môi trường `RP_APPLY_LOG` ghi lại từng mốc trong `apply`
(`apply:start → skills → workspace → tools → agents → web-api:registered → apply:end`). File trống nghĩa là
plugin chưa được nạp; dừng giữa đường nghĩa là bước cuối là bước hỏng.

## 5. Rủi ro

- **Phá vỡ MVP đang chạy.** Giảm thiểu: loader nhận cả schema cũ và mới, chuẩn hoá về một kiểu `Card` nội bộ;
  pool 43 card cũ vẫn chơi được trong lúc migrate.
- **UI DSH là React + slot system**, không phải Qt. Đây là phần tốn công nhất và ít quen thuộc nhất; nên làm
  sau khi tầng dữ liệu đã ổn định để không xây UI trên schema còn đổi.
- **25 card của RSM là deck test**, không phải nội dung thật, và tất cả đều `metadata.source = default_test_deck`.
  Nạp được không có nghĩa là chơi hay; P6 mới là phần nội dung.
- **`.gitignore` + key**: repo cũ không có `.gitignore` và có key plaintext. Không copy sang; repo mới đã có
  `.gitignore` và không có tầng provider.

## 6. Việc không làm

- Không port tầng provider của RSM, kể cả phần retry/structured-output — DSH lo việc đó.
- Không port `ui_pack_manager` dạng UI; chỉ port dữ liệu pack và để agent xử lý bulk.
- Không giữ app Python như runtime song song. Nó chỉ còn là nguồn dữ liệu để import một lần.

## 7. Phát hiện khi chạy P2 trên dữ liệu thật

Ba lỗi chỉ lộ ra khi chạy engine trên 25 card thật, không lộ ra khi đọc code:

### 7.1 Trộn pack sinh ra thế giới vô nghĩa — lỗi nghiêm trọng nhất

Lần chạy demo đầu tiên cho ra cảnh: thế giới **rừng rậm nhiệt đới** + nhân vật chính là **đầu bếp của
ma cà rồng** + NPC **Count Valtherion** + mở màn ở **vũ hội của Malphas** + mục tiêu **thoát qua Cửa Sắt
khỏi chiều không gian của Malphas**. Bốn pack khác nhau ghép thành một mớ vô nghĩa.

Nguyên nhân: RSM rút từng slot từ toàn pool, và đồ thị tương thích của dữ liệu thật **không đủ dày để
chặn**. Không có `incompatibleTags` nào giao nhau giữa rừng rậm và ma cà rồng, nên mọi cặp đều "hợp lệ"
về mặt máy móc.

Đây chính là gốc của cảm giác "khó vãi" ở hero mode: GM nhận một thế giới không thể diễn giải, rồi phải
tự bịa ra cách nối chúng.

Cách sửa: thêm `settings.coherence` với hai giá trị.
- `single_source` (mặc định) — cả 8 slot lấy từ MỘT pack hoàn chỉnh. Pack vốn đã là một thế giới được
  thiết kế cùng nhau, nên cảnh mạch lạc theo cấu tạo.
- `mixed` — hành vi cũ, để dành cho ai muốn thế giới Frankenstein.

Kèm chẩn đoán: card không chia sẻ `domain` nào với phần còn lại của cảnh bị gắn cảnh báo mạch lạc.

### 7.2 Card `opening` của dữ liệu thật có khi để `prompt` rỗng

Ô "Mở màn" trong briefing in ra trống vì `openingSituation` chỉ đọc `fragments.prompt`, mà có card chỉ
đặt nội dung ở `firstMessage`. Sửa: `prompt` → `firstMessage` → `description`, và mọi mảnh khác cũng lui
về `description` khi rỗng.

### 7.3 Bộ ghi pack serialize sai `type`

Đường ghi file card riêng bọc `type` thành mảng, còn đường ghi pack thì ghi thẳng card nội bộ nên `type`
thành chuỗi. Hệ quả: **mọi file pack ghi ra đều không nạp lại được**, và tính năng "bộ nguồn hoàn chỉnh"
trở nên vô hình. Đã gộp hai đường ghi về một hàm `toStoredCard()` và thêm test hồi quy.
