# Cài Đặt Và Chơi

> **Chỉ muốn biết cách chơi?** Đọc [Hướng dẫn sử dụng](huong-dan-su-dung.md) — viết cho người chơi, không
> có gì kỹ thuật. File bạn đang đọc là tài liệu **cài đặt và xử lý sự cố**, dành cho người dựng môi trường.

## 1. Cài Plugin Vào DSH Profile

```powershell
cd C:\Games\roleplay-machine
pnpm install
pnpm build                 # sinh lib/index.js, lib/card-schema.js, lib/scene.js, lib/runtime.js, lib/client.js
pnpm import:rsm            # nạp thư viện card từ app Python cũ (một lần)
pnpm --filter dsh-roleplay-machine pack   # sinh dsh-roleplay-machine-0.1.0.tgz ở gốc repo
```

Tạo một profile riêng (đừng đè lên profile đang dùng) rồi cài:

```powershell
dsh --profile rp --from-default-profile web --dump-config
dsh plugin --profile rp add C:\Games\roleplay-machine\dsh-roleplay-machine-0.1.0.tgz
```

Sau đó kiểm tra profile **có tên gói trong `dsh.profile.bundles`**:

```powershell
notepad $env:USERPROFILE\.dsh\profiles\rp\package.json
```

```json
"dsh": {
  "profile": {
    "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-roleplay-machine"],
    "patchReload": "live"
  }
}
```

Nếu thiếu, thêm `"dsh-roleplay-machine"` vào mảng `bundles` rồi lưu. Đây là cách một plugin được nạp
(cùng cách profile `scriptor` đang chạy), và nó áp cả `cordis.patch.yml` của gói như một lớp bundle.

Cuối cùng xác nhận cấu hình:

```powershell
dsh --profile rp --dump-config | Select-String "rp-machine"
```

Phải in ra **đúng một** dòng `id: rp-machine`. Hai dòng nghĩa là bạn vừa khai trong `bundles` vừa chèn
thủ công vào `cordis.patch.yml` — trùng id làm boot bỏ qua plugin. `cordis.patch.yml` của profile nên để
nguyên `[]`.

Khởi động tại thư mục bạn muốn chơi:

```powershell
cd C:\Games\rp-sandbox
dsh --profile rp --host 127.0.0.1 --port 6104 --no-open
```

Mở URL kèm `?token=...` mà lệnh in ra. Dùng cổng khác nếu đang có DSH khác chạy.

### Ba cái bẫy khi cài lại plugin

1. **`dsh plugin remove` rồi `add` lại không tự khôi phục.** Lần `add` thứ hai báo "Already up to date"
   và bỏ qua phần ghi cấu hình, nên gói có trong `node_modules` nhưng plugin không được nạp. Phải tự
   thêm tên gói vào `dsh.profile.bundles` như trên.
2. **Không chèn thủ công vào `cordis.patch.yml`.** Bundle layer đã chèn một dòng cùng id; chèn thêm là
   trùng id và boot bỏ qua plugin, không báo lỗi.
3. **Route API không được có `/` cuối.** DSH khớp prefix theo `path + '/'`, nên `/rp-machine/api/` thành
   `/rp-machine/api//` và không bao giờ khớp — triệu chứng là POST trả 405 dù plugin đã nạp.

Chẩn đoán khi plugin không xuất hiện: đặt biến môi trường `RP_APPLY_LOG` trước khi khởi động —

```powershell
$env:RP_APPLY_LOG = "C:\Games\rp-sandbox\rp-apply.log"
dsh --profile rp --host 127.0.0.1 --port 6104 --no-open
```

File log sẽ ghi các mốc `apply:start → skills:done → workspace:done → tools:done → agents:done →
web-api:registered /rp-machine/api → apply:end`. Nếu file trống thì `apply` không chạy (lỗi cấu hình
profile); nếu dừng giữa đường thì mốc cuối chỉ ra bước hỏng.

## 1b. Giao Diện Trong DSH Web

Plugin đăng ký một tab trong sidebar phải, tên **Roleplay Machine**, với ba màn:

- **Thư viện** — lọc theo loại/tag, xem badge chaos và mức hiển thị. Card bị niệm phong (`hidden_truth`)
  chỉ hiện tiêu đề và tags; bấm "Hiện nội dung (có spoil)" mới mở, kèm cảnh báo. Có nút Sửa và Xoá.
