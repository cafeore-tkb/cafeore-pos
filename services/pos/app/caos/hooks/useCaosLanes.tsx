import {
  type CaosLane,
  type LaneAssignment,
  buildCaosCards,
  jstDate,
  laneChangeWarnings,
  putCaosLane,
  swapCaosLanes,
  todaysCaosLanes,
} from "@cafeore/common";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import {
  LaneChangeDialog,
  LaneConfirmDialog,
  ShiftFeedSettings,
} from "../components/LaneDialogs";
import { type ShiftFeedState, useShiftFeed } from "./useShiftFeed";

// ドリッパーの担当者（名前と上級生か）。サーバーが日本時間の日付ごとに持ち（api の caos_lanes）、
// 共有の WebSocket の {"type":"caos_lanes"} で全部の画面にそろう。
//
// 各ドリッパーの「交代」から替える（押したらその場で替える。抽出中かどうかは見ない）。
// sohosai-shift の予定（合言葉はこの端末の設定）は名前の候補と上級生の判定にだけ使い、自動では替えない。
// 上級生でない人（担当者なしも）にするドリッパーに上級生のみのカードが待っていれば、［まだ変えない］［変える］で確かめる。
// ［変える］ならそのまま替え、カードも残す。断られた理由は POS の通知（sonner）で出す。

interface CaosLanesContextValue {
  /** 今日の 6 つ（ドリッパーの番号の順） */
  lanes: CaosLane[];
  /** 上級生の担当者がいるか（いなければ上級生のみのカードをどこにも置けない） */
  hasSenior: boolean;
  openChange: (dripper: number) => void;
  openSettings: () => void;
  shiftFeed: ShiftFeedState;
}

const CaosLanesContext = createContext<CaosLanesContextValue | null>(null);

export const useCaosLanes = () => {
  const value = useContext(CaosLanesContext);
  if (!value) throw new Error("useCaosLanes は CaosLanesProvider の中で使う");
  return value;
};

type Confirm = { warnings: string[]; run: () => void };

export const CaosLanesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { caosLanes, orders } = useOrdersWSContext();
  // 日が変わったら前の日の担当者は使わない（1 分ごとに今日を確かめる）
  const today = jstDate(useCurrentTime(60_000).getTime());
  const lanes = todaysCaosLanes(caosLanes, today);
  const shiftFeed = useShiftFeed();

  const [changing, setChanging] = useState<{
    dripper: number;
    nowMs: number;
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 替えたあとの担当者で、上級生のみのカードが待っているドリッパーを確かめてから送る。結果は WebSocket で届く
  const request = (
    changes: LaneAssignment[],
    single: boolean,
    send: () => Promise<{ error?: string }>,
  ) => {
    setChanging(null);
    const run = () => {
      setConfirm(null);
      void send().then(({ error }) => {
        if (error) toast.error(error);
      });
    };
    const warnings = laneChangeWarnings(
      buildCaosCards(orders, today),
      changes,
      single,
    );
    if (warnings.length === 0) run();
    else setConfirm({ warnings, run });
  };

  const laneOf = (dripper: number) =>
    lanes.find((lane) => lane.dripper === dripper) ?? {
      dripper,
      name: "",
      senior: false,
      updated_at: null,
    };

  const value: CaosLanesContextValue = {
    lanes,
    hasSenior: lanes.some((lane) => lane.senior),
    openChange: (dripper) => setChanging({ dripper, nowMs: Date.now() }),
    openSettings: () => setSettingsOpen(true),
    shiftFeed,
  };

  return (
    <CaosLanesContext.Provider value={value}>
      {children}
      {changing && (
        <LaneChangeDialog
          lane={laneOf(changing.dripper)}
          lanes={lanes}
          shiftFeed={shiftFeed}
          nowMs={changing.nowMs}
          onPick={(name, senior) =>
            request([{ dripper: changing.dripper, name, senior }], true, () =>
              putCaosLane(changing.dripper, name, senior),
            )
          }
          onSwap={(other) => {
            const mine = laneOf(changing.dripper);
            const theirs = laneOf(other);
            request(
              [
                { ...theirs, dripper: changing.dripper },
                { ...mine, dripper: other },
              ],
              false,
              () => swapCaosLanes(changing.dripper, other),
            );
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => setChanging(null)}
        />
      )}
      {confirm && (
        <LaneConfirmDialog
          messages={confirm.warnings}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.run}
        />
      )}
      {settingsOpen && (
        <ShiftFeedSettings
          shiftFeed={shiftFeed}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </CaosLanesContext.Provider>
  );
};
