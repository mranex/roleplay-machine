# Hướng dẫn sử dụng Roleplay Machine

Tài liệu này viết cho **người chơi**. Không cần biết lập trình, không cần biết gì về cách hệ thống chạy
bên trong. Mọi thứ ở đây là "bạn nói gì thì chuyện gì xảy ra".

> Nếu bạn là người cài đặt hoặc muốn hiểu kiến trúc bên trong, đọc [README](../README.md) và
> [install.md](install.md). Còn để **chơi**, chỉ cần file này.

---

## Điều duy nhất cần hiểu trước khi bắt đầu

**Bạn không gõ lệnh. Bạn nói chuyện.**

Trợ lý trong DSH đóng vai **Thiên Đạo** — quản trò của ván. Khi bạn nói "tôi đẩy cửa bước vào", nó tự lo
phần kỹ thuật: mở lượt, ghi lại diễn biến, cộng điểm căng thẳng, kiểm xem bạn đã thắng chưa.

Trong các tài liệu khác bạn sẽ thấy những cái tên như `rp_turn`, `rp_write`. Đó là **tên lệnh trong bụng
hệ thống**, không phải thứ bạn phải gõ. Chúng chỉ được nhắc ở đây khi cần giải thích chuyện gì đang xảy ra.

---

## 1. Cài đặt (làm một lần)

Nếu ai đó đã cài sẵn cho bạn, bỏ qua mục này.

```powershell
cd C:\Games\roleplay-machine
pnpm install
pnpm build
pnpm import:rsm     # nạp thư viện card mẫu (25 card + 6 bộ)
```

Rồi cài plugin vào một profile DSH và mở nó tại thư mục bạn muốn chơi. Các bước chi tiết nằm ở
[install.md](install.md) — mục 1 và mục 2.

## 2. Chuẩn bị thư viện card

Thư viện card là "kho thế giới" để rút ra. Nó nằm trong thư mục bạn mở DSH, không nằm trong phần mềm:

```powershell
New-Item -ItemType Directory -Force C:\Games\rp-sandbox\roleplay-machine | Out-Null
Copy-Item C:\Games\roleplay-machine\pool-v2 C:\Games\rp-sandbox\roleplay-machine\pool -Recurse -Force
```

Sau đó **mở DSH ngay tại thư mục đó** (`cd C:\Games\rp-sandbox` rồi mới khởi động). Nếu bạn mở DSH ở chỗ
khác, nó sẽ tìm thư viện ở chỗ khác và báo "Thư viện rỗng".

## 3. Câu đầu tiên để mở ván

Nói đúng ý này, không cần đúng từng chữ:

> **Chơi Roleplay Machine. Mode "Tôi là siêu anh hùng".**

Ba mode, chọn theo mức bạn muốn tự quyết:

| Bạn nói | Nghĩa là | Bạn phải chọn card không? |
|---|---|---|
| "Mode **Tôi là người bình thường**" | Bạn tự chọn cả 8 mảnh của thế giới | Có, chọn hết |
| "Mode **Tôi có hơi bất thường**" | Bạn chọn tối đa 3 mảnh, phần còn lại máy rút | Chọn tối đa 3 |
| "Mode **Tôi là siêu anh hùng**" | Không chọn gì. Thế giới tự chuyển động | Không |

Nếu bạn không nói mode, trợ lý sẽ hỏi.

**Chuyện gì xảy ra tiếp:** trợ lý rút ra một thế giới hoàn chỉnh, đọc cho bạn biết **bạn là ai** và **mục
tiêu là gì** — rồi kể cảnh mở màn. Có một thứ nó biết mà bạn không: **sự thật bị niêm phong**. Bạn sẽ
phải tự đoán ra. Đó là toàn bộ trò chơi.

## 4. Mỗi lượt bạn làm gì

Bạn chỉ cần nói bạn làm gì hoặc nói gì. Ngắn là tốt.

**Nên nói:**

- `Tôi đẩy cửa bước vào phòng ăn.`
- `Tôi hỏi hắn: "Ngài có nhớ mình đã ngủ bao lâu không?"`
- `Tôi lùi lại nửa bước và giấu bàn tay trái ra sau lưng.`
- `Tôi im lặng, quan sát xem hắn có nhìn vào khay không.`