- **Rút bài** — chọn một trong ba mode, seed tuỳ chọn, rồi Rút. Hiện nguồn (pack), chaos, các thanh căng
  thẳng, số bước thắng và briefing công khai. Không bao giờ hiện sự thật bị niệm phong.
- **Sửa card** — form đủ 8 loại + 5 mảnh, đếm ký tự theo trần cứng, lưu thẳng vào thư viện.

UI nói chuyện với host qua `POST /rp-machine/api/<method>` (header `x-rp-request: 1`). Mở tab bằng cách
bấm vào mục trong guide của sidebar phải, hoặc nhờ trợ lý.

**Phân công:** UI để *rút bài và soi thư viện*; phần *chơi* vẫn do trợ lý trong hội thoại đảm nhiệm, vì
luật Thiên Đạo nằm ở kênh systemPrompt.

## 2. Chuẩn Bị Pool Trong Workspace

Thư viện card và trạng thái ván sống trong workspace, **không** nằm trong gói cài:

```
<workspace>\roleplay-machine\pool\<type>\<id>.json    ← một card một file
<workspace>\roleplay-machine\pool\packs\*.json        ← bộ 8 card = một thế giới
<workspace>\roleplay-machine\scenes\*.json            ← scene đã rút
<workspace>\roleplay-machine\runs\<sceneId>\         ← trạng thái ván + ending.md
<workspace>\roleplay-machine\recent.json              ← card dùng gần đây
```

Copy thư viện khởi đầu (25 card + 6 pack đã import từ app Python cũ):

```powershell
New-Item -ItemType Directory -Force C:\Games\rp-sandbox\roleplay-machine | Out-Null
Copy-Item C:\Games\roleplay-machine\pool-v2 C:\Games\rp-sandbox\roleplay-machine\pool -Recurse -Force
```

Muốn nhiều chủ đề hơn thì thêm card bằng khung **Sửa card** trong UI, hoặc bằng tool `rp_add_card`, hoặc
sửa trực tiếp file JSON rồi chạy `pnpm test` — test sẽ báo card nào vi phạm schema.

## 3. Chơi

Nói với trợ lý:

> Chơi Roleplay Machine. Chọn mode **Tôi là siêu anh hùng**.

Nó sẽ gọi `rp_pool_status` → `rp_new_scene` → mở màn theo briefing. Từ đó mỗi lượt bạn nhập vai, nó gọi
`rp_turn` trước khi kể và ghi lại diễn biến bằng `rp_step` / `rp_meter` / `rp_strike` / `rp_log`.

**Toàn bộ phần hướng dẫn chơi — câu mẫu cho từng việc, ba mode, chế độ nhiều nhân vật, cách nhờ viết truyện
ngắn — nằm ở [Hướng dẫn sử dụng](huong-dan-su-dung.md).** Mục này chỉ nhắc lại đúng một câu để mở ván.

## 4. Phục Hồi Sau Gián Đoạn

Ván nằm ở `<workspace>\roleplay-machine\runs\<sceneId>\state.json`. Đóng trình duyệt rồi mở lại chỉ cần nói
"chơi tiếp" — nó gọi `rp_state` để đọc lại. Nếu history chat đã bị cắt, `state.json` vẫn là nguồn sự thật.

