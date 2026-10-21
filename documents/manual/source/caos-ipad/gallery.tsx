import type { CaosCard } from "@cafeore/common";
import * as Icons from "lucide-react";
import type React from "react";
import { createRoot } from "react-dom/client";
import { CardActionButton } from "../../../../services/pos/app/caos/components/CardActionTray";
import { CardOverlay } from "../../../../services/pos/app/caos/components/CardActions";
import { OrderCard } from "../../../../services/pos/app/caos/components/OrderCard";
import { ReactionIcon } from "../../../../services/pos/app/caos/components/ReactionIcon";
import { OrderHighlightsContext } from "../../../../services/pos/app/caos/hooks/useOrderHighlights";
import { boardLanes } from "../../../../services/pos/app/caos/logic/lanes";
import inventory from "./icon-inventory.json";
import iconStyles from "./icon-styles.json";

const fixture = (
  options: {
    cups?: number;
    emergency?: number;
    merged?: boolean;
    lane?: boolean;
    name?: boolean;
    senior?: boolean;
    done?: boolean;
    served?: number;
    status?: CaosCard["status"];
  } = {},
): CaosCard => {
  const count = options.cups ?? 1;
  const status = options.done ? "done" : (options.status ?? "brewing");
  const startedAt =
    status === "brewing" || status === "done" ? new Date() : null;
  const dripper = status === "unassigned" ? null : 2;
  const cups = Array.from({ length: count }, (_, i) => ({
    id: `cup-${i}`,
    cupId: `cup-${i}`,
    orderId: options.merged ? `order-${i}` : "order-0",
    orderNo: options.merged ? 121 + i : 121,
    position: i,
    emergency: i < (options.emergency ?? 0),
    emergencyReason: i < (options.emergency ?? 0) ? "抽出ミス" : "",
    orderedAt: new Date(),
    item: {
      id: "item",
      name: "ブレンド",
      abbr: "俺ブレ",
      item_type: {
        name: "blend",
        display_name: "ブレンド",
        makes_cup: true,
        needs_brew: true,
        senior_only: options.senior ?? false,
        iced_brew: false,
        serve_with_snack: false,
      },
    },
    nominatedDripper: options.lane && i === 0 ? 2 : null,
    nominee: options.lane && i === 0 ? "2nd" : options.name ? "山田" : null,
    readyAt: i < (options.served ?? 0) ? new Date() : null,
    servedAt: i < (options.served ?? 0) ? new Date() : null,
    state: {
      dripper,
      dripperPosition: 1,
      dripId: "drip",
      brewStartedAt: startedAt,
      brewFinishedAt: options.done ? new Date() : null,
    },
  }));
  return {
    key: "drip",
    dripId: "drip",
    status,
    dripper,
    dripperPosition: 1,
    startedAt,
    finishedAt: options.done ? new Date() : null,
    cups,
    orderNo: 121,
    nominatedDripper: options.lane ? 2 : null,
    seniorOnly: options.senior ?? false,
    emergency: (options.emergency ?? 0) > 0,
    state: cups[0].state,
  };
};
const cards = [
  { title: "通常・1杯", note: "白抜きの杯数札", card: fixture() },
  {
    title: "通常・2杯",
    note: "同じ注文。統合の影なし",
    card: fixture({ cups: 2 }),
  },
  {
    title: "複数注文の統合",
    note: "番号2つ＋重なりの影",
    card: fixture({ cups: 2, merged: true }),
  },
  {
    title: "レーン指名",
    note: "黒い札と点線の枠",
    card: fixture({ lane: true }),
  },
  {
    title: "自由記述の指名",
    note: "名前札だけでは台を限定しない",
    card: fixture({ name: true }),
  },
  {
    title: "指名レーン＋名前",
    note: "幅があれば両方を表示",
    card: fixture({ cups: 2, lane: true, name: true }),
  },
  {
    title: "上級生のみ",
    note: "★の札。担当者も確認",
    card: fixture({ senior: true }),
  },
  {
    title: "上級生の担当が必要",
    note: "担当者が条件を満たさない",
    card: fixture({ senior: true }),
    offSenior: true,
  },
  {
    title: "全杯が緊急",
    note: "赤い地・警告付きの番号",
    card: fixture({ emergency: 1 }),
  },
  {
    title: "通常＋緊急の混在",
    note: "緊急1/2は片方だけ淹れ直し",
    card: fixture({ cups: 2, emergency: 1 }),
  },
  {
    title: "抽出完了",
    note: "薄い地と点線。提供完了とは別",
    card: fixture({ done: true }),
  },
  {
    title: "提供済み・全杯",
    note: "盤面は自動では終了しない",
    card: fixture({ cups: 2, served: 2 }),
  },
  {
    title: "提供済み・一部",
    note: "提供済1/2。残る杯を確認",
    card: fixture({ cups: 2, served: 1 }),
  },
  {
    title: "注文の選択",
    note: "選んだ注文にオレンジ系の枠",
    card: fixture(),
    selected: true,
  },
  {
    title: "2注文の個別選択",
    note: "番号と対応する半分の枠が2色",
    card: fixture({ cups: 2, merged: true }),
    highlighted: true,
  },
  {
    title: "未割当",
    note: "担当者未決定。列を選んで置く",
    card: fixture({ status: "unassigned" }),
  },
  {
    title: "未着手の先頭",
    note: "✋の印。▶で抽出を始める",
    card: fixture({ status: "queued" }),
    overlay: true,
  },
  {
    title: "コメントあり",
    note: "青緑の吹き出しから内容を見る",
    card: fixture(),
    comments: true,
  },
  {
    title: "統合できる相手",
    note: "青い「統合する」を確認",
    card: fixture(),
    mergeTap: true,
  },
  {
    title: "ドラッグ中",
    note: "つかんだ中身は薄くなる",
    card: fixture(),
    dragging: true,
  },
];
const highlight = {
  orders: [
    { id: "order-0", no: 121, color: "#e87a26" },
    { id: "order-1", no: 122, color: "#ffad57" },
  ],
  selectCard: () => {},
} as React.ContextType<typeof OrderHighlightsContext>;
function App() {
  return (
    <div className="caos-root">
      <div id="cards" className="card-grid">
        {cards.map((sample) => (
          <article className="sample" key={sample.title}>
            <div className="sample-title">{sample.title}</div>
            <OrderHighlightsContext.Provider
              value={sample.highlighted ? highlight : null}
            >
              <OrderCard
                card={sample.card}
                size="md"
                selected={sample.selected}
                mergeTap={sample.mergeTap}
                dragging={sample.dragging}
                look={
                  sample.offSenior
                    ? { offSenior: true }
                    : sample.comments
                      ? {
                          comments: [
                            {
                              orderNo: 121,
                              orderId: "order-0",
                              createdAt: new Date(),
                              author: "serve",
                              text: "準備できました",
                            },
                          ],
                        }
                      : undefined
                }
                className="sample-card"
              >
                {sample.overlay && (
                  <CardOverlay
                    card={sample.card}
                    lane={boardLanes([sample.card])[1]}
                    nowMs={Date.now()}
                  />
                )}
              </OrderCard>
            </OrderHighlightsContext.Provider>
            <div className="sample-note">{sample.note}</div>
          </article>
        ))}
      </div>
      <div id="icons" className="icon-grid">
        {inventory.svg.map((icon) => (
          <article className="icon-tile" key={icon.name}>
            <CardActionButton aria-label={icon.label}>
              <img
                className="h-8 w-8 rounded-full bg-white"
                src={`/svg/${icon.name}.svg`}
                alt=""
              />
            </CardActionButton>
            <strong>{icon.label}</strong>
            <small>カード・担当者の操作</small>
          </article>
        ))}
        {inventory.reactions.map((stamp) => (
          <article className="icon-tile" key={stamp}>
            <ReactionIcon stamp={stamp} />
            <strong>{stamp}</strong>
            <small>コメントの返信</small>
          </article>
        ))}
        {inventory.lucide.map((icon) => {
          const Icon = Icons[
            icon.name as keyof typeof Icons
          ] as Icons.LucideIcon;
          const usage = iconStyles[icon.name as keyof typeof iconStyles];
          return (
            <article className="icon-tile" key={icon.name}>
              {usage.capture ? (
                <img
                  className="captured-use"
                  src={`/icon-uses/${usage.capture}`}
                  alt=""
                />
              ) : (
                <span
                  className={
                    iconStyles[icon.name as keyof typeof iconStyles].context
                  }
                >
                  <Icon
                    className={
                      iconStyles[icon.name as keyof typeof iconStyles].className
                    }
                  />
                </span>
              )}
              <strong>{icon.label}</strong>
              <small>
                {icon.name === "LoaderCircle"
                  ? "操作完了を待つ"
                  : "画面・設定・補助表示"}
              </small>
            </article>
          );
        })}
      </div>
    </div>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Gallery root is missing");
createRoot(root).render(<App />);
