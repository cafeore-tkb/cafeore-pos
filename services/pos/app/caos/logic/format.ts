// 時間の表示

const pad2 = (value: number) => value.toString().padStart(2, "0");

/** 秒を「2:15」に（残り時間・待ち時間）。負の秒は 0 */
export const clockLabel = (sec: number) => {
  const safe = Math.max(0, Math.round(sec));
  return `${Math.floor(safe / 60)}:${pad2(safe % 60)}`;
};

/** 盤面の秒（その日の 0:00 からの秒）を「10:05:09」に。24 時を越えたら 0 時に戻す */
export const timeOfDayLabel = (sec: number) => {
  const day = ((Math.floor(sec) % 86400) + 86400) % 86400;
  return `${pad2(Math.floor(day / 3600))}:${pad2(Math.floor(day / 60) % 60)}:${pad2(day % 60)}`;
};

/** その日（端末の時刻）の 0 時（ms） */
export const startOfLocalDay = (ms: number) => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};
