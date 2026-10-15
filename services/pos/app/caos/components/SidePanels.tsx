import {
  type CaosCard,
  type CaosOrderInput,
  type CaosPlace,
  DRIPPER_NUMBERS,
  canSplitCard,
  caosBrewSec,
  caosDripperAllowed,
  dripperLabel,
} from "@cafeore/common";
import { ArrowRight, Undo2, X } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import {
  EmergencyForm,
  type EmergencyFormProps,
} from "~/components/molecules/EmergencyForm";
import { TwoStepButton } from "~/components/molecules/TwoStepButton";
import { usePanelOutsidePress } from "../hooks/useOutsidePress";
import {
  type CardLook,
  type CardLooks,
  cardName,
  orderCount,
  orderLabel,
} from "../logic/cards";
import { clockLabel } from "../logic/format";
import {
  type Lane,
  frontTargets,
  laneActive,
  moveTargets,
} from "../logic/lanes";
import { AnalyticsView } from "./AnalyticsView";
import { BeanQueueView } from "./BeanQueueView";
import { LaneBadge } from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import {
  LaneAbility,
  LaneChangeButton,
  LaneChooseButton,
  LaneName,
} from "./LaneParts";
import { OrderCard, SplitCupButtons } from "./OrderCard";
import { CommentList } from "./OrderComments";

// 右のパネル（割当・詳細・補助のタブ・番号の検索・緊急・列の操作）。ヘッダーの下に右から出し、管制盤は隠さない。
// パネルの外を押すと閉じる（その 1 回は閉じるだけで、下のカード・ボタンは動かさない。usePanelOutsidePress）
export const SidePanel: React.FC<{
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, onClose, footer, children }) => {
  const panelRef = useRef<HTMLElement>(null);
  usePanelOutsidePress(panelRef, onClose);
  return (
    <aside
      ref={panelRef}
      className="fade-in-75 slide-in-from-right caos-side-panel fixed top-[56px] right-0 bottom-0 z-[150] flex w-(--caos-side-panel-width) animate-in select-none flex-col border-slate-300 border-l bg-white text-slate-950 shadow-2xl duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
    >
      <header className="flex min-h-[52px] shrink-0 items-center gap-1 border-slate-200 border-b bg-slate-50 px-4">
        <div className="mr-auto min-w-0 font-black text-[16px]">{title}</div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full hover:bg-black/5"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer}
    </aside>
  );
};

/** パネルの下の「キャンセル」と確定のボタン */
const PanelFooter: React.FC<{
  onCancel: () => void;
  children: React.ReactNode;
}> = ({ onCancel, children }) => (
  <div className="flex shrink-0 items-center justify-between gap-2 border-slate-200 border-t bg-slate-50 px-4 py-3">
    <button
      type="button"
      onClick={onCancel}
      className="min-h-[44px] touch-manipulation rounded-lg border border-slate-300 bg-white px-4 font-bold text-slate-700 text-xs hover:bg-slate-100"
    >
      キャンセル
    </button>
    {children}
  </div>
);

