import type { MetaFunction } from "react-router";
import ReadOnlyBoard from "~/caos/ReadOnlyBoard";
import "~/caos/caos.css";
import { LimitedLabelProvider } from "~/caos/limitedLabel";

export const meta: MetaFunction = () => {
  return [{ title: "CaOS（閲覧のみ）" }];
};

// CaOS の盤面を閲覧だけで映す画面。注文と抽出カードが管制盤 A のタイムラインにリアルタイムで流れる。
// 操作はしない（カップへの書き込み PUT /api/caos/cups も「次へ」も送らない）ので、どの端末で開いても盤面は変わらない。
export default function MasterSheetView() {
  return (
    <div className="caos-root antialiased">
      <LimitedLabelProvider>
        <ReadOnlyBoard />
      </LimitedLabelProvider>
    </div>
  );
}
