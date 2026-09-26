---
name: rp-create-card
description: 'Dùng khi người chơi muốn tạo card mới từ một ý tưởng, muốn mở rộng thư viện, hoặc khi thư viện thiếu một loại card khiến không lắp được scene.'
disable-model-invocation: false
user-invocable: true
---
# Tạo Card (Roleplay Machine)

Card không phải lorebook. Mỗi card là **chỉ thị hành vi** cho Thiên Đạo, đủ ngắn để đọc trong một lượt.
Nếu card cần người đọc biết lịch sử mới dùng được, nó viết sai.

## Tám Loại

| Loại | Vai trò | chaos 1 → 5 |
|---|---|---|
| `world` | luật của thế giới | đời thường → thực tại bị bẻ cong |
| `player_role` | **người chơi bắt buộc là ai** | vai nhỏ, ít quyền → vai có sức nặng lớn |
| `npc` | nhân vật trung tâm | người thường → thực thể thần thoại |
| `opening` | cảnh mở màn | êm → dữ dội/phi lý |
| `pressure` | thanh căng thẳng và cách nó siết | áp lực nhẹ → chết người |
| `goal` | mục tiêu của ván | mong muốn nhỏ → tham vọng tầm cỡ thế giới |
| `hidden_truth` | sự thật bị niêm phong | hé lộ sớm → chôn rất sâu |
| `chaos` | luật hỗn loạn áp lên cả ván | biến cố nhẹ → thực tại đổ vỡ |

Một scene lấy đúng một card mỗi loại. `chaos` là slot thứ tám, không phải deck biến cố.

## Năm Mảnh — Đây Là Phần Quan Trọng Nhất

| Mảnh | Ai đọc | Trần | Viết gì |
|---|---|---|---|
| `prompt` | người chơi | 1000 | Card cư xử thế nào trong cảnh |
| `firstMessage` | người chơi | 4000 | **Chỉ card `opening`** mới dùng. Câu mở màn |
| `hiddenTruth` | **chỉ GM** | 1000 | Điều người chơi phải giải mã, hoặc ghi chú GM |
| `heavenRule` | chỉ GM | 500 | Luật phán xử riêng: cái gì hiệu lực một lần, cái gì phải trả giá |
| `contentBoundary` | chỉ GM | 1000 | Lệnh cấm cứng để card không trôi khỏi mô hình |

`heavenRule` và `contentBoundary` là hai van chống "AI trả lời lãng xẹt". Bỏ qua chúng thì card sẽ trôi:
NPC trở nên vô hại, mục tiêu thành dễ dãi, tông truyện lệch dần.

## Các Trường Còn Lại

- `visibility`: `public` (mặc định) hoặc `gm_only`. **Card `hidden_truth` bắt buộc `gm_only`.**
- `weight`: số nguyên ≥ 0, mặc định 10. 0 nghĩa là không bao giờ được rút.
- `compatibility`: `domain` (thế giới nào card này thuộc về), `compatibleTags`, `requiredAnyTags`,
  `requiredAllTags`, `incompatibleTags`, `compatibleCardIds`, `incompatibleCardIds`, `universal`.
  `domain` là trường quan trọng nhất: cảnh trộn hai domain rời nhau bị coi là thiếu mạch lạc.
- `mechanics` (tuỳ chọn, có cấu trúc — nên điền khi viết card `pressure` hoặc `goal`):
  ```json
  { "meters": [{ "id": "nghi-ngo", "label": "Nghi ngờ", "min": 0, "max": 5, "start": 1, "failAt": 5, "description": "..." }],
    "winSteps": ["...", "...", "..."],
    "loseConditions": ["..."],
    "forbiddenActions": ["..."] }
  ```
  Không khai báo thì tầng scene suy ra và ghi rõ đã suy ra gì. Khai báo thì ván mới có câu đố nhiều bước
  thật và thanh căng thẳng đúng ý.

## Ví Dụ Đạt