// 空きスロットから開く割当。未割当のカードとドリッパーを選んで確定する
export const AssignPanel: React.FC<{
  /** 空きスロットを押したドリッパー */
  bayId: number;
  lanes: Lane[];
  unassignedOrders: CaosCard[];
  looks: CardLooks;
  onClose: () => void;
  onAssign: (card: CaosCard, targetBayId: number) => void;
}> = ({ bayId, lanes, unassignedOrders, looks, onClose, onAssign }) => {
  const [selectedOrderUid, setSelectedOrderUid] = useState(
    unassignedOrders[0]?.key ?? "",
  );
  const [selectedBayId, setSelectedBayId] = useState(bayId);
  const selectedOrder = unassignedOrders.find(
    (order) => order.key === selectedOrderUid,
  );
  // 指名の番号のあるカードは、その番号のドリッパーだけ選べる
  const allowed = (id: number) =>
    !selectedOrder || caosDripperAllowed(selectedOrder, id);

  return (
    <SidePanel
      title={`ドリッパー ${dripperLabel(bayId)} にオーダー割当`}
      onClose={onClose}
      footer={
        <PanelFooter onCancel={onClose}>
          <button
            type="button"
            disabled={!selectedOrder || !allowed(selectedBayId)}
            onClick={() => {
              if (selectedOrder) onAssign(selectedOrder, selectedBayId);
              onClose();
            }}
            className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg bg-emerald-700 px-4 font-bold text-white text-xs shadow-xs hover:bg-emerald-800 disabled:opacity-50"
          >
            割当を確定
            <ArrowRight className="h-4 w-4" />
          </button>
        </PanelFooter>
      }
    >
      <h3 className="mb-1.5 font-bold text-slate-700 text-xs">
        割り当てる未割当オーダー:
      </h3>
      {unassignedOrders.length === 0 ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-3 text-slate-500 text-xs">
          未割当オーダーがありません
        </p>
      ) : (
        <div className="grid max-h-[200px] gap-1.5 overflow-y-auto p-1">
          {unassignedOrders.map((order) => (
            <OrderCard
              key={order.key}
              card={order}
              look={looks.get(order.key)}
              size="sm"
              selected={selectedOrderUid === order.key}
              note={`標準予測: ${clockLabel(caosBrewSec(order.cups.length))}`}
              onClick={() => setSelectedOrderUid(order.key)}
              className="cursor-pointer"
            />
          ))}
        </div>
      )}

      <h3 className="mt-4 mb-1.5 font-bold text-slate-700 text-xs">
        割当先のドリッパー（抽出担当者）:
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {lanes.map((lane) => (
          <button
            key={lane.id}
            type="button"
            disabled={!allowed(lane.id)}
            onClick={() => setSelectedBayId(lane.id)}
            className={`flex min-h-[72px] touch-manipulation flex-col justify-between rounded-lg border p-2 text-left disabled:opacity-30 ${
              selectedBayId === lane.id
                ? "border-emerald-600 bg-emerald-50 shadow-xs ring-1 ring-emerald-600"
                : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <LaneBadge bayId={lane.id} />
            <span className="text-[10px] text-slate-500">
              待機 {orderCount(lane.queued)}件
            </span>
          </button>
        ))}
      </div>
    </SidePanel>
  );
};

/** カードを動かす操作（待機の詳細と、抽出中のカードの緊急のパネルで共通） */
type MoveActions = Pick<
  ControlViewProps,
  "onMoveTicket" | "onReturnToUnassigned"
>;

// 待機・抽出中のカードを別のドリッパーへ（番号。今のドリッパーでも列の最後へ）・今のドリッパーの先頭へ（今から始める）・
// 待機の先頭へ（抽出中の次。logic/lanes の frontTargets）・未割当に戻す。押したら onDone
const MoveCardButtons: React.FC<
  MoveActions & {
    card: CaosCard;
    currentBayId: number | null;
    onDone: () => void;
  }
> = ({ card, currentBayId, onMoveTicket, onReturnToUnassigned, onDone }) => {
  const move = (bayId: number, place?: CaosPlace) => {
    onMoveTicket(card, bayId, place);
    onDone();
  };
  return (
    <>
      <h3 className="mt-5 mb-2 font-black text-[14px] text-slate-700">
        ドリッパーへ移す（列の最後へ）
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {moveTargets(card, currentBayId).map(({ bayId, current, disabled }) => (
          <button
            key={bayId}
            type="button"
            disabled={disabled}
            onClick={() => move(bayId)}
            className="h-16 touch-manipulation rounded-xl border-2 border-slate-300 bg-white font-black font-mono text-[24px] active:bg-slate-900 active:text-white disabled:opacity-30"
          >
            {current ? `${bayId} 最後へ` : bayId}
          </button>
        ))}
      </div>
      {currentBayId !== null && (
        <>
          <h3 className="mt-4 mb-2 font-black text-[14px] text-slate-700">
            {dripperLabel(currentBayId)} の中で動かす
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {frontTargets(card).map(({ place, label, hint, disabled }) => (
              <button
                key={place}
                type="button"
                disabled={disabled}
                onClick={() => move(currentBayId, place)}
                className="flex h-16 touch-manipulation flex-col items-center justify-center rounded-xl border-2 border-amber-300 bg-amber-50 font-black text-[18px] text-amber-950 active:bg-amber-900 active:text-white disabled:opacity-30"
              >
                {label}
                <span className="font-bold text-[12px]">（{hint}）</span>
              </button>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => {
          onReturnToUnassigned(card);
          onDone();
        }}
        className="mt-5 flex min-h-[60px] w-full touch-manipulation items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 font-black text-[16px] text-red-700 active:bg-red-100"
      >
        <Undo2 className="h-5 w-5" />
        未割り当に戻す
      </button>
    </>
  );
};

// 待機のカードの詳細（管制盤 C・D）。別のドリッパーへ・先頭へ・待機の先頭へ・未割当に戻す・統合の解除（統合したカードの 1 杯を外す）・
// 入れ直し（緊急）の取り消し。
// パネルの外を押すと閉じる
export const TicketDetailPanel: React.FC<
  MoveActions & {
    ticket: CaosCard;
    look?: CardLook;
    currentBayId: number | null;
    onClose: () => void;
    onSplitCup: (card: CaosCard, cupId: string) => void;
    /** 入れ直しのカードなら「緊急を取り消す」を出す（渡したときだけ） */
    onCancelEmergency?: (card: CaosCard) => void;
  }
> = ({
  ticket,
  look,
  currentBayId,
  onClose,
  onMoveTicket,
  onReturnToUnassigned,
  onSplitCup,
  onCancelEmergency,
}) => (
  <SidePanel title="未開始オーダーの移動" onClose={onClose}>
    <OrderCard card={ticket} look={look} size="xl" />
    <CommentList comments={look?.comments} className="mt-3" />
    <MoveCardButtons
      card={ticket}
      currentBayId={currentBayId}
      onMoveTicket={onMoveTicket}
      onReturnToUnassigned={onReturnToUnassigned}
      onDone={onClose}
    />
    {canSplitCard(ticket) && (
      <>
        <h3 className="mt-5 mb-2 font-black text-[14px] text-slate-700">
          統合を解除（外した 1 杯は未割当へ）
        </h3>
        <SplitCupButtons
          card={ticket}
          onSplit={(cupId) => {
            onSplitCup(ticket, cupId);
            onClose();
          }}
          className="grid grid-cols-2"
        />
      </>
    )}
    {ticket.emergency && onCancelEmergency && (
      <TwoStepButton
        label="緊急を取り消す"
        confirmLabel="もう一度押すと緊急を取り消す"
        onConfirm={() => {
          onCancelEmergency(ticket);
          onClose();
        }}
        className="mt-3 h-12 font-black text-base"
      />
    )}
    <p className="mt-5 flex items-center gap-2 rounded-lg bg-slate-100 p-3 font-bold text-[13px] text-slate-500">
      <ArrowRight className="h-4 w-4" />
      抽出中のカードは、押して開く緊急のパネルから移せます
    </p>
  </SidePanel>
);

// 緊急（入れ直し）の入力（マスターと同じ EmergencyForm）。抽出中・終わりのカードから開けば、そのカードのカップを全部選んでおく
// （注文をまたいで統合したカードは、番号は先頭のカップの注文で、ほかの注文のカップも選べる。外せば一部だけ）。ヘッダーから開けば番号から入れる。
// 確定すると、未割当のいちばん上に入れ直しのカードが出て（統合したカードの全部の杯なら、元のカードと同じ組み合わせの 1 枚）、そのカップのシール（レジで刷るのと同じもの）をこの端末から刷る（実データテスト中は刷らない）。
// 抽出中のカードから開いたときは、そのカードを 1〜6 に移す・未割当に戻すも出す。パネルの外を押すと閉じる
export const RebrewPanel: React.FC<
  Omit<EmergencyFormProps<CaosOrderInput>, "initial" | "onDone"> & {
    card?: CaosCard;
    look?: CardLook;
    onClose: () => void;
    move: MoveActions;
  }
> = ({ card, look, onClose, move, ...form }) => {
  const first = card?.cups[0];
  return (
    <SidePanel title="緊急（入れ直し）" onClose={onClose}>
      {card && (
        <div className="mb-4">
          <OrderCard card={card} look={look} size="xl" />
          <CommentList comments={look?.comments} className="mt-3" />
        </div>
      )}
      <EmergencyForm
        {...form}
        initial={
          first && {
            orderNo: first.orderNo,
            cupIds: card.cups.map((cup) => cup.cupId),
          }
        }
        onDone={onClose}
      />
      {card?.status === "brewing" && (
        <MoveCardButtons
          card={card}
          currentBayId={card.dripper}
          {...move}
          onDone={onClose}
        />
      )}
    </SidePanel>
  );
};

// 列の操作（管制盤 A・C・D のドリッパーの番号を押して開く）。担当者の交代と、この列の待機を全部別のドリッパーへ移す（並びのまま最後へ）。
// パネルの外を押すと閉じる
export const LanePanel: React.FC<{
  lane: Lane;
  onClose: () => void;
  onMoveQueue: (from: number, to: number) => void;
}> = ({ lane, onClose, onMoveQueue }) => (
  <SidePanel title={`ドリッパー ${dripperLabel(lane.id)}`} onClose={onClose}>
    <div className="flex items-center gap-2">
      <LaneName dripper={lane.id} className="font-black text-[18px]" />
      <LaneAbility dripper={lane.id} />
      <LaneChangeButton
        dripper={lane.id}
        layout="inline"
        className="ml-auto h-11 px-3"
      />
    </div>
    <h3 className="mt-5 mb-2 font-black text-[14px] text-slate-700">
      この列の待機 {orderCount(lane.queued)}件を移す
    </h3>
    <div className="grid grid-cols-3 gap-2">
      {DRIPPER_NUMBERS.map((to) => (
        <button
          key={to}
          type="button"
          disabled={to === lane.id || lane.queued.length === 0}
          data-move-queue={`${lane.id}-${to}`}
          onClick={() => {
            onMoveQueue(lane.id, to);
            onClose();
          }}
          className="h-16 touch-manipulation rounded-xl border-2 border-slate-300 bg-white font-black font-mono text-[24px] active:bg-slate-900 active:text-white disabled:opacity-30"
        >
          {to}
        </button>
      ))}
    </div>
  </SidePanel>
);

// 補助のタブ（ドリッパー・豆キュー・実績）。右のパネルで開く
export type AuxiliaryTab = "bays" | "beans" | "analytics";

export const AUXILIARY_TITLES: Record<AuxiliaryTab, string> = {
  bays: "ドリッパー",
  beans: "豆キュー",
  analytics: "実績",
};

export const AuxiliaryContent: React.FC<
  {
    tab: AuxiliaryTab;
    /** 豆キューに出す POS の在庫（豆だけ）と、盤面で待っている杯数 */
    beans: React.ComponentProps<typeof BeanQueueView>;
  } & React.ComponentProps<typeof AnalyticsView>
> = ({ tab, beans, lanes, ...analytics }) => {
  if (tab === "beans") return <BeanQueueView {...beans} />;
  if (tab === "analytics")
    return <AnalyticsView lanes={lanes} {...analytics} />;
  // ドリッパー：6 列（1st〜6th）の担当者（交代も）と、今の抽出と待ちの件数
  return (
    <div className="grid grid-cols-2 gap-2">
      {lanes.map((lane) => {
        const [current, ...waiting] = laneActive(lane);
        return (
          <article
            key={lane.id}
            className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs"
          >
            <div className="flex items-center gap-2">
              <LaneBadge bayId={lane.id} />
              <LaneName
                dripper={lane.id}
                className="font-black text-[14px] text-slate-950"
              />
              <LaneChooseButton dripper={lane.id} className="ml-auto" />
            </div>
            <div className="mt-2 border-slate-100 border-t pt-2 text-[12px]">
              {current ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold text-slate-700">
                    {cardName(current)}
                  </span>
                  <span className="shrink-0 font-black font-mono text-[15px] text-slate-950">
                    {orderLabel(current)}
                  </span>
                </div>
              ) : (
                <span className="font-bold text-slate-400">空き</span>
              )}
              <div className="mt-1 font-bold text-[11px] text-slate-500">
                待ち {orderCount(waiting)}件
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};

export const AuxiliarySheet: React.FC<{
  tab: AuxiliaryTab;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ tab, onClose, children }) => (
  <SidePanel title={AUXILIARY_TITLES[tab]} onClose={onClose}>
    {children}
  </SidePanel>
);
