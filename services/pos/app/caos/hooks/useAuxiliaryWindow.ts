import { useState } from "react";
import type { Board, TestPlaySession } from "../types";

// 補助のタブ（ドリッパー・豆キュー・実績）を新しいブラウザタブ（?panel=）で開く。
// 開くときに今の盤面を端末に置き（localStorage）、開いた側はそれを読んで出す（あとの変化は追わない）。

export const AUXILIARY_TABS = ["bays", "beans", "analytics"] as const;
export type AuxiliaryTab = (typeof AUXILIARY_TABS)[number];

type PanelSnapshot = {
  board: Board;
  testPlaySession: TestPlaySession | null;
};

const PANEL_SNAPSHOT_KEY = "caos-panel-snapshot-v2";

const readStandalone = () => {
  const panel = new URLSearchParams(window.location.search).get("panel");
  const tab = AUXILIARY_TABS.find((candidate) => candidate === panel) ?? null;
  if (!tab) return { tab, snapshot: undefined };
  try {
    const value = window.localStorage.getItem(PANEL_SNAPSHOT_KEY);
    return {
      tab,
      snapshot: value ? (JSON.parse(value) as PanelSnapshot) : undefined,
    };
  } catch {
    return { tab, snapshot: undefined };
  }
};

export const useAuxiliaryWindow = () => {
  // この画面が補助のタブだけを出す画面（?panel=）なら、そのタブと開いたときの盤面
  const [standalone] = useState(readStandalone);
  return {
    standaloneTab: standalone.tab,
    snapshot: standalone.snapshot,
    openInNewTab: (tab: AuxiliaryTab, snapshot: PanelSnapshot) => {
      try {
        window.localStorage.setItem(
          PANEL_SNAPSHOT_KEY,
          JSON.stringify(snapshot),
        );
      } catch {
        // Opening the panel still works with its default state if storage is unavailable.
      }
      const url = new URL(window.location.href);
      url.searchParams.set("panel", tab);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    },
  };
};
