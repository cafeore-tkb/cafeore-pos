import type React from "react";
import type { ControlViewProps } from "./ControlWorkspace";
import { DispatchBoard } from "./DispatchBoard";
import { UnassignedOrdersPanel } from "./UnassignedOrdersPanel";

// 管制盤 A：上にタイムライン、下に未割当の横帯
export const ControlViewA: React.FC<
  ControlViewProps & {
    /** 閲覧だけの画面（/master-sheet/view）。各列の「次へ」と空きスロットを出さない */
    readOnly?: boolean;
  }
> = (props) => (
  <div className="flex h-full min-h-0 flex-col gap-2">
    <DispatchBoard {...props} />
    <div className="relative z-[70] h-[196px] min-h-0 overflow-visible">
      <UnassignedOrdersPanel
        orders={props.unassignedOrders}
        nextAvailable={props.nextAvailable}
        selectedOrderId={props.selectedOrderId}
        onSelectOrder={props.onSelectOrder}
        onAssignToBay={props.onAssignToBay}
        onMergeOrders={props.onMergeOrders}
      />
    </div>
  </div>
);
