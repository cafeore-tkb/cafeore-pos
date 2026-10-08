// CaOS（ドリップ管制）の抽出時間と予定時刻の決め方、その表示の文字。ここ 1 か所で決める。
//
// 抽出時間は全ドリッパー同じで、ドリッパーごとの補正はしない（services/pos/app/caos/DESIGN_REQUIREMENTS.md）。
// サーバーは抽出時間も予定時刻も持たず、カードの開始・終了の時刻だけを持つ（注文のカップの brew_started_at・brew_finished_at。
// どちらもサーバーの時刻で、サーバーが付ける）。なので Go 側に同じ値は無い。
//
// 時刻（〜Sec）は盤面の秒。その日の始まり（日本時間 0:00。./jstDay の startOfJstDay）からの秒で数える。

/** 1 杯の抽出時間（秒） */
export const ONE_CUP_BREW_SEC = 135;
/** 2 杯の抽出時間（秒）。1 回のドリップは最大 2 杯 */
export const TWO_CUP_BREW_SEC = 195;
/** 前の抽出が終わってから次の抽出を始めるまでの入れ替えの時間（秒） */
export const CHANGEOVER_SEC = 15;
/** 抽出中のカードが無いドリッパーで、先頭の待機カードを始める見込み（今から何秒後か） */
export const FIRST_START_DELAY_SEC = 10;
/** 抽出の残りがこれ以下になったら「まもなく」にする（秒） */
export const IMMINENT_SEC = 15;

/** 杯数ごとの抽出時間（秒） */
export const brewDurationSec = (cups: number) =>
  cups > 1 ? TWO_CUP_BREW_SEC : ONE_CUP_BREW_SEC;

const wholeSeconds = (seconds: number) => Math.max(0, Math.round(seconds));

/** 秒を「m:ss」にする（例 135 → "2:15"）。負は 0 にする */
export const formatMinSec = (seconds: number) => {
  const safe = wholeSeconds(seconds);
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`;
};

/** 秒を「m分s秒」にする（例 195 → "3分15秒"） */
export const formatMinSecJa = (seconds: number) => {
  const safe = wholeSeconds(seconds);
  return `${Math.floor(safe / 60)}分${safe % 60}秒`;
};

/** 杯数ごとの抽出時間の表示（例 2 杯 → "3分15秒"） */
export const brewDurationLabel = (cups: number) =>
  formatMinSecJa(brewDurationSec(cups));

/** 盤面の時刻（その日の 0:00 からの秒）を「HH:MM:SS」にする。24 時を越えたら 0 時に戻す */
export const formatClockOfDay = (seconds: number) => {
  const normalized = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(Math.floor(normalized / 3600))}:${pad(Math.floor((normalized % 3600) / 60))}:${pad(normalized % 60)}`;
};

/** 1 人のドリッパーの予定時刻 */
export interface LanePlan {
  /** 抽出中のカード：開始・終了の見込み・残り（秒） */
  brewing?: { startSec: number; endSec: number; remainingSec: number };
  /** 待機カード（並び順のまま）：開始・終了の見込み */
  queued: { startSec: number; endSec: number }[];
}

/**
 * 1 人のドリッパーの抽出中・待機カードの予定時刻を決める。
 *
 * - 抽出中のカードは、始めた時刻（分からなければ今）から抽出時間で終わる見込み。過ぎていたら今終わる見込みにする
 * - 待機カードは、前のカードの終わりから入れ替えの時間（CHANGEOVER_SEC）を挟んで順に始める
 * - 抽出中のカードが無いときは、先頭の待機カードを今から FIRST_START_DELAY_SEC 後に始める
 */
export const planLane = (
  nowSec: number,
  brewing: { startSec?: number; durationSec: number } | undefined,
  queuedDurationsSec: number[],
): LanePlan => {
  let cursor = nowSec;
  let brewingPlan: LanePlan["brewing"];
  if (brewing) {
    const startSec = brewing.startSec ?? nowSec;
    const plannedEndSec = startSec + brewing.durationSec;
    brewingPlan = {
      startSec,
      endSec: Math.max(nowSec, plannedEndSec),
      remainingSec: Math.max(0, plannedEndSec - nowSec),
    };
    cursor = brewingPlan.endSec;
  }
  const queued = queuedDurationsSec.map((durationSec, index) => {
    const startSec =
      !brewing && index === 0
        ? nowSec + FIRST_START_DELAY_SEC
        : cursor + CHANGEOVER_SEC;
    cursor = startSec + durationSec;
    return { startSec, endSec: cursor };
  });
  return { brewing: brewingPlan, queued };
};
