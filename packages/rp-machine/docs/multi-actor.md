# Multi-Actor-Agent Mode

Mỗi nhân vật trong thế giới là **một subagent DSH độc lập**, chỉ biết những gì nó được phép biết. Thế
giới không nằm trong đầu ai cả — nó nằm ngoài, do code sở hữu, và mỗi actor nhìn nó qua một cửa sổ khác
nhau.

## 1. Vì sao DSH làm được điều này

Spec §16 nói cách làm SAI là nhét toàn bộ world lore vào prompt rồi dặn "hãy giả vờ mày chỉ biết những
thứ này". DSH có sẵn bốn primitive để làm đúng:

| Primitive | Dùng làm gì |
|---|---|
| `ctx.subagents.start('spawn', …)` | Mỗi actor một child agent riêng. Đường này là một chiều: cha đưa vào, con trả ra. |
| `persona` | Danh tính actor, shadow `deployment:persona-prefix` **chỉ cho đứa con đó** |
| `toolFilter` | Actor không gọi được tool nào của plugin — không đọc được canon, không ghi được gì |
| `outputSchema` + `result.structured` | Actor trả JSON có schema, chờ được, và chạy song song được |

**Quyết định quan trọng nhất: dùng provider `spawn`, tuyệt đối không dùng `fork`.** Provider `fork` có
`inheritsParentContext: true` — nó **copy conversation của cha vào con**, mà conversation của cha chính là
kênh GM có đầy đủ `hiddenTruth`. Chỉ cần đổi provider là toàn bộ §1–§30 của spec sụp đổ. Đây là ràng buộc
kiến trúc, không phải quy ước.

## 2. Ranh giới code / model

Nguyên tắc: **model đề xuất, code quyết.** Cùng tinh thần với hai trục OOC/tension đã có.

| Việc | Ai làm | Vì sao |
|---|---|---|
| Định tuyến tri giác | **code** | Phải tất định, tái lập được, và kiểm được không cần model |
| Chọn actor thức/ngủ | **code** | Đây là cơ chế kiểm soát chi phí; để model quyết thì mỗi lượt gọi hết |
| Diễn giải + ý định của actor | **model** (subagent) | Đây là chỗ cần suy luận, và là chỗ actor được phép sai |
| Phán OOC, đếm bước thắng, ngưỡng thua | **code** | Đã có từ trước; không đổi |
| Duyệt event, commit world state | **code** | Ý định không được tự thành canon (§10, §27) |
| Quyết định "thực ra chuyện gì xảy ra" khi mơ hồ | **main agent** | Xem quyết định 3 bên dưới |
| Viết lời kể | **main agent** | Chỉ thấy event mà người chơi được thấy |

## 3. Năm quyết định spec không nói rõ

### 3.1 Actor session là one-shot mỗi lần thức; ký ức actor do plugin sở hữu

DSH có hai đường: `startContinuable()` giữ session bền, và `start()` một lần rồi trả kết quả. Continuable
đúng tinh thần §24 hơn, nhưng tài liệu DSH nói rõ **"continuable conversations have no run at all"** —
không có `result` để chờ, nên muốn lấy câu trả lời của actor phải dựng thêm một đường quan sát session.
Trong khi đó `start()` cho `result.structured` chờ được và `Promise.all` được.

Chọn `start()` một lần cho MVP, ký ức actor nằm trong state của plugin và được tái tạo mỗi lần thức.
Đổi lại được một thứ quan trọng hơn: **ta kiểm soát chính xác từng chuỗi đi vào context của actor** —
đúng yêu cầu cốt lõi của §16. Với session bền, lịch sử hội thoại tích lũy dần và không ai kiểm được nó.

Nâng lên continuable là việc của M4 nếu thấy cần, và khi đó phải giải bài toán quan sát kết quả.

### 3.2 Resolver không được là subagent

Resolver cần thấy secret state + ý định của mọi actor. Nếu nó là subagent thì session của nó chứa toàn bộ
sự thật, và người chơi mở trajectory ra là đọc được hết. Vì vậy: **code commit event**, còn main agent
(vốn đã hợp pháp giữ kênh GM) chỉ phân xử chỗ mơ hồ.

### 3.3 Belief không bao giờ được tự sửa thành sự thật

Spec §18 nói NPC được phép sai và đó là feature. Cách cưỡng chế: **không tồn tại đường code nào ghi từ
canonical state vào belief**. Quản gia tin người chơi lấy hành trong khi túi có tỏi — và nó giữ nguyên
niềm tin đó cho tới khi có quan sát mới.

### 3.4 Mất mát thông tin là tất định theo seed

Cùng một ván chạy lại cho cùng kết quả định tuyến, cùng đoạn nghe loáng thoáng. Nhờ vậy test kiểm được
nó, và bug định tuyến tái hiện được.

### 3.5 Chỗ đứng nửa trong nửa ngoài

