/// <reference lib="dom" />
/**
 * Khai báo cho tài nguyên không phải TypeScript mà client dùng.
 *
 * `lib.dom` được kéo vào ở đây vì `tsconfig.base.json` chỉ bật `lib: ["ES2023"]`
 * (toàn bộ plugin còn lại chạy trên Node), trong khi nửa trình duyệt cần
 * `fetch`, `AbortSignal`, `document` và `window`.
 *
 * CSS được esbuild nạp bằng loader `text`, nên nó về tay ta dưới dạng chuỗi
 * (xem `styles.css` + `apply` trong `index.tsx`), không phải một module có class.
 */
declare module '*.css' {
  const text: string
  export default text
}