**Không nên nói** (đây là lỗi phổ biến, và bị tính là phá khung):

- `Hắn hoảng sợ và khuỵu xuống.` ← bạn đang tự quyết kết quả thay cho thế giới
- `Tôi rút thanh kiếm ma thuật của mình ra.` ← bạn đang tự thêm thứ mà vai của bạn không có
- `Luật ở đây là gì vậy?` ← nói ngoài truyện

Ba lỗi đó sẽ bị **cảnh cáo**. Đủ ba lần là bị loại khỏi ván. Còn nói hớ trong vai, làm hỏng việc, đưa ra
quyết định dở — đó là **chuyện trong truyện**, chỉ làm tình hình căng lên, không bị phạt.

## 5. Bảng câu thần chú

| Bạn muốn | Nói gì |
|---|---|
| Xem mình đang ở đâu, còn mấy bước | "Trạng thái ván thế nào?" |
| Chơi tiếp ván cũ sau khi tắt máy | "Chơi tiếp ván cũ." |
| Mở ván mới | "Mở ván mới đi, mode ..." |
| **Bí quá, không biết làm gì** | "Tao bí rồi." — sẽ được mở một cánh cửa, nhưng **phải trả giá**: một thanh căng thẳng tăng lên |
| Xem thư viện đang có gì | "Thư viện có gì?" |
| Tạo một card mới | "Tạo cho tao một card NPC ..." (hoặc dùng bảng bên phải, xem mục 6) |
| Sửa card cũ | "Sửa card ..." hoặc mở bảng bên phải |
| Xoá ván, làm lại từ đầu | "Mở ván mới, đừng dùng lại thế giới cũ." |
| **Cho NPC có đầu thật** | "Bật chế độ nhiều nhân vật" (xem mục 7) |
| **Lấy lịch sử ván ra file** | "Xuất lịch sử ván này ra file." (xem mục 9) |
| **Biến ván thành truyện ngắn** | "Viết lại ván này thành truyện ngắn." (xem mục 8) |

**Ván kết thúc thế nào?** Bạn không quyết, và trợ lý cũng không. Máy trạng thái đếm: xong hết các bước
thắng thì thắng · một thanh căng thẳng chạm trần thì thua · đủ ba cảnh cáo thì bị loại. Khi đủ điều kiện,
nói "kể kết thúc đi" — và cái kết phải viết từ những gì **đã thực sự xảy ra**, không phải từ những gì lẽ
ra phải xảy ra.

## 6. Bảng điều khiển bên phải

Ở sidebar phải của DSH có một mục tên **Roleplay Machine**, mở ra ba màn:

- **Thư viện** — xem toàn bộ card, lọc theo loại và tag. Card niệm phong (chứa bí mật) chỉ hiện tiêu đề;
  muốn đọc nội dung phải bấm "Hiện nội dung" và nó sẽ cảnh báo bạn trước. **Đọc rồi thì ván đó hết bất ngờ.**
- **Rút bài** — rút thử một thế giới xem nó thế nào, không cần mở ván. Hữu ích khi bạn muốn chọn mode.
- **Sửa card** — viết card mới bằng biểu mẫu, có sẵn đủ 8 loại và 5 mảnh, kèm bộ đếm ký tự.

Chơi vẫn là chuyện trong hội thoại. Bảng bên phải để *soi và sửa kho card*.

## 7. Chế độ nhiều nhân vật (NPC "có đầu thật")

**Bình thường:** một model đóng tất cả nhân vật. Nó có thể đóng hay, nhưng thật ra chỉ có **một cái đầu** —
và cái đầu đó biết mọi thứ, kể cả những thứ lẽ ra quản gia không được biết.

**Khi bạn bật chế độ này:** mỗi NPC trở thành một **agent riêng biệt**. Nó chỉ biết những gì nhân vật đó
được phép biết. Quản gia không biết chuyện dưới hầm. Lucien không biết bạn đã giấu tỏi trong túi. Và
điều đó **được bảo đảm bằng cấu trúc, không phải bằng lời dặn** — không có đường nào để thông tin lọt vào
đầu nhân vật.

Cách bật — nói đúng ý này:

> **Bật chế độ nhiều nhân vật. Mỗi NPC một cái đầu riêng.**

