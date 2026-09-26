# Story — từ simulation ra câu chuyện

Trước giờ mọi app roleplay đều dừng ở vòng lặp chat: người chơi gõ, máy kể, lặp lại. Ở đây thì khác về
bản chất: **ván chơi là một simulation có trạng thái thật nằm ngoài model**, và câu chuyện ngắn là bản văn
học biên soạn từ chính bản ghi của simulation đó.

Khác biệt không nằm ở chỗ "viết hay hơn". Nó nằm ở chỗ:

> Ba góc nhìn không phải ba giọng văn — chúng là **ba tập dữ liệu khác nhau**, và code cắt tập dữ liệu.

POV1 không spoil được **không phải vì ta dặn người viết "đừng tiết lộ"**, mà vì đoạn chứa `hiddenTruth`
đơn giản là không được nhét vào prompt của nó. Đó là cùng một nguyên tắc đã dựng nên tầng actor.

## 1. Nguồn: cái gì thật sự được ghi lại

| Nguồn | Ai viết | Nhãn |
|---|---|---|
| `transcript.jsonl` → `turn` | **code**, từ kết quả pipeline actor | canon |
| `transcript.jsonl` → `narration` | Thiên Đạo nộp qua `rp_log` | rendering — **không phải canon** |
| `state.json` | runtime hai trục | canon |
| `scenes/<id>.json` | tầng scene | nguồn + sealed |
| `actors.json` | pipeline actor | private |

**Không lấy phiên chat làm nguồn.** Chat chứa cả kênh ngầm (`hiddenTruth`), cả OOC, cả nhắc nhở hệ
thống; đưa nó cho writer là tự tay phá ranh giới vừa dựng. Nguồn là `transcript.jsonl` — và nó được ghi
bằng code từ những gì pipeline **đã tính sẵn**: ai tri giác được gì ở mức nào, actor hiểu gì, cái gì thành
canon. Không tốn thêm model call nào.

Ba loại dữ liệu được tách nhãn rõ trong hồ sơ, và sự tách nhãn đó là điều kiện để writer không nhầm bản
kể với sự thật:

- **canon** — đã commit qua `validateEvent`.
- **private** — niềm tin/kế hoạch/ý định của actor. Niềm tin **có thể sai**; cái sai đó là chất liệu.
- **rendering** — lời kể của Thiên Đạo. Nó có thể chứa chi tiết quản trò tự thêm.
- **sealed** — `hiddenTruth`, twist, luật Thiên Đạo, các con số.
- **public** — vai, mục tiêu, áp lực, mở màn: thứ người chơi biết từ đầu.

Mảnh `prompt`/`firstMessage` của card được đưa vào như **bảng màu** — văn có tác giả, để writer tô chi
tiết giác quan thay vì bịa ra một thế giới mới.

## 2. Bản đồ dramatic irony — thứ gần như miễn phí

`BroadcastResult` mỗi lượt đã biết chính xác **ai nhận được sự kiện nào ở mức nào**: `full`, `muffled`,
`presence`, hay `none`. Trước đây nó bị vứt đi sau mỗi lượt.

Tích luỹ nó lại thành một bảng, và ta có thứ mà không app chat nào có:

| Lượt | Sự kiện | Người chơi | Actor |
|---|---|---|---|
| 1 | Quản gia nói: "Dạ, thưa ngài." | full | npc_butler:full |
| 1 | `npc_lucien muốn conceal…` | — | (riêng tư, không ai biết) |

Đây chính là chất liệu để viết toàn tri: người đọc biết thứ người chơi không biết, và **ta chứng minh
được** điều đó bằng dữ liệu chứ không bằng cảm giác.

## 3. Bốn góc nhìn, và chúng được cắt thế nào

`rp_export` ghi hồ sơ đầy đủ, rồi cắt nguyên liệu riêng cho từng góc nhìn vào `material-*.md`.

| POV | context | texture | sealed | timeline | irony | inner | rendering |
|---|---|---|---|---|---|---|---|
| **1 người chơi** | có | có | **KHÔNG** | chỉ thứ họ tri giác | **KHÔNG** | **KHÔNG** | có |
| **3 NPC** | **KHÔNG** | có | **KHÔNG** | chỉ thứ nó tri giác | **KHÔNG** | chỉ chính nó | **KHÔNG** |
| **2 Thiên Đạo** | có | có | có | tất cả | có | có | có |
| **toàn tri** | có | có | có | tất cả | có | có | có |

Hai chỗ đáng chú ý:

- POV1 **không** nhận bản đồ irony, vì bản đồ đó nói cho người viết biết ai đang mù tịt — đúng thứ người
  chơi không được biết.
- POV3 **không** nhận lời kể của Thiên Đạo, vì lời kể có thể chứa thứ NPC đó không hề biết (ví dụ suy
  nghĩ của người chơi).

## 4. Writer: subagent có context sạch

