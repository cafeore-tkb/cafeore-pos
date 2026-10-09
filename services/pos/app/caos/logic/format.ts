// 時間の表示。時刻（日本時間の「10:05:09」）は @cafeore/common の jstClock

const pad2 = (value: number) => value.toString().padStart(2, "0");

/** 秒を「2:15」に（残り時間・待ち時間）。負の秒は 0 */
export const clockLabel = (sec: number) => {
  const safe = Math.max(0, Math.round(sec));
  return `${Math.floor(safe / 60)}:${pad2(safe % 60)}`;
};
