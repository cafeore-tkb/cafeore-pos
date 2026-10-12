import type { MetaFunction } from "react-router";
import LiberoBoard from "~/caos/LiberoBoard";
import "~/caos/caos.css";
import { CaosLanesProvider } from "~/caos/hooks/useCaosLanes";

export const meta: MetaFunction = () => {
  return [{ title: "CaOS リベロビュー" }];
};

// リベロ（ドリッパーにお湯を持って回る係）が見る、CaOS の閲覧だけの画面。入れ始めてからの時間が長いドリッパーが一目で分かる
export default function MasterSheetLibero() {
  return (
    <div className="caos-root antialiased">
      {/* ドリッパーの担当者は表示だけ（交代はしない） */}
      <CaosLanesProvider>
        <LiberoBoard />
      </CaosLanesProvider>
    </div>
  );
}
