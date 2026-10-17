import {
  type CaosLane,
  type CaosOutboxOp,
  type LaneAssignment,
  type LaneCandidate,
  buildCaosCards,
  dripperLabel,
  jstDate,
  laneChangeWarnings,
  nextLaneCandidate,
  overlayCaosLanes,
  overlayCaosOrders,
  seniorUpdates,
  todaysCaosLanes,
} from "@cafeore/common";
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { LaneChangeDialog, ShiftFeedSettings } from "../components/LaneDialogs";
import { noNextReason } from "../logic/shiftFeed";
import { caosLog } from "../utils/log";
import { enqueueCaosOp, useCaosOutboxEntries } from "./useCaosOutbox";
import { useCaosStateLog } from "./useCaosStateLog";
import { useRememberAction } from "./useLastAction";
import { type ShiftFeedState, useShiftFeed } from "./useShiftFeed";

// ドリッパーの担当者（名前と上級生か）。サーバーが日本時間の日付ごとに持ち（api の caos_lanes）、
// 共有の WebSocket の {"type":"caos_lanes"} で全部の画面にそろう。
//
// 操作の画面（/master-sheet）は editable で、各ドリッパーの「交代」から替える（押したらその場で替える。抽出中かどうかは見ない）。
//   - 列の見出しと列の操作のパネルの「交代」は、押したらすぐ次の人（sohosai-shift の予定で、今の担当者より後ろの最初の人。nextLaneCandidate）に替える。
//     替えたら「直前の操作」（LastActionProvider）に出す（間違えたら、もう一度替えて直す）
//   - ヘッダーの「ドリッパー」の「交代」は LaneChangeDialog を開き、候補を選ぶ・名前を入れる・入れ替える・空きにする
// 閲覧だけの画面（/master-sheet/view・/master-sheet/libero）は表示だけ（「交代」・合言葉の設定を出さず、sohosai-shift の予定も読まない）。
// sohosai-shift の予定（合言葉はこの端末の設定）は名前の候補と上級生の判定にだけ使い、予定の時刻どおりに自動では替えない。
// 上級生でない人（担当者なしも）にするドリッパーに指名の無い上級生のみのカード（抽出中・待機）があっても止めずに替え、POS の通知で知らせる
// （カードはそのドリッパーに残り、警告の印が付く）。替えたら画面はすぐ変わり、送るのは後ろで（盤面の操作と同じく端末に残して送る。useCaosOutbox）。
// 担当者はサーバーから届いた今日の担当者に、この端末の送れていない交代を重ねて出す。
// 予定を読み直したら（useSeniorRefresh）、今の担当者の上級生かだけを新しい名簿に合わせる（syncSeniors。交代の記録は足さない）。
// 名簿から外れた人は、そのドリッパーに指名の無い上級生のみのカードがあっても外す（カードに警告の印が付く）。

type NextLane = { next: LaneCandidate } | { reason: string };

interface CaosLanesContextValue {
  /** 今日の 6 つ（ドリッパーの番号の順） */
  lanes: CaosLane[];
  /** 交代できる（操作の画面） */
  editable: boolean;
  /** 上級生の担当者がいるか（いなければ、指名の無い上級生のみのカードはどこに置いても警告の印が付く） */
  hasSenior: boolean;
  openChange: (dripper: number) => void;
  /** 見出しの「交代」ですぐ入る次の人。いなければその理由 */
  nextOf: (dripper: number) => NextLane;
  /** 次の人にすぐ替える（ボタンに出していた nextOf の人） */
  changeToNext: (dripper: number, next: LaneCandidate) => void;
  openSettings: () => void;
  shiftFeed: ShiftFeedState;
  /**
   * 今の担当者の上級生かを名簿に合わせる。予定を読み直したときに useSeniorRefresh が呼ぶ。
   * 上級生のみのカード（抽出中・待機）があっても外し、カードに警告の印が付く（知らせは出さない）。閲覧だけの画面は予定を読まないので何もしない
   */
  syncSeniors: () => void;
}

const CaosLanesContext = createContext<CaosLanesContextValue | null>(null);

export const useCaosLanes = () => {
  const value = useContext(CaosLanesContext);
  if (!value) throw new Error("useCaosLanes は CaosLanesProvider の中で使う");
  return value;
};

// 二度押しとみる間隔（見出しの「交代」）
const DOUBLE_TAP_MS = 1000;

// 名簿に合わせて上級生の印を直す操作の名前（通らなかったときの知らせに出す）
const SENIORS_LABEL = "上級生の印を名簿に合わせる";