Trợ lý sẽ hỏi bạn (hoặc tự khai) vài thứ: có những nhân vật nào, ai đang ở đâu, mỗi người biết gì.

**Bạn sẽ thấy khác ở chỗ:**

- NPC có thể **hiểu sai**. Đây là điểm hay nhất, không phải lỗi. Quản gia có thể tin bạn lấy hành trong khi
  trong túi bạn là tỏi — và nó giữ nguyên niềm tin đó, mãi.
- Bạn **không thấy hết**. Rất nhiều chuyện xảy ra ngoài tầm mắt bạn. Đó là thiết kế.
- Mỗi lượt tốn nhiều token hơn (mỗi NPC được đánh thức là một lần gọi model). Mặc định trần 4 nhân vật
  mỗi lượt; nhân vật không liên quan thì không tốn gì.

Muốn kiểm tra chuyện gì đang diễn ra sau lưng: "Trạng thái nhiều nhân vật thế nào?" — nó cho biết ai đang
ở đâu và ai chưa từng được đánh thức.

## 8. Biến ván thành truyện ngắn

Đây là phần khác biệt nhất so với mọi app roleplay khác. Truyện **không phải** kể lại đoạn chat. Truyện là
bản văn học biên soạn từ **bản ghi của simulation**: ai đã làm gì, ai biết gì, nhân vật nào tin điều gì.

Người viết là một **agent riêng**, chỉ nhận đúng hồ sơ đã cắt theo góc nhìn. Nó không đọc được hội thoại
của bạn với quản trò.

### 8.1 Ba câu mẫu để bắt đầu

> **Viết lại ván này thành truyện ngắn, góc nhìn của tao, khoảng 1000 chữ.**

> **Viết bản góc nhìn của quản gia.**

> **Viết bản toàn tri — tao muốn biết hết.**

Không có gì bắt buộc. Nói thiếu thì trợ lý dùng mặc định (POV người chơi, cỡ vừa, giọng trung tính).

### 8.2 Chọn góc nhìn

| Bạn nói | Bạn đọc được gì | Có bị spoil không? |
|---|---|---|
| "**góc nhìn của tao**" / "POV1" | Những gì người chơi biết. Không hơn | **Không.** Bí mật không tồn tại trong hồ sơ người viết nhận |
| "**góc nhìn của [tên NPC]**" | Kiến thức, ký ức, **niềm tin (kể cả niềm tin sai)**, kế hoạch riêng của nhân vật đó | Không spoil bí mật ván, nhưng bạn sẽ thấy trong đầu NPC |
| "**góc nhìn Thiên Đạo**" / "POV2" | Tất cả: sự thật niêm phong, các con số, ý định chưa thành sự thật | **Có. Spoil toàn bộ** |
| "**toàn tri**" | Như trên, cộng bản đồ ai biết gì ở mỗi sự kiện | **Có** |

Vì lý do đó, hệ thống chỉ đưa nội dung truyện về thẳng cho bạn khi góc nhìn là **của bạn**. Muốn bản
Thiên Đạo hoặc toàn tri thì bạn phải nói rõ — và đó là lúc bạn tự chọn có spoil.

**Nếu bạn muốn so sánh:** nói "**viết cả ba góc nhìn để tao so sánh**". Nó viết song song POV người chơi,
Thiên Đạo, và từng nhân vật (tối đa 3 nhân vật). Cùng một sự thật, ba bản văn khác nhau. Đây là cách tốt
nhất để thấy hệ thống này khác gì một app chat.

### 8.3 Độ dài

| Bạn nói | Kết quả |
|---|---|
| "viết **ngắn** thôi", "khoảng 500–700 chữ" | Một cảnh, một mạch |
| "cỡ **vừa**", "tầm 1500–2000 chữ" | Hai tới bốn cảnh |
| "viết **dài**", "3000–4000 chữ" | Nhiều cảnh, có thể chia phần |

### 8.4 Giọng văn

| Bạn muốn | Nói gì | Từ khoá |
|---|---|---|
| Bình thường, rõ ràng | "giọng bình thường" | `plain` |
| Gọn, lạnh, nhiều khoảng trắng | "viết súc tích", "câu ngắn thôi" | `sparse` |
| Bay bổng, giàu hình ảnh | "viết bay bổng", "cho tao nhiều hình ảnh" | `lyrical` |
| Lạnh lùng, nghi ngờ, nặng giác quan | "giọng noir", "lạnh như tiểu thuyết đen" | `noir` |

