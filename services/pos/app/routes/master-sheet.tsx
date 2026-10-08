import type { MetaFunction } from "react-router";
import CaosApp from "~/caos/App";
import "~/caos/caos.css";
import { CaosLanesProvider } from "~/caos/lanes/CaosLanesContext";
import { LimitedLabelProvider } from "~/caos/limitedLabel";

export const meta: MetaFunction = () => {
  return [
    { title: "CaOS — Cafeore Operating System" },
    {
      name: "description",
      content:
        "コーヒー提供現場の注文割り当てと抽出進行を一画面で管理する、タッチ操作向けオペレーティングシステム。",
    },
    { name: "theme-color", content: "#0f172a" },
  ];
};

// CaOS（ドリップ管制）。POS のヘッダーは付けず、画面全体を CaOS が使う。
// スタイルは caos.css で .caos-root の中に閉じている。
export default function MasterSheet() {
  return (
    <div className="caos-root antialiased selection:bg-blue-100">
      <LimitedLabelProvider>
        {/* ドリッパーの担当者（サーバーの今日の担当者。この画面から交代できる） */}
        <CaosLanesProvider editable>
          <CaosApp />
        </CaosLanesProvider>
      </LimitedLabelProvider>
    </div>
  );
}