"Đứng ở ngưỡng cửa bếp" là một tình huống thật nhưng nếu mô hình hoá thành phòng riêng thì người đó
không nghe được gì. Thêm `sameRoomAs` vào địa điểm: vẫn là chỗ riêng để mô tả, nhưng tính là cùng phòng
khi định tuyến tri giác.

## 4. Bốn tầng dữ liệu (§25) và chúng nằm ở đâu

| Loại | Ví dụ | Nằm ở đâu | Ai đọc |
|---|---|---|---|
| Canonical truth | Tỏi trong túi người chơi | `WorldState` | code + main agent |
| Actor knowledge | Quản gia thấy người chơi ra khỏi kho | `ActorState.memory` | chỉ actor đó |
| Actor belief | Quản gia nghĩ người chơi lấy hành | `ActorState.beliefs` | chỉ actor đó |
| Actor intent | Quản gia muốn lục túi | output của actor | Resolver xét, chưa là gì |

`allowedKnowledge` **không** được copy vào state: nó là hằng số của định nghĩa actor, chỉ đọc lúc dựng
payload. State chỉ chứa thứ thay đổi được.

## 5. Những gì đã xong (M1)

Module trong `packages/rp-machine/src/actor/`:

| File | Việc |
|---|---|
| `model.ts` | Định nghĩa actor, state, world state, bốn loại dữ liệu, `sameRoomAs`, niêm phong hai chiều |
| `perception.ts` | Định tuyến tri giác: `full` / `muffled` / `presence` / `none`, mất mát tất định theo seed |
| `payload.ts` | **Hạt nhân cô lập**: hàm duy nhất dựng input cho actor, `assertIsolated()` là chốt chặn, schema output, parse output |
| `wake.ts` | Năm điều kiện đánh thức của §15, trần chi phí, ghi ký ức **chỉ cho actor thức** |

**32 test** trong `tests/actor-isolation.spec.ts` phủ cả **8 acceptance test của §28** — và không test nào
gọi model. Đó là điểm mạnh của cách làm này: cô lập thông tin là thuộc tính kiến trúc, nên soi payload
dựng ra là kiểm được.

| Test §28 | Kết quả |
|---|---|
| 1 — Information isolation | Lucien không biết có hiệp sĩ; chốt chặn có răng (nhét bí mật vào là ném lỗi) |
| 2 — Private memory | Quản gia nghe thì nhớ, Lucien không nghe thì không; 5 lượt sau Lucien vẫn nhớ claim cũ |
| 3 — Secret action | Lấy tỏi khi chỉ có một mình: duy nhất lâu đài biết; Lucien không biết kể cả khi gặp lại |
| 4 — Conflicting beliefs | Canonical nói tỏi, quản gia tin hành, không ai sửa nó |
| 5 — Parallel reactions | Một hành động đánh thức ba actor với ba mức quan sát khác nhau |
| 6 — Intent versus canon | Actor muốn giết người chơi cũng không đổi được một byte world state |
| 7 — Sleeping actors | Actor ngoài tầm không được gọi, không nhận ký ức, lượt thức vẫn rỗng |
| 8 — No secret leakage | Prompt của mọi actor sạch bí mật và sạch dữ liệu actor khác |

## 6. Những gì đã xong (M2 — Resolver và phát chọn lọc)

| File | Việc |
|---|---|
| `events.ts` | Từ vựng sự thật: 8 loại event, `validateEvent` là hàng rào duy nhất giữa "model đề xuất" và "thế giới đổi" |
| `resolve.ts` | `commitEvents` (commit theo thứ tự, event sau kiểm trên state đã đổi), `proposeEvents`, `commitActorBeliefs`, điều kiện kết thúc có cấu trúc |
| `broadcast.ts` | Phát chọn lọc: ai nhận sự thật, ở mức nào; `private` không bao giờ tới narrator |

Ba luật được cưỡng chế bằng code, không bằng lời dặn:

1. **Lời nói tự thành canon; mọi thứ khác thì không.** `dialogue`/`question`/`command` ⇒ một
   `npc_dialogue` công khai. `attack`, `move`, `conceal`… ⇒ một `observation` **riêng tư**, không đổi một
   byte state. Muốn hệ quả thành thật thì phải có event riêng qua kiểm.
2. **Không bịa trait mới, không delta quá 3, không nhảy phòng không kề, không xuyên cửa niêm phong, không
   lấy quá số đồ đang có.** Tất cả nằm trong `validateEvent`.
3. **Một sự thật chỉ tới tay người tri giác được nó.** `routeCanonicalEvents` chạy đúng ma trận tri giác
   của M1, nhưng trên event do NPC sinh ra: hét trong hầm niêm phong thì người chơi không nhận gì, người
   cùng hầm vẫn nghe rõ.

