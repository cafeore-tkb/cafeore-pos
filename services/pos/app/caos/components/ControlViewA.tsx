import type React from "react";
import type { ControlViewProps } from "./ControlWorkspace";
import { DispatchBoard } from "./DispatchBoard";
import { UnassignedStrip } from "./UnassignedOrdersPanel";

// 管制盤 A：上にタイムライン、下に未割当の横帯（下の段のカードの 1〜6 のボタンが出る分を、画面の下に空けておく）
export const ControlViewA: React.FC<ControlViewProps> = (props) => (
  <div className="flex h-full min-h-0 flex-col gap-2">
    <DispatchBoard {...props} />
    <div className="relative z-[70] h-[190px] overflow-visible">
      <UnassignedStrip
        orders={props.unassignedOrders}
        lanes={props.lanes}
        looks={props.looks}
        nextAvailable={props.nextAvailable}
        selectedOrderId={props.selectedOrderId}
        onSelectOrder={props.onSelectOrder}
        onAssignToBay={props.onAssignToBay}
        onMergeOrders={props.onMergeOrders}
        onSplitCup={props.onSplitCup}
        onCancelEmergency={props.onCancelEmergency}
        readOnly={props.readOnly}
      />
    </div>
  </div>
);
