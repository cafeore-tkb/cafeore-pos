import type { MetaFunction } from "react-router";
import LiberoBoard from "~/caos/LiberoBoard";
import { useCaosActivityLog } from "~/caos/hooks/useCaosActivityLog";
import "~/caos/caos.css";
import { CaosLanesProvider } from "~/caos/hooks/useCaosLanes";
import { useFixedViewport } from "~/caos/hooks/useFixedViewport";

export const meta: MetaFunction = () => {
  return [{ title: "CaOS リベロビュー" }];
};

// リベロ（ドリッパーにお湯を持って回る係）が見る、CaOS の閲覧だけの画面。6列で抽出中の残り時間と次の注文を表示する
export default function MasterSheetLibero() {
  useFixedViewport();
  useCaosActivityLog();
  return (
    <div className="caos-root antialiased">
      {/* ドリッパーの担当者は表示だけ（交代はしない） */}
      <CaosLanesProvider>
        <LiberoBoard />
      </CaosLanesProvider>
    </div>
  );
}
