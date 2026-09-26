# Thiết Kế Roleplay Machine

Ghi lại các quyết định thiết kế và lý do — đặc biệt những chỗ đã cân nhắc rồi mới chọn.

## 1. Vấn đề gốc, phát biểu lại cho chính xác

Ba nỗi đau của roleplay bằng card, và cách xử lý:

1. **Lore nhồi vào card làm mỗi lượt tốn token.** Không sửa bằng cách "viết card ngắn hơn" (lời khuyên vô
   dụng). Sửa bằng **ràng buộc schema**: `directive` bị chặn cứng ở 300 ký tự, và test trên dữ liệu thật xác nhận
   điều đó. Pool to bao nhiêu cũng không đổi chi phí mỗi lượt, vì mỗi lượt chỉ nạp 6 card đang hoạt động.
2. **Người chơi là tác giả ⇒ biết mất cái kết.** Sửa bằng **thứ tự sinh**: card hiển thị chốt trước (rút ngẫu
   nhiên có seed), thẻ ẩn sinh *sau* để hợp với bộ card đó. Người chơi viết card chỉ đóng góp nguyên liệu, không
   bao giờ chỉ định nhân vật chính hay mục tiêu ngầm.
3. **AI "lãng xẹt" khi đi quá sâu.** Sửa bằng **độ sâu có trần**: card là chỉ thị hành vi, không phải tư liệu;
   skill GM cấm giảng lịch sử/hệ thống; mỗi lượt kết bằng áp lực hoặc câu hỏi.

## 2. Quyết định quan trọng nhất: hai kênh

Tool output nằm trong transcript ⇒ **mọi thứ trả về từ tool đều công khai**. Bí mật chỉ có một đường đi:
`systemPrompt` của agent.

```
                 ┌─────────────────────────────┐
   thẻ ẩn  ─────►│ systemPrompt.context         │──► chỉ model thấy
   (bí mật)      │ 'rp-machine.run'             │
                 └─────────────────────────────┘

   rp_turn  ────►│ output công khai (frame,     │──► model + người chơi + log
   rp_state      │ chaos, tiến độ dạng số)      │
   rp_step       └─────────────────────────────┘
```

Hệ quả bắt buộc, và test đang canh đúng những điều này:

- `renderPublicFrame()` không được chứa `protagonist`, `secret`, mô tả `winSteps`.
- `rp_step` **không được echo mô tả bước thắng** trong thông điệp trả về. Test chống rò rỉ đã bắt được đúng lỗi
  này trong lần chạy đầu, và bản sửa chỉ trả về số thứ tự (`Bước 2/3 hoàn tất.`).
- `rp_step` cũng không được echo id tự sinh — id đó là slug của chính mô tả bước thắng.
- `rp_seal_truth` xác nhận đã niêm phong nhưng không đọc lại nội dung.
- `rp_open_seed` là ngoại lệ **có chủ đích**: nó trả seed đầy đủ cho GM, vì GM phải hiện thực hoá seed đó.
  Đây là điểm rò rỉ đã biết của trust mode, được ghi trong test chứ không giấu đi.

## 3. Vì sao chaos scale phải map ra lever

Một con số không điều khiển gì cả thì chỉ là trang trí. Chaos scale = trung bình có chuẩn hoá của scale 6 card,
và nó điều khiển:

| Chaos | Biến cố cưỡng bức mỗi | GM được bẻ cong luật | NPC được nói dối về luật |
|---|---|---|---|
| 1–2 | 4 lượt | không | không |
| 3 | 3 lượt | không | không |
| 4 | 2 lượt | có | không |
| 5 | 2 lượt | có | có |

Nhờ vậy "độ hỗn loạn" là một tham số chơi được, không phải nhãn dán.

## 4. Vì sao thẻ ẩn sinh sau khi lắp thế giới

Ghép ngẫu nhiên 6 card độc lập sẽ tạo ra combo vô nghĩa (ma cà rồng sành điệu × cyberpunk × xuyên không).
Cách chữa không phải là thêm luật tương thích phức tạp, mà là **đảo thứ tự sinh**:

