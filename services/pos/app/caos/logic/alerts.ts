import type { CaosCard } from "@cafeore/common";

// 入れ忘れ・「次へ」の押し忘れ・割り当て忘れに気づくための知らせ。しきい値はここだけで決める。

/** 予定の抽出時間をこれだけ（秒）過ぎても「次へ」が押されていない抽出は、入れ忘れか押し忘れかもしれない（列の番号を点滅させ、音で知らせる。logic/queue の laneStatus） */
export const FORGOTTEN_BREW_SEC = 120;

/** 受けてからこれだけ（秒）たっても未割当のカードに、待っている時間の札を付ける */
const LONG_WAIT_SEC = 300;

/** 長く待っている未割当のカードなら、受けてから（入れ直しは入れ直してから）の分。ほかは null。統合したカードはいちばん早いカップから数える（入れ直しは入れ直しどうしでしか統合しないので、注文と入れ直しの時刻は混ざらない） */
export const longWaitMinutes = (card: CaosCard, nowMs: number) => {
  if (card.status !== "unassigned") return null;
  const orderedMs = Math.min(
    ...card.cups.map((cup) => cup.orderedAt.getTime()),
  );
  const waitedSec = (nowMs - orderedMs) / 1000;
  return waitedSec >= LONG_WAIT_SEC ? Math.floor(waitedSec / 60) : null;
};
