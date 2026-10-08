// 日本時間。営業は日本でしかしないので、端末の時刻帯に関係なく日本時間で日付と時刻を決める。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の日付（YYYY-MM-DD） */
export const jstDate = (ms: number) =>
  new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

/** 日本時間の時刻（HH:mm:ss） */
export const jstClock = (ms: number) =>
  new Date(ms + JST_OFFSET_MS).toISOString().slice(11, 19);

/** その日（日本時間）の 0 時 */
export const jstDayStart = (ms: number) =>
  Date.parse(`${jstDate(ms)}T00:00:00+09:00`);