1. Rút 6 card, lọc theo `requires`/`forbids`, ghi lại xung đột (không im lặng).
2. Chọn vài seed thẻ ẩn khớp tag với bộ card vừa rút.
3. GM đọc seed và **hiện thực hoá nó cho đúng thế giới này** — đổi bối cảnh, giữ cấu trúc đường thắng.

Ví dụ trong đề bài (đầu bếp của ma cà rồng, thuyết phục hắn ăn tỏi) không phải là một card rời — nó là *kết quả
suy luận* từ bộ card. Đây là chỗ model mạnh hơn card tĩnh, và là lý do thẻ ẩn không nằm trong pool như một card
thường.

## 5. Máy trạng thái thay cho "model nhớ luật"

Kết thúc ván do code đếm:

| Trạng thái | Điều kiện |
|---|---|
| `won` | toàn bộ `winSteps.done` |
| `ejected` | `strikes >= 3` (vi phạm OOC) |
| `lost` | `suspicion >= 3` (thế giới siết lại) |

GM kể chuyện và phán hành động, nhưng không thể tự chế kết thúc, không thể "quên" rằng người chơi đã thắng, và
không thể tha một vi phạm OOC bằng cách im lặng. Trạng thái nằm trên đĩa (`runs/<id>/state.json`) nên compaction
cắt history không phá ván.

## 6. Rubric OOC

"OOC" là khái niệm mơ hồ, nếu không định nghĩa thì hoặc không bao giờ phạt, hoặc phạt oan. Bốn nhóm bị phạt:

1. Tự định nghĩa nhân vật chính (tự nhận kỹ năng/vũ khí/thân phận không thuộc thẻ ẩn).
2. Godmoding (tự quyết kết quả thay cho thế giới).
3. Nói ngoài truyện (đàm phán luật, nhắc tới prompt/hệ thống/tác giả).
4. Dùng kiến thức ngoài thế giới.

Ba nhóm **không** bị phạt: hỏi han/do dự trong vai, tỏ ra bí (đó là việc của `rp_grace`), và thất bại — thất bại
là nội dung, không phải vi phạm.

Phần tất định (`detectPlayerSignals`) chỉ bắt tín hiệu thô và chuyển thành chỉ dẫn cho GM; phán quyết cuối cùng
vẫn theo rubric trong skill. Cố tình không để regex quyết định thay vì regex rất dễ phạt oan.

## 7. Chaos deck là loại card riêng

`chaos` không tham gia lắp thế giới. Nó là deck biến cố: khi chaos tới hạn, code roll một card và GM **bắt buộc**
đưa nó vào lượt đó. Deck rỗng thì GM tự bịa theo scale — ván không bao giờ kẹt vì thiếu card.

## Roadmap: sealed mode

Trust mode có một lỗ: thẻ ẩn nằm trong session log. Sealed mode bịt lỗ đó bằng cách giữ bí mật **ngoài** session
hoàn toàn:

```
người chơi hành động
   → tool 'rp_resolve' (code)
       → ctx.llm.stream() với prompt chứa thẻ ẩn   ← bí mật ở đây, không vào session
       → chỉ trả về: quyết định + gợi ý dẫn dắt
   → GM kể theo những gì nhận được
```

Đổi lại: gấp đôi số model call mỗi lượt và tăng độ trễ. Điểm cắt đã sẵn trong code — `prompt.ts` tách phần
`deps.workspaceRoot`/`stateText` khỏi phần dựng section; thay `activeRunText()` bằng một lời gọi model là xong.

Điều kiện để coi sealed mode là đáng làm: khi người chơi thật sự bắt đầu mở trajectory ra xem. Chưa có bằng
chứng đó thì trust mode + không echo ra tool output là đủ.

## Việc chưa làm

- UI rút card (`ctx.slots.register`) — hiện đi qua hội thoại.
- Đo chất lượng lời kể bằng model thật (cần chơi, không phải test).
- Pool nhiều chủ đề hơn; hiện 43 card đủ để không lặp trong một ván nhưng sẽ lặp sau vài ván.
- `agent/pre-step` hook chưa dùng: hiện chỉ dựa vào systemPrompt.context. Nếu model quên gọi `rp_turn`, nhịp
  lượt sẽ đứng. Đây là rủi ro đã biết; hook là chỗ sửa nếu chơi thật thấy tái diễn.
