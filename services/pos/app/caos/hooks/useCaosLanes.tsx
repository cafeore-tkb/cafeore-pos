import {
  type CaosLane,
  type LaneAssignment,
  type LaneCandidate,
  buildCaosCards,
  caosLaneUndoBlock,
  dripperLabel,
  jstDate,
  laneChangeWarnings,
  nextLaneCandidate,
  putCaosLane,
  swapCaosLanes,
  todaysCaosLanes,
} from "@cafeore/common";
import { createContext, useContext, useRef, useState } from "react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import {
  LaneChangeDialog,
  LaneConfirmDialog,
  ShiftFeedSettings,
} from "../components/LaneDialogs";
import { noNextReason } from "../logic/shiftFeed";
import { refuseUndo, succeeded, useRememberUndo } from "./useCaosUndo";
import { type ShiftFeedState, useShiftFeed } from "./useShiftFeed";

// ドリッパーの担当者（名前と上級生か）。サーバーが日本時間の日付ごとに持ち（api の caos_lanes）、
// 共有の WebSocket の {"type":"caos_lanes"} で全部の画面にそろう。
//
// 操作の画面（/master-sheet）は editable で、各ドリッパーの「交代」から替える（押したらその場で替える。抽出中かどうかは見ない）。
//   - 列の見出しと列の操作のパネルの「交代」は、押したらすぐ次の人（sohosai-shift の予定の最初の候補。nextLaneCandidate）に替える。
//     替えたら「1つ戻す」（CaosUndoProvider）に覚え、10 秒のあいだ前の人に戻せる
//   - ヘッダーの「ドリッパー」の「交代」は LaneChangeDialog を開き、候補を選ぶ・名前を入れる・入れ替える・空きにする
// 閲覧だけの画面（/master-sheet/view）は表示だけ（「交代」・合言葉の設定を出さず、sohosai-shift の予定も読まない）。
// sohosai-shift の予定（合言葉はこの端末の設定）は名前の候補と上級生の判定にだけ使い、予定の時刻どおりに自動では替えない。
// 上級生でない人（担当者なしも）にするドリッパーに指名の無い上級生のみのカードが待っていれば、［まだ変えない］［変える］で確かめる。
// ［変える］ならそのまま替え、カードも残す。断られた理由は POS の通知（sonner）で出す。

type NextLane = { next: LaneCandidate } | { reason: string };

interface CaosLanesContextValue {
  /** 今日の 6 つ（ドリッパーの番号の順） */
  lanes: CaosLane[];
  /** 交代できる（操作の画面） */
  editable: boolean;
  /** 上級生の担当者がいるか（いなければ指名の無い上級生のみのカードをどこにも置けない） */
  hasSenior: boolean;
  openChange: (dripper: number) => void;
  /** 見出しの「交代」ですぐ入る次の人。いなければその理由 */
  nextOf: (dripper: number) => NextLane;
  /** 次の人にすぐ替える（ボタンに出していた nextOf の人） */
  changeToNext: (dripper: number, next: LaneCandidate) => void;
  openSettings: () => void;
  shiftFeed: ShiftFeedState;
}

const CaosLanesContext = createContext<CaosLanesContextValue | null>(null);

export const useCaosLanes = () => {
  const value = useContext(CaosLanesContext);
  if (!value) throw new Error("useCaosLanes は CaosLanesProvider の中で使う");
  return value;
};

// 二度押しとみる間隔（見出しの「交代」）
const DOUBLE_TAP_MS = 1000;

type Confirm = { warnings: string[]; answer: (ok: boolean) => void };