// 交代の名前（「直前の操作」と、通らなかったときの知らせに出す）
const changeLabel = ({ dripper, name }: LaneAssignment) =>
  `交代 ${dripperLabel(dripper)} → ${name || "空き"}`;

export const CaosLanesProvider = ({
  editable = false,
  children,
}: {
  editable?: boolean;
  children: React.ReactNode;
}) => {
  const { caosLanes, orders } = useOrdersWSContext();
  const entries = useCaosOutboxEntries();
  // 日が変わったら前の日の担当者は使わない。見出しの「交代」の次の人も、この時計の時刻で決める（枠の変わり目から 10 秒のうちに変わる）
  const nowMs = useCurrentTime(10_000).getTime();
  const today = jstDate(nowMs);
  const lanes = overlayCaosLanes(
    todaysCaosLanes(caosLanes, today),
    entries,
    today,
  );
  const shiftFeed = useShiftFeed(editable);
  const rememberAction = useRememberAction();
  // すぐ替えているドリッパー。二度押しで 2 回送ったり 2 人ぶん進んだりしないよう、替えてから DOUBLE_TAP_MS のあいだも押しても替えない
  const sending = useRef(new Set<number>());
  // 確かめるのは送るときの担当者と注文（確かめのダイアログで待つので、そのときの値を読む）
  const latest = useRef({
    lanes,
    orders,
    entries,
    today,
    feed: shiftFeed.feed,
  });
  latest.current = { lanes, orders, entries, today, feed: shiftFeed.feed };
  // 交代の操作。押したときの担当者のままのときだけ送る（createCaosOutbox）
  const laneOp = ({ dripper, name, senior }: LaneAssignment): CaosOutboxOp => ({
    kind: "lane",
    dripper,
    name,
    senior,
    before: latest.current.lanes[dripper - 1].name,
  });
  // 今の盤面のカード（この端末の送れていない操作も重ねる。useLiveBoard と同じ）
  const boardCards = () => {
    const { orders, entries, today } = latest.current;
    return buildCaosCards(overlayCaosOrders(orders, entries, today));
  };

  const [changing, setChanging] = useState<{
    dripper: number;
    nowMs: number;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useCaosStateLog("ui.lane-dialog.changed", { changing, settingsOpen });

  // 端末に残して送る（残した操作の id を返す）。替えたあとの担当者で、指名の無い上級生のみのカード（抽出中・待機）があるドリッパーがあれば、止めずに POS の通知で知らせる
  const request = (
    changes: LaneAssignment[],
    single: boolean,
    label: string,
    op: CaosOutboxOp,
  ) => {
    caosLog("lanes.operation.requested", { label, op });
    setChanging(null);
    const warnings = laneChangeWarnings(boardCards(), changes, single);
    const id = enqueueCaosOp(label, op);
    if (warnings.length > 0)
      toast.warning(`${label}：${warnings.join("。")}`, {
        description: "カードに警告の印を付けています",
      });
    return id;
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

  // 次の人（ボタンに出していた人）にすぐ替え、「直前の操作」に覚える（上級生のみのカード（抽出中・待機）があれば知らせる）
  const changeToNext = (dripper: number, { name, senior }: LaneCandidate) => {
    if (sending.current.has(dripper)) {
      caosLog("lanes.operation.ignored", { dripper, reason: "double-tap" });
      return;
    }
    sending.current.add(dripper);
    const after = { dripper, name, senior };
    const label = changeLabel(after);
    rememberAction?.(label, [request([after], true, label, laneOp(after))]);
    setTimeout(() => sending.current.delete(dripper), DOUBLE_TAP_MS);
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
    syncSeniors: () => {
      const { lanes, feed } = latest.current;
      const updates = seniorUpdates(lanes, feed);
      if (updates.length > 0)
        enqueueCaosOp(SENIORS_LABEL, { kind: "seniors", lanes: updates });
    },
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
          onPick={(name, senior) => {
            const change = { dripper: changing.dripper, name, senior };
            request([change], true, changeLabel(change), laneOp(change));
          }}
          onSwap={(other) => {
            const mine = laneOf(changing.dripper);
            const theirs = laneOf(other);
            request(
              [
                { ...theirs, dripper: changing.dripper },
                { ...mine, dripper: other },
              ],
              false,
              `入れ替え ${dripperLabel(changing.dripper)} ⇔ ${dripperLabel(other)}`,
              {
                kind: "swap",
                first: changing.dripper,
                second: other,
                names: [mine.name, theirs.name],
              },
            );
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => setChanging(null)}
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
