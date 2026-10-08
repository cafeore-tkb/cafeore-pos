import {
  type CaosLane,
  type LaneAssignment,
  buildCaosCards,
  caosDay,
  laneChangeWarnings,
  putCaosLane,
  swapCaosLanes,
  todaysCaosLanes,
} from "@cafeore/common";
import { createContext, useContext, useEffect, useState } from "react";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { LaneChangeDialog } from "./LaneChangeDialog";
import { LaneConfirmDialog } from "./LaneConfirmDialog";
import { ShiftFeedSettings } from "./ShiftFeedSettings";
import { type ShiftFeedState, useShiftFeed } from "./useShiftFeed";

// ドリッパーの担当者（名前と上級生か）。サーバーが日本時間の日付ごとに持ち（api の caos_lanes）、
// 共有の WebSocket の {"type":"caos_lanes"} で全部の画面にそろう。
//
// 操作の画面（/master-sheet）は editable で、各ドリッパーの「交代」から替える（押したらその場で替える。抽出中かどうかは見ない）。
// sohosai-shift の予定（合言葉はこの端末の設定）は名前の候補と上級生の判定にだけ使い、自動では替えない。
// 上級生でない人（担当者なしも）にするドリッパーに限定のカードが待っていれば、［まだ変えない］［変える］で確かめる。
// ［変える］ならそのまま替え、カードも残す。閲覧だけの画面（/master-sheet/view）は表示だけ。

interface CaosLanesContextValue {
  /** 今日の 6 つ（ドリッパーの番号の順） */
  lanes: CaosLane[];
  /** 交代できる（操作の画面） */
  editable: boolean;
  /** 上級生の担当者がいるか（いなければ限定のカードをどこにも置けない） */
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

/** そのドリッパーの担当者 */
export const useLane = (dripper: number): CaosLane | undefined =>
  useCaosLanes().lanes.find((lane) => lane.dripper === dripper);

type Confirm = { warnings: string[]; run: () => void };

export const CaosLanesProvider = ({
  editable = false,
  children,
}: {
  editable?: boolean;
  children: React.ReactNode;
}) => {
  const { caosLanes, orders } = useOrdersWSContext();
  // 日が変わったら前の日の担当者は使わない（1 分ごとに今日を確かめる）
  const [today, setToday] = useState(() => caosDay(new Date()));
  useEffect(() => {
    const timer = window.setInterval(
      () => setToday(caosDay(new Date())),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const lanes = todaysCaosLanes(caosLanes, today);
  const shiftFeed = useShiftFeed(editable);

  const [changing, setChanging] = useState<{
    dripper: number;
    nowMs: number;
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // 替えたあとの担当者で、限定のカードが待っているドリッパーを確かめてから送る。結果は WebSocket で届く
  const request = (
    changes: LaneAssignment[],
    single: boolean,
    send: () => Promise<{ error?: string }>,
  ) => {
    setChanging(null);
    const run = () => {
      setConfirm(null);
      void send().then(({ error }) => {
        if (error) setError(error);
      });
    };
    const cards = buildCaosCards(orders, caosDay(new Date()));
    const warnings = laneChangeWarnings(cards, changes, single);
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
    editable,
    hasSenior: lanes.some((lane) => lane.senior && lane.name !== ""),
    openChange: (dripper) =>
      editable && setChanging({ dripper, nowMs: Date.now() }),
    openSettings: () => editable && setSettingsOpen(true),
    shiftFeed,
  };

  return (
    <CaosLanesContext.Provider value={value}>
      {children}
      {editable && changing && (
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
      {editable && confirm && (
        <LaneConfirmDialog
          messages={confirm.warnings}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.run}
        />
      )}
      {editable && settingsOpen && (
        <ShiftFeedSettings
          shiftFeed={shiftFeed}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {error && (
        <div
          role="alert"
          className="-translate-x-1/2 fixed bottom-4 left-1/2 z-[220] max-w-[calc(100vw-32px)] rounded-lg bg-red-700 px-4 py-3 font-bold text-sm text-white shadow-lg"
        >
          {error}
        </div>
      )}
    </CaosLanesContext.Provider>
  );
};