### 8.5 Những câu dặn thêm hay dùng

Ghép vào cùng câu nói cũng được, không cần câu riêng:

- "**Bỏ mấy đoạn tao xử lý ngu.**" ← đúng thứ bạn sẽ muốn nhất
- "Đừng nhắc tới thanh căng thẳng hay con số nào."
- "Không nhắc gì ngoài truyện."
- "Gộp mấy lượt lê thê lại thành một câu."
- "Tập trung vào quan hệ giữa đầu bếp và quản gia."
- "Kể chậm thôi, tao muốn cảm giác căng."

Ví dụ một câu đầy đủ:

> **Viết lại ván này thành truyện ngắn, góc nhìn của quản gia, tầm 1500 chữ, giọng lạnh lùng, bỏ mấy đoạn tao xử lý ngu, và tập trung vào việc hắn bắt đầu nghi ngờ tao.**

### 8.6 Truyện nằm ở đâu

```
<chỗ bạn mở DSH>\roleplay-machine\runs\<tên ván>\stories\
    player.md          ← góc nhìn người chơi
    kami.md            ← góc nhìn Thiên Đạo
    omniscient.md      ← toàn tri
    npc-npc_butler.md  ← góc nhìn một nhân vật
```

Không biết tên ván thì hỏi: "ván của tao tên gì?" hoặc xem trong "Trạng thái ván".

Viết lại cùng một góc nhìn thì **ghi đè** file cũ. Hồ sơ gốc vẫn còn nguyên trong thư mục `export/`, nên
không mất gì — chỉ là bạn cần đổi tên nếu muốn giữ cả hai bản.

### 8.7 Nếu truyện hơi khô, hoặc hơi bịa

**Khô** thường vì thiếu lời kể. Trợ lý đã được dặn ghi lại lời kể sau mỗi lượt, nên bình thường bạn không
phải làm gì. Nếu ván của bạn vẫn thiếu (trợ lý quên, hoặc ván chơi từ trước khi có tính năng), nhắc:

> **Từ giờ sau mỗi lượt, ghi lại nguyên văn lời kể của mày.**

Không có bước đó thì hồ sơ chỉ có **bộ xương** (ai làm gì, ai biết gì) — vẫn viết được truyện, nhưng người
viết phải tự tô mùi vị, ánh sáng, nhịp thở. Ván đã chơi trước khi bật thì không lấy lại được lời kể cũ.

**Bịa** là bình thường và có kiểm soát: mô phỏng không mô hình hoá mùi vị hay ánh sáng, nên người viết
buộc phải thêm. Cuối mỗi tệp truyện có mục **"Chi tiết người viết tự thêm"** — đọc mục đó để biết cái gì
không có trong ván. Muốn ít bịa hơn thì viết ngắn hơn và dặn "bám sát hồ sơ".

### 8.8 Mẹo

- **Chơi ít nhất 5 lượt rồi hãy viết.** Dưới đó truyện rất mỏng, người viết chỉ có vài dòng để làm việc.
- **Viết nhiều bản rồi so.** Cùng một ván, POV người chơi và POV quản gia cho hai câu chuyện khác hẳn nhau.
- **Ván ngắn thì chọn "ngắn".** Đừng đòi 4000 chữ từ một ván 3 lượt.
- **Truyện không đổi được ván.** Viết xong rồi chơi tiếp vẫn được; cái gì xảy ra trong truyện không ảnh
  hưởng tới thế giới.

## 9. Xuất lịch sử ván ra file

Nói: **"Xuất lịch sử ván này ra file."**

