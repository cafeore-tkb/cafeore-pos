import { jstClock } from "@cafeore/common";
import { Eye, Volume2, VolumeX } from "lucide-react";
import type React from "react";
import { NavLink } from "react-router";
import type { PosConnectionStatus } from "../hooks/usePosOrders";
import type { ViewSound } from "../hooks/useViewBoard";
import { PosStatusBadge } from "./TopHeader";

// 閲覧だけの画面（盤面を読むだけで、書き込みは送らない）。ヘッダーから行き来する
const VIEW_SCREENS = [
  { to: "/master-sheet/view", label: "管制盤" },
  { to: "/master-sheet/libero", label: "リベロ" },
];

/** ヘッダーの切り替えの枠と、そのボタン（押されているものは濃く） */
export const SEGMENTS =
  "flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 font-bold text-slate-600 text-xs";
export const segmentClass = (active: boolean) =>
  `rounded-md px-2.5 py-1.5 ${active ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-100"}`;

/** 閲覧だけの画面のヘッダー。CaOS の印・閲覧の画面の切り替え・時計・各画面のもの（children）・通知音・担当者の知らせ・注文の接続 */
export const ViewHeader: React.FC<{
  nowMs: number;
  status: PosConnectionStatus;
  sound: ViewSound;
  children?: React.ReactNode;
}> = ({ nowMs, status, sound, children }) => (
  <header className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
    <span className="font-black font-mono text-3xl tabular-nums">
      {jstClock(nowMs)}
    </span>
    <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-black text-sm text-white">
      CaOS
    </span>
    <nav aria-label="閲覧の画面" className={SEGMENTS}>
      <Eye className="mx-1 h-4 w-4" />
      閲覧のみ
      {VIEW_SCREENS.map((screen) => (
        <NavLink
          key={screen.to}
          to={screen.to}
          className={({ isActive }) => segmentClass(isActive)}
        >
          {screen.label}
        </NavLink>
      ))}
    </nav>
    {children}
    <SoundToggle sound={sound} />
    <PosStatusBadge status={status} />
  </header>
);

/** 通知音（新しく入ったカードの知らせ。何を知らせるかは画面ごと。useViewBoard の arrivals）のあり・なし。音ありでまだ出せない（iPad で画面に触れる前）ときはそう出す */
const SoundToggle: React.FC<{ sound: ViewSound }> = ({ sound }) => {
  const Icon = sound.on ? Volume2 : VolumeX;
  const label = sound.on
    ? `音あり${sound.ready ? "" : "（触れると鳴る）"}`
    : "音なし";
  return (
    <button
      type="button"
      aria-pressed={sound.on}
      onClick={sound.toggle}
      className={`flex touch-manipulation items-center gap-1 border border-slate-200 font-bold text-xs ${segmentClass(sound.on)}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
};
