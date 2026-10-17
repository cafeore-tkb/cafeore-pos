import type { MetaFunction } from "react-router";
import DeliverBoard from "~/caos/DeliverBoard";
import "~/caos/caos.css";
import { CaosLanesProvider } from "~/caos/hooks/useCaosLanes";
import { useFixedViewport } from "~/caos/hooks/useFixedViewport";

export const meta: MetaFunction = () => {
  return [{ title: "CaOS ドリップ完了の報告" }];
};

// ドリッパーが淹れたカップを提供へ持って行ったときに、提供に置いた端末で報告する画面
export default function MasterSheetDeliver() {
  useFixedViewport();
  return (
    <div className="caos-root antialiased">
      {/* ドリッパーの担当者は表示だけ（交代はしない） */}
      <CaosLanesProvider>
        <DeliverBoard />
      </CaosLanesProvider>
    </div>
  );
}
