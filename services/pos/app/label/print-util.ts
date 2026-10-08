import {
  type CupLabel,
  type Label,
  type OrderEntity,
  type OrderSummaryLabel,
  emergencyLabels,
  orderLabels,
} from "@cafeore/common";
import { useRef } from "react";
import { useRawPrinter } from "./printer";

// ラベルの中身は @cafeore/common の label.ts で作り、ここでプリンターの命令にする。
// レジの会計のラベルも緊急のシールも同じ作り方なので、緊急で出すシールは本物と全く同じになる。
// 印刷は同じ iPad の中の待ち行列で 1 件ずつ送り、前の印刷の返事を待ってから次を送る
// （会計のラベルと緊急のシールが重なっても、命令が混ざったり抜けたりしない）。

export const usePrinter = () => {
  const rawPrinter = useRawPrinter();
  // 待ち行列の最後の印刷
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  // カップに貼るシール
  const addCupLabel = (label: CupLabel) => {
    rawPrinter.feedCurrentTop();
    rawPrinter.addPageBegin();
    rawPrinter.addPageArea(0, 24, 570, 230);

    rawPrinter.addPagePosition(0, 48);
    rawPrinter.addHeader(label.orderNo, null);
    rawPrinter.addPagePosition(0, 108);
    rawPrinter.addLine(label.name, [1, 2]);
    rawPrinter.addPagePosition(0, 156);
    rawPrinter.addLine(`${label.index}/${label.total}`, [2, 1]);
    rawPrinter.addPagePosition(0, 204);
    if (label.assignee) {
      rawPrinter.addLine(`指名： ${label.assignee}`, [1, 1]);
    } else {
      rawPrinter.addLine("　", [1, 1]);
    }
    rawPrinter.addPagePosition(230, 204);
    rawPrinter.addLogo();
    rawPrinter.addPageEnd();
  };

  // 引換券に貼るシール（番号と注文）
  const addSummaryLabel = (label: OrderSummaryLabel) => {
    rawPrinter.addHeader(label.orderNo, label.total);
    for (const { name, assignee } of label.assigned) {
      rawPrinter.addLine(name, [1, 1]);
      rawPrinter.addLine(`  指名：${assignee}`, [1, 1]);
    }
    for (const line of label.lines) {
      rawPrinter.addLine(line, [1, 1]);
    }
  };

  // 緊急の目印のシール（「緊急」とだけ書く）。カップのシールと同じ大きさの 1 枚
  const addEmergencyLabel = () => {
    rawPrinter.feedCurrentTop();
    rawPrinter.addPageBegin();
    rawPrinter.addPageArea(0, 24, 570, 230);
    rawPrinter.addPagePosition(0, 170);
    rawPrinter.addLine("緊急", [4, 4]);
    rawPrinter.addPageEnd();
  };

  const addLabel = (label: Label) => {
    switch (label.type) {
      case "cup":
        addCupLabel(label);
        return;
      case "summary":
        addSummaryLabel(label);
        return;
      case "emergency":
        addEmergencyLabel();
        return;
    }
  };

  /** ラベルを待ち行列に入れて印刷する。印刷できたかを返す */
  const printLabels = (labels: Label[]): Promise<boolean> => {
    const job = () => {
      rawPrinter.init();
      for (const label of labels) addLabel(label);
      rawPrinter.addFeed(7);
      return rawPrinter.print();
    };
    const run = queueRef.current.then(job, job);
    queueRef.current = run.catch(() => false);
    return run;
  };

  /** レジの会計のラベル（カップごとのシールと、引換券に貼るシール）。保存を待たずにすぐ印刷する */
  const printOrderLabel = (order: OrderEntity) => {
    void printLabels(orderLabels(order));
  };

  /**
   * 緊急のシール：「緊急」のシール → そのカップの本物と全く同じシール。印刷できたかを返す
   * （シールの無いカップは印刷せず false）
   */
  const printEmergencyLabel = (order: OrderEntity, cupId: string) => {
    const labels = emergencyLabels(order, cupId);
    return labels ? printLabels(labels) : Promise.resolve(false);
  };

  return { status: rawPrinter.status, printOrderLabel, printEmergencyLabel };
};
