import type { MetaFunction } from "react-router";
import CaosApp from "~/caos/App";
import "~/caos/caos.css";
import { CaosLanesProvider } from "~/caos/hooks/useCaosLanes";
import { useFixedViewport } from "~/caos/hooks/useFixedViewport";
import { LastActionProvider } from "~/caos/hooks/useLastAction";

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
  useFixedViewport();
  return (
    <div className="caos-root antialiased selection:bg-blue-100">
      {/* 「直前の操作」（盤面の操作と担当者の交代が同じものに覚える）と、ドリッパーの担当者（サーバーの今日の担当者。この画面から交代できる） */}
      <LastActionProvider>
        <CaosLanesProvider editable>
          <CaosApp />
        </CaosLanesProvider>
      </LastActionProvider>
    </div>
  );
}
