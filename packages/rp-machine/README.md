# dsh-roleplay-machine

Plugin DSH cho Roleplay Machine: rút card ngẫu nhiên lắp thế giới, thẻ ẩn nhân vật chính, chaos scale, cổng
chống OOC và máy trạng thái thắng/thua.

Gói này là phần chạy trong DSH. Hướng dẫn cài và chơi nằm ở [README của repo](../../README.md) và
[docs/install.md](../../docs/install.md).

```powershell
pnpm --filter dsh-roleplay-machine build
pnpm --filter dsh-roleplay-machine typecheck
```

Sản phẩm build là một file ESM duy nhất `lib/index.js` (mọi import tương đối đã được nội tuyến), vì DSH dùng
`import()` native và Node ESM không tự thêm đuôi file cho import tương đối.

Hai gói do host cấp sẵn và được khai báo `external`: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-skill-filesystem`.
