import type { PrintJob } from "../document";

/** プリンターとのつながり */
export type PrinterConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

/**
 * シールを刷るプリンター
 *
 * 印刷データ（PrintJob）を受け取り、そのプリンターの命令にして送る。
 * 機種ごとの命令・つなぎ方の違いは、これを実装する側に閉じ込める。
 * 別のプリンターを使うときは、これを実装したものを作って差し替える。
 */
export type LabelPrinter = {
  /** つなぐ。つながり具合は、作るときに渡した onStatusChange で知らせる */
  connect: () => void;
  /** つなぐのをやめる。つなぎかけのものも含め、以後のつながり具合は知らせない */
  disconnect: () => void;
  /**
   * 刷る。前に頼んだものを刷り終えてから送る。プリンターが刷れたと返したら true。
   * つながっていない（disconnected を知らせる）・失敗を返した・返事が来なかったら false
   */
  print: (job: PrintJob) => Promise<boolean>;
};

/** プリンターを作る。onStatusChange でつながり具合を知らせる */
export type CreateLabelPrinter = (
  onStatusChange: (status: PrinterConnectionStatus) => void,
) => LabelPrinter;
