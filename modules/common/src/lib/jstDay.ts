// 日本時間の日付の区切り。端末の時刻帯に関係なく、日本時間の 0:00 で日を分ける。
// サーバーの営業日（api/internal/caos/store.go の Day・ParseDay。日本時間の日付）と同じ区切りにしてある。
// 日本は夏時間が無いので、+9 時間の固定のずれで計算する（サーバーも time.FixedZone("JST", 9*60*60)）。

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** その時刻の日本時間の日付（YYYY-MM-DD）。サーバーの caos.Day と同じ */
export const jstDate = (ms: number) =>
  new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

/** その時刻を含む日本時間の日の始まり（日本時間 0:00）のエポックミリ秒。サーバーの caos.ParseDay と同じ */
export const startOfJstDay = (ms: number) =>
  Math.floor((ms + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
