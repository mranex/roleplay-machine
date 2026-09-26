---
name: rp-writer
description: 'Dùng khi người chơi muốn biến một ván Roleplay Machine đã chơi thành truyện ngắn — theo góc nhìn người chơi, một NPC, Thiên Đạo, hay toàn tri; hoặc muốn xuất lịch sử ván thành hồ sơ lưu trữ.'
disable-model-invocation: false
user-invocable: true
---

# Người Viết (Roleplay Machine — Story)

Người chơi đã chơi xong một simulation. Việc của bạn không phải kể lại lượt chat — mà là **biên soạn một
bản văn học từ những gì thật sự xảy ra**, và giao cho một người viết riêng.

## Nguyên Tắc Không Thương Lượng

1. **Không tự viết truyện.** Bạn điều phối. `rp_write` mới là chỗ sinh ra văn bản, và writer đó chỉ nhận
   hồ sơ đã cắt theo góc nhìn — nó không thấy phiên chat, không thấy kênh Thiên Đạo.
2. **POV là chuyện dữ liệu, không phải chuyện giọng văn.** `rp_export` cắt sẵn nguyên liệu: bí mật ván
   không nằm trong nguyên liệu POV1. Đừng "viết thêm cho hay" bằng cách kể cho người chơi thứ họ chưa biết.
3. **Spoil phải được yêu cầu.** `rp_write` chỉ trả nội dung truyện về kết quả tool khi view là `player`.
   Muốn trả về cả POV2/POV3/toàn tri thì phải có `reveal: true`, và chỉ khi người chơi đã nói rõ là họ
   muốn bản có spoil.
4. **Đây là chuyển thể, không phải phán xử.** Truyện không đổi được ván. Không gọi `rp_meter`,
   `rp_step`, `rp_strike` vì những gì xảy ra trong truyện.

## Quy Trình

### 1. Chuẩn bị nguyên liệu (một lần)
`rp_export` với `allPovs: true`. Nó ghi vào `runs/<sceneId>/export/`:
- `story.md` — hồ sơ đầy đủ (dòng thời gian sự thật, bản đồ ai biết gì, nội tâm actor, lời kể). **Phía
  Thiên Đạo: có chứa bí mật.**
- `story.json` — cùng dữ liệu, dạng máy đọc.
- `material-*.md` — nguyên liệu cắt sẵn cho từng góc nhìn. Đây là thứ writer thật sự nhận.

Kết quả tool chỉ trả đường dẫn và số liệu, nên **không có bí mật nào lọt vào transcript**.

### 2. Hỏi người chơi ba thứ
- **Góc nhìn**: người chơi (POV1) · một NPC cụ thể (POV3) · Thiên Đạo (POV2) · toàn tri (biết thứ người
  chơi không biết).
- **Độ dài và giọng**: `short` ~700 từ · `medium` ~1800 · `long` ~4000; `plain` · `sparse` · `lyrical` · `noir`.
- **Điều muốn bỏ**: `player_fumbles` (bỏ đoạn người chơi xử lý vụng) · `ooc` · `mechanics` (bỏ con số,
  thanh, bước thắng) · `minor_turns` (gộp lượt không đẩy cốt truyện). Có thể dặn thêm bằng câu tự do.

Nếu họ không có ý kiến, mặc định `medium` + `plain` + `player_fumbles`.

### 3. Viết
`rp_write` với `view`, và `actorId` nếu là POV3. Kết quả trả về tiêu đề, đường dẫn, số từ, và những chi
tiết writer tự thêm. Với POV1 nó trả cả nội dung — dán vào hội thoại cho người chơi đọc.

Muốn nhiều bản để so sánh: `allViews: true` viết song song POV1 + POV2 + POV3 cho từng actor (trần 3
actor). Đây là cách tốt nhất để cho thấy **cùng một sự thật, ba bản văn khác nhau** — và cũng là lúc bản
đồ dramatic irony phát huy tác dụng.

Nếu cần đọc lại bản trên đĩa: `runs/<sceneId>/stories/<player|kami|omniscient|npc-<id>>.md`. Viết lại cùng
góc nhìn thì ghi đè — hồ sơ gốc vẫn nằm trong `runs/<sceneId>/export/`.

## Ghi Lời Kể Mỗi Lượt (khi đang chơi)

`rp_log` là thứ làm cho hồ sơ dày lên: gọi **ngay sau khi kể xong một lượt**, kèm nguyên văn lời kể và
`outcome` (một câu: việc gì đã THỰC SỰ thay đổi). Nó:
- lưu lời kể vào `transcript.jsonl` với nhãn *rendering, không phải canon*;
- vá `outcome` trong `state.json` — trước đây trường đó luôn rỗng.

Không gọi `rp_log` thì vẫn xuất được truyện, nhưng chỉ từ **bộ xương** (hành động + sự kiện + nội tâm
actor). Mất phần giác quan mà chỉ lời kể mới có.

## Giới Hạn Cần Nói Thật Với Người Chơi

- **Ván ngắn thì truyện mỏng.** Dưới ~5 lượt, writer phải nén rất nhiều; nói trước để họ chọn `short`.
- **Writer sẽ thêm chi tiết giác quan** (mùi, ánh sáng, nhịp thở) vì sim không mô hình hoá chúng. Những
  chi tiết đó được liệt kê ở mục "Chi tiết người viết tự thêm" cuối tệp — đó là chỗ để kiểm.
- **Niềm tin của NPC có thể sai, và bản POV3 giữ nguyên cái sai đó.** Đó là chất liệu, không phải lỗi.
  Nếu người chơi muốn bản "sự thật", dùng POV2 hoặc toàn tri.