```
rp_write
  → chọn POV, dựng nguyên liệu đã cắt
  → dựng danh sách chuỗi CẤM của POV đó          (guard.ts)
  → nếu nguyên liệu đã lọt chuỗi cấm: NÉM, không gọi model
  → spawn subagent: toolFilter {allow: []}, outputSchema, persona riêng
  → nhận { title, body, notes }
  → soi bản văn lần nữa; rò rỉ thì KHÔNG ghi ra đĩa
  → ghi runs/<id>/stories/<view>.md
```

Ba chốt chặn provider dùng lại nguyên của tầng actor: không `fork`, `toolFilter` rỗng, không kế thừa
ngữ cảnh. Writer không đọc được file, không gọi được tool nào; **toàn bộ những gì nó biết nằm trong
prompt**, và prompt được dựng từ hồ sơ đã cắt.

### Guard và báo động giả

Danh sách cấm không phải "mọi câu bí mật", vì có một ca tinh tế: một câu trong `allowedKnowledge` của
NPC A **có thể** đến tai người chơi qua lời thoại. Khi đó nó nằm trong nguyên liệu hợp pháp của POV1, và
không được coi là rò rỉ nữa. Nên:

```
cấm = ứng viên (sealed + kiến thức/niềm tin/kế hoạch/ý định của người khác + private + withheld)
      TRỪ những gì đã có trong nguyên liệu của chính POV đó
```

Nhờ vậy `assertPovSafe` bắt được bí mật thật, mà không bắn nhầm một câu người chơi đã nghe.

POV2 và toàn tri có danh sách cấm rỗng — hàng rào ở đó là con người: người chơi đã yêu cầu có spoil. Đó
là lý do `rp_write` chỉ trả nội dung về kết quả tool khi view là `player`, trừ khi gọi kèm
`reveal: true`.

## 5. Tham số của một lần viết

| Tham số | Giá trị |
|---|---|
| `view` | `player` · `npc` (+`actorId`) · `kami` · `omniscient` |
| `length` | `short` ~700 từ · `medium` ~1800 · `long` ~4000 |
| `style` | `plain` · `sparse` · `lyrical` · `noir` |
| `omit` | `player_fumbles` · `ooc` · `mechanics` · `minor_turns`, hoặc câu tự do |
| `focus` | dặn thêm bằng câu tự do |
| `allViews` | viết song song POV1 + POV2 + POV3 từng actor (trần 3 actor) |

`omit` có nhãn dựng sẵn vì người dùng hay yêu cầu đúng những thứ đó — `player_fumbles` chính là "lược bỏ
các đoạn người chơi xử lý ngu".

## 6. Những gì đã xong và đã kiểm

- `src/story/transcript.ts` — JSONL append-only, dựng bằng code; lời kể nộp muộn vẫn gắn đúng lượt; dòng
  hỏng bị bỏ qua; `withTurnOutcome` vá `outcome` (trước đây luôn rỗng).
- `src/story/export.ts` — hồ sơ đầy đủ (Markdown + JSON) và cắt theo POV; bảng irony.
- `src/story/guard.ts` — `povForbidden` + `assertPovSafe`, có xử lý báo động giả.
- `src/story/brief.ts` — brief, prompt, schema output, parse hạ cấp an toàn.
- `src/story/session.ts` — writer runner, dùng chung chốt chặn provider với actor.
- Tools: `rp_log`, `rp_export`, `rp_write` (tổng 18 tool).
- Skill: `rp-writer`; `rp-game-master` thêm bước 5 `rp_log` mỗi lượt và mục chuyển sang writer.

Kiểm chứng: `pnpm verify` (test + typecheck + build + smoke). Smoke chạy cả tầng actor lẫn tầng story
**trên artifact đã build**, với subagent giả nên không tốn model call. Test thuần trong
`tests/story-export.spec.ts` và `tests/story-writer.spec.ts`.

## 7. Giới hạn đã biết

- **Ván dưới ~5 lượt cho truyện rất mỏng.** Writer phải nén; nói trước để người chơi chọn `short`.
- **Writer sẽ thêm chi tiết giác quan.** Sim không mô hình hoá mùi vị hay ánh sáng, nên phần tô đó là sáng
  tạo có kiểm soát: nó được liệt kê ở cuối tệp truyện để người đọc biết cái gì không có trong hồ sơ.
- **Ván đã chơi trước khi có `rp_log` chỉ export được bộ xương** (hành động + sự kiện + nội tâm actor),
  không có lời kể cũ. Vẫn viết được — đúng theo tinh thần "sim là nguồn, văn là bản dịch".
- **Chưa có pass nhiều vòng** (viết nháp rồi tự biên tập lại). Một model call cho một góc nhìn, và thế là hết.
- **Chưa đưa truyện ngược lại vào ván.** Truyện là đầu ra, không phải đầu vào.
