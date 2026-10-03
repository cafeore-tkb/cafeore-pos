// オーダーストップの目安。sohosai-analysis の店舗運営ダッシュボード（T-72）の規則を写したもの。
//
// * 混雑度（stack）= まだ提供可能になっていない注文のドリンク杯数（物販は数えない）
// * 新しい注文の提供時間の見込み = stack モデル `max(slope · (stack − a1) + c1, c1)` [分]
// * 見込みが 15 分を超えたら止める。止めたら 13 分を下回るまで止めたまま
//
// **目安を出すだけで、自動では止めない。** 止めるかどうかはマスターが決める。

/** 当てはめ済みの stack モデル */
export type StackModel = {
  /** 折れ点 [杯]。これより少ないと提供時間は c1 で頭打ち */
  a1: number;
  /** 空いているときの提供時間 [分] */
  c1: number;
  /** 1 杯増えるごとに延びる提供時間 [分/杯] */
  slope: number;
};

/**
 * 祭 4 日（2024-11-03・04 / 2025-11-02・03）で当てはめた stack モデル。
 * sohosai-analysis の docs/python-track.md §19-2 の 4 行目（stack_fits.csv）。
 * 学習日の人数（5 人と 6 人）が混ざるので、人数で傾きを差し替えず実効傾きをそのまま使う。
 */
export const FESTIVAL_STACK_MODEL: StackModel = {
  a1: 6.035,
  c1: 6.3,
  slope: 0.4665,
};

/** 止める目安 [分]（T-72 の既定値） */
export const STOP_MIN = 15;
/** 再開の目安 [分]。止める目安 − 2 分（T-72 の決定 9） */
export const RESUME_MIN = 13;

/** 混雑度から、新しい注文の提供時間の見込み [分] */
export const serviceMin = (model: StackModel, stack: number) =>
  Math.max(model.slope * (stack - model.a1) + model.c1, model.c1);

/**
 * いま止めておくべきか。
 * @param stopped いま止めているか。止めているときは再開の目安を下回るまで止めたままにする
 */
export const shouldStop = (
  model: StackModel,
  stack: number,
  stopped: boolean,
  stopMin = STOP_MIN,
  resumeMin = RESUME_MIN,
) => {
  const service = serviceMin(model, stack);
  return stopped ? service >= resumeMin : service > stopMin;
};

/** 見込みが `minutes` 分になる混雑度 [杯]。画面に「何杯で止める」を出すのに使う */
export const stackAt = (model: StackModel, minutes: number) =>
  model.a1 + (minutes - model.c1) / model.slope;
