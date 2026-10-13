import type { MetaFunction } from "react-router";
import ReadOnlyBoard from "~/caos/ReadOnlyBoard";
import "~/caos/caos.css";
import { CaosLanesProvider } from "~/caos/hooks/useCaosLanes";
import { useFixedViewport } from "~/caos/hooks/useFixedViewport";

export const meta: MetaFunction = () => {
  return [{ title: "CaOS（閲覧のみ）" }];
};

// CaOS の盤面を閲覧だけで映す画面。操作はしないので、どの端末で開いても盤面は変わらない。
export default function MasterSheetView() {
  useFixedViewport();
  return (
    <div className="caos-root antialiased">
      {/* ドリッパーの担当者は表示だけ（交代はしない） */}
      <CaosLanesProvider>
        <ReadOnlyBoard />
      </CaosLanesProvider>
    </div>
  );
}