Xem lại các ván đã chơi: `rp_pool_status` liệt kê; epilogue nằm ở `runs\<sceneId>\ending.md`; hồ sơ và
truyện ngắn nằm ở `runs\<sceneId>\export\` và `runs\<sceneId>\stories\`.

## 5. Kiểm Chứng

```powershell
cd C:\Games\roleplay-machine
pnpm verify
```

Bốn tầng:

1. `pnpm test` — **376 test**: schema `rsm-card-v1`, đồ thị tương thích có chấm điểm, engine sinh scene tất định,
   coherence, runtime hai trục, bộ tool mới, API cho UI, **test chống rò rỉ `hiddenTruth` qua tool output**,
   **Multi-Actor-Agent Mode**, **Story (export, cắt theo POV, guard, writer)**, và **render thật panel UI
   trong DOM ảo**.
2. `pnpm typecheck` — TypeScript strict, gồm cả `.tsx` của UI.
3. `pnpm build` — 5 bundle esbuild (4 cho host, 1 cho trình duyệt), tự kiểm tra import và banner module loader.
4. `pnpm smoke` — nạp `lib/index.js` trong tiến trình Node sạch: đăng ký 18 tool, chơi trọn một ván trên thư
   viện thật, chạy một lượt actor mode + export + viết truyện bằng subagent giả, gọi thẳng API của UI, và
   **nạp `lib/client.js` qua `window.__ModuleLoader__` giả** để xác nhận nó đăng ký đúng tab + slot.

Trong đó `tests/schema.spec.ts` dùng chính bộ kiểm tra của DSH (`assertSupportedJsonSchema`,
`assertObjectJsonSchema`, `validateJsonSchemaValue` từ `@deepseek-ai/dsh-tools`) để chứng minh schema tool nằm
trong tập con DSH hỗ trợ và giá trị trả về khớp schema — đây là điều kiện để `tools.register()` không từ chối
plugin.

## 6. Bằng Chứng Đã Kiểm Chứng Trong DSH Thật

DSH `0.1.5-rc.3`, Node `v24.21.0`, Windows. Ba đợt, mỗi đợt kiểm một tầng mới.

**Đợt 1 — host plugin (13 tool của tầng MVP cũ, đã bị thay ở P4)**

1. `dsh --profile rp --dump-config` in ra `id: rp-machine` — plugin vào cây cấu hình.
2. Boot host thật ở cổng riêng: boot thành công, không lỗi nạp plugin.
3. Profile headless: model liệt kê **đúng 13 tên** `rp_*` — plugin activate và tool vào danh sách của model.
4. Gọi thật `rp_pool_status`: `total = 43`, `truthSeeds = 12` — khớp pool trong workspace.

**Đợt 2 — bộ tool mới trên scene + runtime (P4)**

5. Profile headless liệt kê lại: **12 tên mới** (`rp_new_scene`, `rp_meter`, `rp_delete_card`, …), không còn
   `rp_new_run`/`rp_seal_truth`/`rp_suspicion`.
6. Gọi thật `rp_new_scene` mode `boss_mode`: model nạp skill, gọi `rp_pool_status` (25 card, 0 issue) rồi
   `rp_new_scene`, nhận scene từ **một pack duy nhất** — `chaos.total 21`, thanh *Suspicion Means Death* 1/5,
   cảnh cáo OOC 0/3 — và mở màn đúng chất Thiên Đạo.

**Đợt 3 — API và UI trong DSH web (P5)**

7. Boot `dsh --profile rp` (web) trên cổng riêng: `POST /rp-machine/api/status` với header `x-rp-request: 1`
   trả `total=25, packs=6, gmOnly=3`; `POST /cards {"reveal":false}` trả 25 card trong đó **3 bị che**;
   `POST /draw {"mode":"boss_mode"}` trả scene từ pack *Three Garlic Dishes for the Ancient Count*, chaos 21.
8. Request thiếu header bị chặn bằng **403**.
9. Module client `dsh-roleplay-machine/client.js` **có trong boot graph** của trang HTML do DSH phục vụ —
   nghĩa là tab sidebar sẽ được nạp.
10. `RP_APPLY_LOG` xác nhận `apply` chạy trọn vẹn trong web profile:
    `apply:start → skills → workspace → tools → agents → web-api:registered /rp-machine/api → apply:end`.

**Đợt 4 — render panel trong DOM ảo (P5)**

11. `tests/client-render.spec.ts` chạy với `happy-dom`: lấy component thật từ `apply()` của `lib/client.js`
    đã build, mount bằng `react-dom/client`, để `useEffect` chạy qua `fetch` giả, rồi đọc DOM. Sáu test khẳng
    định: mount được và hiện đúng ba tab (**Thư viện · Rút bài · Sửa card**); nạp thư viện và vẽ ra card;
    card niệm phong chỉ hiện `— nội dung bị niệm phong —` và **không** lộ `hiddenTruth`; bấm tab Rút bài hiện
    đủ ba mode; bấm nút Rút gọi `draw` rồi hiện tên pack và briefing; tab Sửa card hiện form có ≥5 textarea,
    nhãn `hiddenTruth` và bộ đếm `/ 1000`.

**Đợt 5 — Multi-Actor-Agent Mode trong DSH thật (M1–M3)**

Chạy bằng `dsh --profile rp-headless "<kịch bản 5 bước>"` trong `C:\Games\rp-sandbox`, trên gói đã `pack`
và cài lại vào profile.

12. `dsh --profile rp-headless --dump-config` in ra **đúng một** `id: rp-machine`; `apply` chạy trọn vẹn.
13. Model liệt kê **15 tool** `rp_*` (thời điểm đó), gồm ba tool actor (`rp_actor_cast`, `rp_actor_turn`, `rp_actor_state`).
14. **Hai actor subagent thật chạy song song** cho một lượt. Cùng một tiếng gọi lớn, hai actor phản ứng
    khác nhau đúng theo vị trí:
    - Lucien ở cùng phòng ⇒ `full`; nó chọn **nín thở và nấp** (`conceal`) ⇒ thành `observation` **riêng
      tư**, ghi rõ "Dự định này chưa được thực hiện", và **không** xuất hiện trong lời kể.
    - Quản gia ở phòng kề ⇒ `muffled`; nó chọn đáp lời ⇒ thành `npc_dialogue` công khai.
    Không có `hiddenTruth` nào trong prompt của cả hai (chốt chặn `assertIsolated` không nổ, và test
    tương ứng ở tầng đơn vị khẳng định điều này).
15. Hai lượt liên tiếp cho `turn` = 1 rồi 2, `issues` rỗng ở cả hai, và `rp_actor_state` báo
    `neverWoken` rỗng — số lượt ván và trạng thái actor cùng tiến.
16. `rp_actor_turn` gọi **hai lần** trong cùng một ván: lượt 2 khai `toLocation: kitchen` và người chơi
    **thực sự đổi chỗ** trong `rp_actor_state`.

Hai lỗi thật do đợt này tìm ra, cả hai đều không test nào bắt được trước đó:

- **`cannot get property "subagents" without inject`.** Plugin đọc service `subagents` thẳng từ ctx gốc
  thay vì qua `inject`. Sửa bằng một bước `inject(['subagents'])` riêng, giữ service vào holder để tool
  dùng lúc gọi. Đăng ký riêng khỏi bước tool là cố ý: profile không có subagent vẫn phải giữ đủ 15 tool.
  Có test tái hiện: host giả **trung thành với Cordis** (đọc service chưa inject là ném lỗi, `inject` đưa
  service vào scope).
- **Người chơi không bao giờ di chuyển được ở actor mode.** Pipeline định tuyến tri giác cho hành động
  của người chơi nhưng không dựng event cho hành động vật lý của họ, nên "tôi bước sang bếp" không đổi
  gì. Sửa bằng `playerDeclaredEvents()`: hành động vật lý người chơi tự tuyên bố được commit **trước**
  hệ quả của actor, và vẫn qua `validateEvent` nên bước phi pháp vẫn bị từ chối.

**Chưa kiểm chứng:** bố cục và màu sắc thật khi mở trình duyệt. Phần hành vi đã được kiểm ở mức DOM, nhưng
một lần mở mắt xem vẫn nên làm trước khi coi giao diện là hoàn thiện.

**Đợt 6 — Story: export và writer trong DSH thật**

Một phiên `dsh --profile rp-headless`: mở ván → khai 2 actor → hai lượt actor mode (mỗi lượt `rp_log`
ngay sau khi kể) → `rp_export allPovs` → `rp_write view=player`.

17. Model liệt kê **18 tool** `rp_*`, gồm `rp_log`, `rp_export`, `rp_write`.
18. `transcript.jsonl` có **4 dòng**: 2 lượt (dựng bằng code) + 2 lời kể.
19. `state.json` có `turn = 2` và **cả hai `history[].outcome` đều có nội dung** — lỗi `outcome` luôn rỗng
    đã được vá.
20. Cắt theo POV kiểm được trên đĩa: `export/story.md` **có** chứa `hiddenTruth` (364 ký tự, đây là hồ sơ
    phía Thiên Đạo), `export/material-player.md` **không** chứa nó, `export/material-kami.md` **có**, và
    có riêng `material-npc-npc_lucien.md` + `material-npc-npc_butler.md`.
21. `stories/player.md` được ghi ra với front matter `guard: không có chuỗi rò rỉ ngoài góc nhìn`, **614
    từ**, và **không** chứa `hiddenTruth`. Truyện mở bằng "Ta đặt khay xuống bàn." — ngôi thứ nhất, đúng
    POV1, và dùng lại mùi hoa nhài + giọng nữ tiếng Anh từ mảnh `opening` của card (bảng màu làm đúng
    việc của nó).
22. Cuối tệp truyện có mục **"Chi tiết người viết tự thêm"** liệt kê đúng những gì writer bịa thêm (tiếng
    bạc chạm gỗ, nến nghiêng, hơi nóng bếp, gương đồng) — người đọc biết cái gì không có trong hồ sơ.

Không có model call nào cho phần export: transcript và bản đồ irony đều dựng từ dữ liệu pipeline đã tính.
Hai model call là hai writer (POV1 và POV2 đã yêu cầu).

Hai profile `rp` và `rp-headless` được tạo ra trong quá trình kiểm chứng; xoá bằng lệnh ở mục 7 nếu không dùng.

## 7. Gỡ Cài Đặt

```powershell
dsh plugin --profile rp remove dsh-roleplay-machine
```

Nhớ xoá `"dsh-roleplay-machine"` khỏi `dsh.profile.bundles` trong
`$env:USERPROFILE\.dsh\profiles\rp\package.json`, rồi xoá thư mục profile nếu không dùng nữa.

Xoá cả thư mục `roleplay-machine` trong workspace nếu muốn bỏ toàn bộ thư viện và lịch sử ván.

## Xử Lý Sự Cố

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| `rp_*` không xuất hiện trong danh sách tool | Plugin chưa vào `dsh.profile.bundles`. Kiểm bằng `dsh --profile rp --dump-config`: phải có **đúng một** `id: rp-machine`. |
| `rp_actor_turn` báo `cannot get property "subagents" without inject` | Service subagents chưa được inject. Bản hiện tại inject riêng ở bước `rp-machine:subagents`; nếu vẫn gặp thì profile thiếu bundle subagent — kiểm `dsh --profile rp --dump-config \| Select-String subagent`. |
| `rp_actor_cast` báo "chưa dùng được" | Thiếu địa điểm, hoặc actor đứng ở địa điểm không có trong `locations`, hoặc `locations` rỗng. Đọc `issues` trả về. |
| Actor ngồi im cả ván | `perceive` của nó không khớp tình huống. Xem `awakeIds` của `rp_actor_turn`. |
| Người chơi khai `toLocation` mà không đi được | Đích không kề, hoặc cửa đang niêm phong. Lý do nằm trong `issues` của `rp_actor_turn`. |
| Boot chạy nhưng không có tool, không có tab UI | Trùng id: vừa khai trong `bundles` vừa chèn vào `cordis.patch.yml`. Để patch layer là `[]`. |
| Tab UI không hiện dù tool chạy | Thiếu `exports["./client"]` trong `package.json` của gói, hoặc `lib/client.js` không có trong tarball. |
| Panel mở nhưng báo lỗi kết nối | Route API lệch tiền tố. Phải là `/rp-machine/api` **không có `/` cuối**. |
| `Thư viện rỗng (…/pool)` | Chưa copy `pool-v2` vào workspace. Xem mục 2. |
| Pool báo lỗi schema | Đọc `issues` từ `rp_add_card` hoặc khung Sửa card. Trần: prompt 1000, heavenRule 500, contentBoundary 1000, hiddenTruth 1000 ký tự. |
| `Ván chưa kết thúc` khi gọi `rp_end` | Máy trạng thái chưa xác nhận: phải xong hết bước thắng, hoặc một thanh chạm `failAt`, hoặc đủ cảnh cáo OOC. |
| `Chưa xác định được workspace của phiên` | DSH không cấp được cwd/workspaceRegistry. Mở DSH tại thư mục muốn chơi. |
| Không rõ plugin có chạy không | Đặt `$env:RP_APPLY_LOG` rồi khởi động lại; xem mục 1. |