Kết quả nằm ở `<chỗ bạn mở DSH>\roleplay-machine\runs\<tên ván>\export\`:

| File | Là gì | Ai đọc được |
|---|---|---|
| `story.md` | Toàn bộ ván: dòng thời gian sự thật, ai biết gì, nội tâm từng nhân vật, lời kể | **Có chứa bí mật — đừng đưa cho người đang chơi ván đó** |
| `story.json` | Cùng dữ liệu, dạng máy đọc | Dành cho ai muốn xử lý tiếp bằng phần mềm |
| `material-player.md` | Hồ sơ đã cắt cho góc nhìn người chơi | **Không chứa bí mật** |
| `material-kami.md` | Hồ sơ đã cắt cho góc nhìn Thiên Đạo | Có chứa bí mật |
| `material-npc-<tên>.md` | Hồ sơ của một nhân vật | Chỉ có thứ nhân vật đó biết |

Mấy file `material-*` chính là thứ người viết nhận được. Bạn mở ra so với `story.md` sẽ thấy rõ cái gì bị
cắt đi ở mỗi góc nhìn — đó là cách kiểm chứng "POV người chơi không thể spoil" bằng mắt thường.

Phần này **không tốn token nào**. Nó chỉ đọc lại những gì đã được ghi trong lúc chơi.

## 10. Ván của tao nằm ở đâu

```
<chỗ bạn mở DSH>\roleplay-machine\
    pool\              ← kho card (mỗi card một file)
    pool\packs\        ← các bộ 8 card hoàn chỉnh
    scenes\            ← thế giới đã rút ra
    runs\<tên ván>\
        state.json     ← trạng thái ván: lượt, thanh căng thẳng, bước thắng
        actors.json    ← trí nhớ và niềm tin riêng của từng nhân vật
        transcript.jsonl ← lịch sử từng lượt
        ending.md      ← đoạn kết, sau khi chốt ván
        export\        ← hồ sơ xuất ra (mục 9)
        stories\       ← truyện ngắn (mục 8)
```

**Ván nằm trên máy bạn, không nằm trong lịch sử chat.** Đóng trình duyệt, mở lại, nói "chơi tiếp ván cũ"
là tiếp tục được — kể cả khi cửa sổ chat đã bị xoá.

## 11. Khi có gì đó không chạy

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Trợ lý bảo "chưa có ván nào" | Bạn chưa mở ván. Nói "chơi Roleplay Machine, mode ..." |
| "Thư viện rỗng" | Chưa copy `pool-v2` vào workspace, hoặc mở DSH ở thư mục khác (mục 2) |
| Bảng Roleplay Machine không hiện ở sidebar | Xem [install.md](install.md) mục "Xử Lý Sự Cố" |
| Trợ lý không chịu viết truyện | Chưa có lượt nào trong ván — chơi ít nhất một lượt trước |
| Trợ lý không hiểu ý khi nhờ viết | Nói thẳng: "dùng skill **rp-writer**" |
| Truyện viết xong mà không thấy file | Hỏi trợ lý đường dẫn, hoặc xem `runs\<tên ván>\stories\` |
| Vào chế độ nhiều nhân vật mà NPC ngồi im | Nhân vật chưa được khai "giác quan" phù hợp. Bảo trợ lý: "khai lại cho nó nghe được chuyện trong phòng" |

## 12. Vài điều nên biết trước

- **Trợ lý là quản trò, không phải người viết truyện.** Truyện do một agent riêng viết, từ hồ sơ — nên nó
  sạch và không bị lẫn chuyện ngoài truyện.
- **Bí mật ván nằm trong file trên máy bạn.** Hệ thống cố tình không đưa bí mật vào bất kỳ kết quả lệnh
  nào, nhưng nó vẫn nằm trong hồ sơ. Đừng mở `state.json`, `actors.json`, hay `export/story.md` nếu bạn
  không muốn biết trước cái kết.
- **Chế độ nhiều nhân vật tốn token hơn hẳn.** Mỗi nhân vật được đánh thức là một lần gọi model. Nhân vật
  không liên quan thì không tốn gì, nên đừng ngại dàn đông — nhưng đừng ngạc nhiên vì hoá đơn.
- **Bảng điều khiển chưa được nhìn bằng mắt.** Nó đã được kiểm tự động (hiện đúng ba màn, che nội dung
  card niệm phong, gọi được API), nhưng bố cục và màu sắc thật thì chưa ai ngồi mở trình duyệt xem. Nếu
  thấy gì lệch, báo lại.
- **Kết thúc do máy quyết, không do bạn và không do trợ lý.** Đó là điều giữ cho ván có thắng có thua thật.
