import type { CaosCard } from "@cafeore/common";
import { useState } from "react";
import type { SessionSnapshot } from "./useCaosSession";

// 補助のタブ（ドリッパー・豆キュー・実績）を新しいブラウザタブ（?panel=）で開く。
// 本番の盤面は開いた側も cafeore-pos の注文から自分で読む。実データテスト中は練習の盤面がもとの画面にしか無いので、
// 開くときにそのときのカードと実績を端末に置き（localStorage）、開いた側はそれを読んで出す（あとの変化は追わない）。

const AUXILIARY_TABS = ["bays", "beans", "analytics"] as const;
export type AuxiliaryTab = (typeof AUXILIARY_TABS)[number];

const PANEL_SNAPSHOT_KEY = "caos-panel-snapshot-v3";

// JSON にすると時刻（Date）が文字列になるので、カードとカップの時刻を Date に戻す（実データの注文の時刻は文字列のまま）
const toDate = (value: unknown) =>
  typeof value === "string" ? new Date(value) : null;
const reviveCard = (card: CaosCard): CaosCard => ({
  ...card,
  startedAt: toDate(card.startedAt),
  finishedAt: toDate(card.finishedAt),
  state: {
    ...card.state,
    brewStartedAt: toDate(card.state.brewStartedAt),
    brewFinishedAt: toDate(card.state.brewFinishedAt),
  },
  cups: card.cups.map((cup) => ({
    ...cup,
    readyAt: toDate(cup.readyAt),
    servedAt: toDate(cup.servedAt),
    state: {
      ...cup.state,
      brewStartedAt: toDate(cup.state.brewStartedAt),
      brewFinishedAt: toDate(cup.state.brewFinishedAt),
    },
  })),
});

const reviveSnapshot = (snapshot: SessionSnapshot): SessionSnapshot => ({
  ...snapshot,
  cards: snapshot.cards.map(reviveCard),
});

const readStandalone = () => {
  const panel = new URLSearchParams(window.location.search).get("panel");
  const tab = AUXILIARY_TABS.find((candidate) => candidate === panel) ?? null;
  if (!tab) return { tab, snapshot: undefined };
  try {
    const value = window.localStorage.getItem(PANEL_SNAPSHOT_KEY);
    return {
      tab,
      snapshot: value ? reviveSnapshot(JSON.parse(value)) : undefined,
    };
  } catch {
    return { tab, snapshot: undefined };
  }
};

export const useAuxiliaryWindow = () => {
  // この画面が補助のタブだけを出す画面（?panel=）なら、そのタブと開いたときの実データテストの盤面
  const [standalone] = useState(readStandalone);
  return {
    standaloneTab: standalone.tab,
    snapshot: standalone.snapshot,
    /** snapshot は実データテストの盤面（本番なら null） */
    openInNewTab: (tab: AuxiliaryTab, snapshot: SessionSnapshot | null) => {
      try {
        if (snapshot)
          window.localStorage.setItem(
            PANEL_SNAPSHOT_KEY,
            JSON.stringify(snapshot),
          );
        else window.localStorage.removeItem(PANEL_SNAPSHOT_KEY);
      } catch {
        // Opening the panel still works with its default state if storage is unavailable.
      }
      const url = new URL(window.location.href);
      url.searchParams.set("panel", tab);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    },
  };
};
