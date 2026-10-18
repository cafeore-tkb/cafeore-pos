import type React from "react";
import { useControlPick } from "../hooks/useUnassignedPick";
import type { ControlViewProps } from "./ControlWorkspace";
import { DispatchBoard } from "./DispatchBoard";
import { UnassignedStrip } from "./UnassignedOrdersPanel";

// 管制盤 A：上にタイムライン、下に未割当の横帯（残りの高さを使い、先の注文はスクロールで見る）。
// 未割当をたたんだら（閲覧の画面）、空いた高さはタイムラインが使う。
// 未割当のカードの操作は横帯とタイムラインで共有する（開いた未割当のカードを、タイムラインの抽出中のカードを押して統合する）
export const ControlViewA: React.FC<ControlViewProps> = (props) => {
  const pick = useControlPick(props);
  const folded = props.unassignedFold?.folded ?? false;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DispatchBoard {...props} pick={pick} fill={folded} />
      <div className={`relative z-[70] ${folded ? "" : "min-h-0 flex-1"}`}>
        <UnassignedStrip
          orders={props.unassignedOrders}
          looks={props.looks}
          nowMs={props.nowMs}
          nextAvailable={props.nextAvailable}
          selectedOrderId={props.selectedOrderId}
          pick={pick}
          readOnly={props.readOnly}
          fold={props.unassignedFold}
          unfinished={props.unfinished}
        />
      </div>
    </div>
  );
};
