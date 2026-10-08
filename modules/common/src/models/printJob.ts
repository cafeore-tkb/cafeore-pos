/**
 * 印刷キューの仕事 1 件（API の PrintJob を、日時を Date にしたもの）。
 * レジ・マスター・CaOS は積むだけで、「この端末で印刷する」にした端末が積んだ順に取って印刷する。
 * シールの中身は持たない。印刷する端末が、取ったときの注文から printJobLabels で作る
 */
export type PrintJob = {
  /** 積んだ順の番号。印刷はこの順 */
  id: number;
  /** order＝注文のラベル / emergency＝「緊急」のシール＋そのカップの本物と同じシール */
  kind: "order" | "emergency";
  /** cashier＝レジ / master＝マスターの緊急ボタン / caos＝CaOS の緊急の入れ直し */
  source: "cashier" | "master" | "caos";
  orderId: string;
  /** 積んだときの注文番号 */
  orderNo: number;
  /** emergency の対象のカップ */
  cupId: string | null;
  /** queued＝待ち / printing＝印刷中 / done＝済み / failed＝失敗 / canceled＝取り消し */
  status: "queued" | "printing" | "done" | "failed" | "canceled";
  printerId: string | null;
  claimedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
};

/** 印刷中のまま、この時間たっても済みにならない仕事は止まったとみなす（サーバーの printJobStaleAfter と同じ） */
export const PRINT_JOB_STALE_MS = 60_000;

/** 印刷中のまま止まった仕事か（「もう一度印刷」「取り消す」ができる） */
export const isStalePrintJob = (job: PrintJob, now: number): boolean =>
  job.status === "printing" &&
  job.claimedAt !== null &&
  now - job.claimedAt.getTime() > PRINT_JOB_STALE_MS;

/** 積んだところの呼び方 */
export const printJobSourceLabel = (source: PrintJob["source"]): string =>
  ({ cashier: "レジ", master: "マスター", caos: "CaOS" })[source];