Thêm một cơ chế mới ở M2: **tri giác còn nợ** (`pending`). Actor ngủ mà nghe được sự thật thì thông tin
đó không bị mất và cũng không bị nhét vào đầu nó lúc đang ngủ — nó được đánh thức ở lượt sau. Nhờ vậy một
cuộc nói chuyện giữa hai NPC không đứng im khi người chơi không làm gì, mà cũng không tạo vòng lặp vô tận
(actor đã thức trong lượt không nhận lại cùng thông tin ở lượt sau).

## 7. Những gì đã xong (M3 — chạy thật)

| File | Việc |
|---|---|
| `session.ts` | Adapter `ctx.subagents`: ba chốt chặn cứng, runner thật, runner giả cho test |
| `turn.ts` | Pipeline 9 bước một lượt; bản ghi riêng cho Thiên Đạo; lưu/đọc `runs/<id>/actors.json` |
| `setup.ts` | Kiểm khai báo dàn actor trước khi dựng thế giới |
| tools | `rp_actor_cast`, `rp_actor_turn`, `rp_actor_state` |

Ba chốt chặn của adapter — cả ba **từ chối chạy** thay vì chạy nửa vời:

| Chốt | Vì sao |
|---|---|
| Provider phải có capability `toolFilter` | Không xoá được tool thì actor đọc thẳng được pool card, kể cả `hidden_truth` |
| Luôn gửi `toolFilter: { allow: [] }` | Xoá sạch tool toàn cục. Tool scoped của chính con (`structured_output`) vẫn còn nên nó vẫn trả được kết quả |
| Provider không được `inheritsParentContext` | `fork` chép nguyên hội thoại cha vào con — tức là chép cả kênh GM |

Và một lỗ rò được bịt trong cùng phase này: **kênh GM trước đây gắn cho mọi agent**, kể cả subagent. Nghĩa
là actor — vốn là subagent — sẽ đọc được `hiddenTruth` ngay trong system prompt của mình, và toàn bộ cô lập
sụp đổ. Luật mới: chỉ agent cấp cao nhất (`origin !== 'subagent'`) nhận khung GM.

Kết quả tool luôn là **công khai** (transcript là nơi người chơi đọc). Diễn biến riêng của actor đi qua
kênh kín `rp-machine.actors` trong systemPrompt, cùng đường với `hiddenTruth`, và có test khẳng định nó
không xuất hiện trong kết quả tool.

## 8. Các phase còn lại

| Phase | Nội dung | Xong khi |
|---|---|---|
| **M1** ✅ | Actor model, perception router, hạt nhân cô lập, wake rules | 32 test phủ 8 acceptance test, không cần model |
| **M2** ✅ | Canonical event vocabulary + Resolver + phát chọn lọc | Ý định không hợp lệ bị từ chối; belief không tự thành canon |
| **M3** ✅ | Adapter subagent `spawn` + pipeline một lượt + 3 tool actor | Chạy được một lượt với actor gọi song song, chốt chặn cấu hình có răng |
| **M4** | Nạp cast từ scene (`actorMode`), skill, UI danh sách actor, chạy thật trong DSH | Bật/tắt được mode; chơi thật trong DSH |
| **M5** | Preset DSH riêng cho actor để system prompt của con ngắn nhất có thể; cân nhắc `startContinuable` | Prompt của actor chỉ còn persona + payload |

## 9. Chi phí và rủi ro

- **Model call mỗi lượt.** Trần mặc định 4 actor thức; actor ngủ tốn 0. Nhưng một lượt nhiều actor vẫn
  đắt hơn hẳn mode một model. Wake rules và trần là cơ chế kiểm soát, không phải trang trí.
- **Độ trễ.** Actor gọi song song nên độ trễ là của actor chậm nhất, không phải tổng.
- **Trust mode vẫn là trust mode.** State của actor trên đĩa (`runs/<id>/actors.json`) chứa niềm tin và
  kế hoạch riêng của **mọi** actor. Nó cùng mức nhạy cảm với kênh GM: người chơi tự nguyện không mở. Muốn
  kín hơn thì phải giải cùng bài toán như sealed mode.
- **Actor có thể bịa.** Output không hợp lệ bị hạ cấp về `wait` chứ không ném lỗi, và không đụng được
  canon — nên cái xấu nhất là một lượt nhạt, không phải một ván hỏng.
- **Prompt của actor vẫn còn dấu vết của host.** `persona` chỉ shadow phần persona của deployment, nên con
  vẫn thấy các khối danh tính/môi trường chung của DSH. Chúng không chứa bí mật của ván (chốt chặn
  `assertIsolated` bảo đảm điều đó), nhưng làm giọng nhập vai loãng hơn. Cách sửa đúng là một preset DSH
  riêng cho actor — việc của M5.
- **Một lượt = một session mới cho mỗi actor thức.** Đắt hơn session bền nếu actor được đánh thức liên
  tục, nhưng đổi lại kiểm soát được chính xác từng chuỗi vào context. Trần `maxAwake` là van chi phí.
