import type { CupStatus } from "@cafeore/common";
import { Delete } from "lucide-react";
import type React from "react";
import { type CardLooks, orderNoLabel } from "../logic/cards";
import type { FoundOrder } from "../logic/search";
import { OrderCard } from "./OrderCard";
import { CommentList } from "./OrderComments";
import { SidePanel } from "./SidePanels";

// 注文番号の検索（ヘッダーの「番号」で開く右のパネル）。上にテンキー、下に探した注文の今。
// 押し終えると探し（useOrderSearch）、見つかった注文は盤面で選んだ状態になる。パネルの外を押すと閉じる

// テンキーの並び（電卓と同じく 7 8 9 が上）
const KEYS: { key: string; label: React.ReactNode; title?: string }[] = [
  ..."789456123".split("").map((key) => ({ key, label: key })),
  { key: "clear", label: "C", title: "全部消す" },
  { key: "0", label: "0" },
  { key: "back", label: <Delete className="h-7 w-7" />, title: "1 文字消す" },
];

const STATUS_LABELS: Record<CupStatus, string> = {
  preparing: "準備中",
  ready: "準備完了",
  served: "提供済み",
};

export const OrderSearchPanel: React.FC<{
  digits: string;
  found: FoundOrder | null;
  /** 押した番号をまだ探していない */
  pending: boolean;
  looks: CardLooks;
  onKey: (key: string) => void;
  onClose: () => void;
}> = ({ digits, found, pending, looks, onKey, onClose }) => (
  <SidePanel title="注文番号で探す" onClose={onClose}>
    <output
      aria-label="入れた注文番号"
      className="mb-3 flex h-16 items-center justify-center rounded-xl border-2 border-slate-300 bg-slate-50 font-black font-mono text-[40px] text-slate-950 tracking-widest"
    >
      {digits ? `#${digits}` : <span className="text-slate-300">#---</span>}
    </output>
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map(({ key, label, title }) => (
        <button
          key={key}
          type="button"
          title={title}
          aria-label={title}
          onClick={() => onKey(key)}
          className="flex h-14 touch-manipulation items-center justify-center rounded-xl border-2 border-slate-300 bg-white font-black font-mono text-[26px] active:bg-slate-900 active:text-white"
        >
          {label}
        </button>
      ))}
    </div>
    <div className="mt-4">
      <SearchResult
        digits={digits}
        found={found}
        pending={pending}
        looks={looks}
      />
    </div>
  </SidePanel>
);

// 探した注文の今（注文の状態・緊急・カードの場所・コメント）
const SearchResult: React.FC<{
  digits: string;
  found: FoundOrder | null;
  pending: boolean;
  looks: CardLooks;
}> = ({ digits, found, pending, looks }) => {
  if (!digits)
    return (
      <p className="rounded-lg bg-slate-100 p-3 font-bold text-[13px] text-slate-500">
        番号を押すと、その注文がどこにあるかを出し、盤面で選びます（キーボードの数字でも入れられ、Enter
        ですぐ探して閉じます）
      </p>
    );
  if (pending)
    return (
      <p className="rounded-lg bg-slate-100 p-3 font-bold text-[13px] text-slate-500">
        押し終えると探します
      </p>
    );
  if (!found)
    return (
      <p className="rounded-lg bg-slate-100 p-3 font-bold text-[14px] text-slate-600">
        今日の #{orderNoLabel(Number(digits))} の注文はありません
      </p>
    );
  return (
    <section aria-label={`#${orderNoLabel(found.orderNo)} の今`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black font-mono text-[26px] text-slate-950">
          #{orderNoLabel(found.orderNo)}
        </span>
        <span className="rounded-md bg-slate-900 px-2 py-1 font-black text-[15px] text-white">
          {STATUS_LABELS[found.status]}
        </span>
        <span className="font-bold text-[13px] text-slate-600">
          準備完了 {found.readyCups}/{found.cups}杯
        </span>
        {found.emergency && (
          <span className="rounded-md border-2 border-red-800 bg-red-600 px-2 py-0.5 font-black text-[14px] text-white">
            緊急あり
          </span>
        )}
      </div>
      <ul className="mt-2 grid gap-2">
        {found.cards.map(({ card, place }) => (
          <li
            key={card.key}
            className="grid grid-cols-[8.5rem_1fr] items-center gap-2"
          >
            <span className="font-black text-[15px] text-slate-900">
              {place}
            </span>
            <OrderCard card={card} look={looks.get(card.key)} size="sm" />
          </li>
        ))}
      </ul>
      {found.cards.length === 0 && (
        <p className="mt-2 font-bold text-[13px] text-slate-500">
          盤面にこの注文のカードはありません
        </p>
      )}
      <CommentList comments={found.comments} className="mt-3" />
    </section>
  );
};
