import type { MetaFunction } from "react-router";
import ReadOnlyBoard from "~/caos/ReadOnlyBoard";
import { useCaosActivityLog } from "~/caos/hooks/useCaosActivityLog";
import "~/caos/caos.css";
import { CaosLanesProvider } from "~/caos/hooks/useCaosLanes";

export const meta: MetaFunction = () => {
  return [{ title: "CaOS（閲覧のみ）" }];
};

// CaOS の盤面を閲覧だけで映す画面。操作はしないので、どの端末で開いても盤面は変わらない。
export default function MasterSheetView() {
  useCaosActivityLog();
  return (
    <div className="caos-root caos-view-root antialiased">
      {/* ドリッパーの担当者は表示だけ（交代はしない） */}
      <CaosLanesProvider>
        <ReadOnlyBoard />
      </CaosLanesProvider>
    </div>
  );
}