```json
{
  "schemaVersion": "rsm-card-v1",
  "id": "npc_ma_carong_sanh_dieu",
  "title": "Ma cà rồng sành điệu",
  "type": ["npc"],
  "chaos": 4,
  "tags": ["vampire", "noble", "fashion"],
  "compatibility": {
    "universal": false,
    "domain": ["fantasy"],
    "compatibleTags": ["chef", "food", "deception"],
    "requiredAnyTags": ["fantasy"],
    "requiredAllTags": [],
    "incompatibleTags": ["cozy", "hard_scifi"],
    "compatibleCardIds": [],
    "incompatibleCardIds": []
  },
  "visibility": "public",
  "weight": 10,
  "fragments": {
    "prompt": "Kẻ săn mồi cổ đại nhưng bị chi phối bởi gu thẩm mỹ: hắn coi thường con mồi tầm thường và chỉ hứng thú với thứ khiến hắn trông thời thượng. Hắn không bao giờ ra tay trước khi khoe gu.",
    "firstMessage": "",
    "hiddenTruth": "Hắn từng bị sỉ nhục vì lỗi mốt, nên sợ bị coi là lạc hậu hơn sợ nước thánh.",
    "heavenRule": "Kami-sama declares: lời nói dối thời thượng chỉ hiệu lực một lần. Lần thứ hai phải trình bày tốt hơn.",
    "contentBoundary": "Không được để hắn trở nên vô hại, lố bịch hay hợp tác hoàn toàn. Kể cả khi hài, hắn vẫn nguy hiểm."
  },
  "generationHints": { "tone": ["dark comedy"], "preferredUse": "", "avoidUse": "" },
  "qualityNotes": [],
  "metadata": { "author": "", "createdAt": "", "updatedAt": "", "source": "manual" }
}
```

## Ví Dụ Sai

- ❌ `prompt` dài hơn 1000 ký tự, hoặc kể lịch sử đế chế ma cà rồng chia bảy gia tộc — lore, không dùng được trong một lượt.
- ❌ Card `hidden_truth` để `visibility: "public"` — tool sẽ từ chối.
- ❌ `incompatibleTags` chứa tag của chính card, hoặc vừa `requiredAnyTags` vừa `incompatibleTags` cùng một tag.
- ❌ Đặt `firstMessage` trên card không phải `opening` — dữ liệu cũ có lỗi này, tầng scene bỏ qua và báo lại.

## Luồng Làm Việc

1. Nghe ý tưởng. Xác định nó thuộc loại nào — thường là `world`, `npc`, hoặc `hidden_truth`.
2. Đề xuất 2–3 card nháp trong hội thoại, mỗi card một dòng, kèm chaos và tags.
3. Người chơi chọn hoặc sửa. Chỉ sau đó mới gọi `rp_add_card`.
4. `rp_add_card` sẽ từ chối nếu vi phạm schema — đọc `issues` rồi sửa, không hỏi lại người chơi những gì tool đã nói rõ.
5. Xem lại thư viện bằng `rp_list_cards` (lọc theo `type`, `visibility`, `tag`).

Muốn một thế giới hoàn chỉnh thì cần **đủ 8 loại**, và mạch lạc nhất là viết chúng như một bộ: cùng
`domain`, cùng tags chia sẻ, `compatibleCardIds` trỏ vào nhau. Một bộ 8 card như vậy là một "pack", và
ván sẽ ưu tiên rút trọn một pack.

## Điều Quan Trọng Nhất

Người chơi viết card **không** làm họ biết câu chuyện: `hidden_truth` là card riêng, và ván rút ngẫu nhiên
từ thư viện. Nhưng nếu chính họ viết card `hidden_truth` rồi tự chơi, họ sẽ biết đáp án — hãy nói thẳng
điều đó, và đề nghị để thư viện có nhiều `hidden_truth` hơn để lần rút sau không rơi vào cái họ vừa viết.
