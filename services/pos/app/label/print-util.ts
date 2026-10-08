import type { CupLabel, Label, OrderSummaryLabel } from "@cafeore/common";
import { useRawPrinter } from "./printer";

/**
 * シール（@cafeore/common の Label）をプリンターの命令にして印刷する。
 * シールの中身は @cafeore/common の orderLabels・emergencyLabels（printJobLabels）が作る。
 * レジの会計のラベルも緊急のシールも、ここで同じように印刷するので、緊急で印刷し直すシールは本物と全く同じになる。
 */
export const usePrinter = () => {
  const rawPrinter = useRawPrinter();

  // カップに貼るシール（1 枚ずつ、ページの決まった位置に書く）
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
    if (label.assignment) {
      rawPrinter.addLine(`指名： ${label.assignment}`, [1, 1]);
    } else {
      rawPrinter.addLine("　", [1, 1]);
    }
    rawPrinter.addPagePosition(230, 204);
    rawPrinter.addLogo();
    rawPrinter.addPageEnd();
  };

  // 引換券に貼るシール（番号・金額と注文の中身）
  const addSummaryLabel = (label: OrderSummaryLabel) => {
    rawPrinter.addHeader(label.orderNo, label.total);
    for (const { name, assignment } of label.assigned) {
      rawPrinter.addLine(name, [1, 1]);
      rawPrinter.addLine(`  指名：${assignment}`, [1, 1]);
    }
    for (const line of label.lines) {
      rawPrinter.addLine(line, [1, 1]);
    }
  };

  // 緊急の目印のシール（「緊急」とだけ大きく書く）。本物と同じシールの前に 1 枚出す
  const addEmergencyMark = () => {
    rawPrinter.feedCurrentTop();
    rawPrinter.addPageBegin();
    rawPrinter.addPageArea(0, 24, 570, 230);
    rawPrinter.addPagePosition(160, 160);
    rawPrinter.addLine("緊急", [4, 4]);
    rawPrinter.addPageEnd();
  };

  /**
   * シールを順に印刷する。プリンターが印刷し終えたら解決し、印刷できなかったら理由を付けて失敗する
   */
  const printLabels = async (labels: Label[]) => {
    rawPrinter.init();
    for (const label of labels) {
      switch (label.type) {
        case "cup":
          addCupLabel(label);
          break;
        case "summary":
          addSummaryLabel(label);
          break;
        case "emergency":
          addEmergencyMark();
          break;
      }
    }
    rawPrinter.addFeed(7);
    await rawPrinter.print();
  };

  return {
    status: rawPrinter.status,
    connect: rawPrinter.connect,
    printLabels,
  };
};