export const CaosLanesProvider = ({
  editable = false,
  children,
}: {
  editable?: boolean;
  children: React.ReactNode;
}) => {
  const { caosLanes, orders } = useOrdersWSContext();
  // 日が変わったら前の日の担当者は使わない。見出しの「交代」の次の人も、この時計の時刻で決める（枠の変わり目から 10 秒のうちに変わる）
  const nowMs = useCurrentTime(10_000).getTime();
  const today = jstDate(nowMs);
  const lanes = todaysCaosLanes(caosLanes, today);
  const shiftFeed = useShiftFeed(editable);
  const rememberUndo = useRememberUndo();
  // すぐ替えているドリッパー。二度押しで 2 回送ったり 2 人ぶん進んだりしないよう、替えてから DOUBLE_TAP_MS のあいだも押しても替えない
  const sending = useRef(new Set<number>());
  // 確かめるのは送るときの担当者と注文（「1つ戻す」はあとで押すので、そのときの値を読む）
  const latest = useRef({ lanes, orders, today });
  latest.current = { lanes, orders, today };

  const [changing, setChanging] = useState<{
    dripper: number;
    nowMs: number;
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 替えたあとの担当者で、指名の無い上級生のみのカードが待っているドリッパーを確かめてから送る。結果は WebSocket で届く。
  // 替えられたら true（［まだ変えない］・断られたら false）
  const request = (
    changes: LaneAssignment[],
    single: boolean,
    send: () => Promise<{ error?: string }>,
  ): Promise<boolean> => {
    setChanging(null);
    const { orders, today } = latest.current;
    const warnings = laneChangeWarnings(
      buildCaosCards(orders, today),
      changes,
      single,
    );
    const confirmed =
      warnings.length === 0
        ? Promise.resolve(true)
        : new Promise<boolean>((answer) => setConfirm({ warnings, answer }));
    return confirmed.then((ok) => {
      setConfirm(null);
      return ok && send().then(succeeded);
    });
  };

  // lanes は 6 つ全部を番号の順に持つ（todaysCaosLanes）
  const laneOf = (dripper: number) => lanes[dripper - 1];

  const nextOf = (dripper: number): NextLane => {
    const next = nextLaneCandidate(
      shiftFeed.feed,
      dripper,
      nowMs,
      laneOf(dripper).name,
    );
    return next === null || next === "already-in"
      ? { reason: noNextReason(shiftFeed, next) }
      : { next };
  };

  // 次の人（ボタンに出していた人）にすぐ替え、「1つ戻す」に前の人へ戻す処理を覚える。
  // 戻すのは今の担当者が替えたあとのままのときだけで、替えるときと同じく上級生のみのカードを確かめる
  const changeToNext = (dripper: number, { name, senior }: LaneCandidate) => {
    if (sending.current.has(dripper)) return;
    sending.current.add(dripper);
    const after = { dripper, name, senior };
    // 前の人は送るときの担当者（確かめているあいだにほかの画面が替えたら、その人に戻す）
    let before = laneOf(dripper);
    const undoRun = () => {
      const blocked = caosLaneUndoBlock(
        before,
        after,
        latest.current.lanes[dripper - 1],
      );
      if (blocked) return refuseUndo(blocked);
      return request([before], true, () =>
        putCaosLane(dripper, before.name, before.senior),
      );
    };
    void request([after], true, () => {
      before = latest.current.lanes[dripper - 1];
      return putCaosLane(dripper, name, senior);
    }).then((ok) => {
      // 替えなかった（［まだ変えない］・断られた）ならすぐ押せる
      if (!ok) return sending.current.delete(dripper);
      rememberUndo?.(`交代 ${dripperLabel(dripper)} → ${name}`, undoRun);
      setTimeout(() => sending.current.delete(dripper), DOUBLE_TAP_MS);
    });
  };

  const value: CaosLanesContextValue = {
    lanes,
    editable,
    hasSenior: lanes.some((lane) => lane.senior),
    openChange: (dripper) => setChanging({ dripper, nowMs: Date.now() }),
    nextOf,
    changeToNext,
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
            void request(
              [{ dripper: changing.dripper, name, senior }],
              true,
              () => putCaosLane(changing.dripper, name, senior),
            )
          }
          onSwap={(other) => {
            const mine = laneOf(changing.dripper);
            const theirs = laneOf(other);
            void request(
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
          onCancel={() => confirm.answer(false)}
          onConfirm={() => confirm.answer(true)}
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
