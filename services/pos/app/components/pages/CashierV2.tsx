import {
  type MenuEntity,
  type OrderEntity,
  type PrinterSettings,
  type SquareActionOption,
  type SquareCheckout,
  SquareCheckoutConflictError,
  type SquarePaymentType,
  type WithId,
  shouldSplitOrder,
  squareRepository,
} from "@cafeore/common";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import bellTwice from "~/assets/bell_twice.mp3";
import { Switch } from "~/components/ui/switch";
import {
  RECEIPT_EPOS_PRINTER_CONFIG,
  eposCertificateUrl,
  eposPrinterAt,
} from "~/label/infra/epos";
import { labelPrintableWidth, receiptPrintableWidth } from "~/label/paper";
import {
  useLabelPrintProxy,
  useLabelPrintProxySetting,
} from "~/label/print-relay";
import { usePrinter, useReceiptPrinter } from "~/label/print-util";
import type { ReceiptPayment } from "~/label/receipt";
import { isModifierKey } from "~/lib/menuKey";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import {
  applyCashierOrderActionAtom,
  cashierDraftAtom,
  editingOrderAtom,
  updateCashierDraftAtom,
} from "../functional/cashierAtoms";
import {
  type CashierDraft,
  type CashierPayment,
  addLine,
  addReceived,
  assignLine,
  canAssignSelected,
  canGoPay,
  cashierKeyIntent,
  cashierPaymentKeyIntent,
  clearDigits,
  couponStatus,
  deleteDigit,
  emptyCashierDraft,
  focusCoupon,
  focusMemo,
  hasDraftInput,
  inputPadDigits,
  removeAllLines,
  removeLine,
  selectLine,
  setExactReceived,
  setMemo,
  setPayment,
  toggleSpecial,
} from "../functional/cashierDraft";
import {
  type CashierTender,
  allocateDiscount,
  beginRest,
  beginSubtotal,
  canLeavePayment,
  cancelPart,
  coffeeCupsOf,
  currentSubtotal,
  displayOrder,
  dueAmount,
  hasTenders,
  isSplittingSubtotal,
  leavePayment,
  paidLineKeys,
  preferDiscount,
  prepaidAmount,
  recordTender,
  removeTenders,
  setPart,
  splitChoices,
  splitOrderForSubmit,
  subtotalOrder,
  subtotalPaid,
  subtotalRemaining,
  unpaidLines,
} from "../functional/cashierSplit";
import { cashierAutoSquareRefundAtom } from "../functional/cashierUiAtoms";
import type { ConnectionIssue } from "../functional/connectionIssues";
import {
  type HeldKeys,
  emptyHeldKeys,
  heldKeyValues,
  heldLineKeys,
  pressKey,
  releaseKey,
  rememberAddedLine,
} from "../functional/heldKeys";
import { refundSquareOrderAutomatically } from "../functional/refundSquareOrderAutomatically";
import { useLatestOrderId } from "../functional/useLatestOrderId";
import type { OrderAction } from "../functional/useOrderState";
import type { SquareDeviceSelection } from "../functional/useSquareDevice";
import { useSquarePayment } from "../functional/useSquarePayment";
import {
  type SquarePaymentSelectRequest,
  useSquarePaymentSelect,
} from "../functional/useSquarePaymentSelect";
import { OrderIdDisplay } from "../molecules/OrderIdDisplay";
import { PendingPrints } from "../molecules/PendingPrints";
import { ReadyTimeEstimate } from "../molecules/ReadyTimeEstimate";
import { SquareDeviceSelect } from "../organisms/SquareDeviceSelect";
import {
  SquarePaymentDialog,
  squarePaymentTypeLabel,
} from "../organisms/SquarePaymentDialog";
import { SquareUnlinkedNotice } from "../organisms/SquareUnlinkedNotice";
import { AssignDialog } from "../organisms/cashier/AssignDialog";
import { ConfirmDialog } from "../organisms/cashier/ConfirmDialog";
import { LabelPrintProxySwitch } from "../organisms/cashier/LabelPrintProxySwitch";
import { MemoDialog } from "../organisms/cashier/MemoDialog";
import {
  MenuPanel,
  RegisterKeyHints,
  exampleMenuKeys,
} from "../organisms/cashier/MenuPanel";
import { OrderPanel } from "../organisms/cashier/OrderPanel";
import { PastOrdersView } from "../organisms/cashier/PastOrdersView";
import {
  type BreakdownBarSegment,
  PayBreakdown,
} from "../organisms/cashier/PayBreakdown";
import { PayPanel } from "../organisms/cashier/PayPanel";
import {
  PartAmountDialog,
  PartPaidDialog,
  type ReceivedTender,
  RefundDialog,
  SettledDialog,
  type SettledRow,
  SplitChoiceDialog,
  type SquareRefundResult,
  SubtotalItemsDialog,
  SubtotalPaidDialog,
} from "../organisms/cashier/PrepayDialogs";
import {
  ConnectionIssueDot,
  PrinterStatusDot,
} from "../organisms/cashier/PrinterStatusDot";
import { RegisterStrip } from "../organisms/cashier/RegisterStrip";
import { tenderDot, tenderLabel } from "../organisms/cashier/tenderStyle";
import { Label } from "../ui/label";

type props = {
  items: WithId<MenuEntity>[] | undefined; // itemMasterを渡す
  /** キャンセルした注文も含む全部の注文（番号・引換券・過去の注文に使う） */
  orders: WithId<OrderEntity>[] | undefined;
  wsStatus: "connecting" | "open" | "closed" | "error";
  /** つながっていないもの（バックエンド・データベースなど）。ヘッダーのプリンターの左に出す */
  connectionIssues: ConnectionIssue[];
  /** 今すぐ保存できるか（つながっているか）。Square の会計はこのときだけ */
  canSaveNow: boolean;
  /** Square 連携が有効か。無効なら Square のボタンも端末の選択も出さない */
  squareEnabled: boolean;
  /** このレジで使う Square 端末。決まっていなければ Square のボタンを出さない */
  squareDevice: SquareDeviceSelection;
  /** つなぐプリンター（ラベル用・レシート用）の IP アドレスと、レシート用のプリンターの機種 */
  printerAddresses: PrinterSettings;
  /** 注文を裏で送る。onSaved は、すぐに送って保存できたときに呼ぶ */
  submitPayload: (
    order: OrderEntity,
    onSaved?: (savedOrder: WithId<OrderEntity>) => void,
  ) => void;
  /** Square で支払い済みの注文を送り、登録した注文を返す。登録できなければ reject する */
  submitSquarePayload: (
    order: OrderEntity,
    squareCheckoutId: string,
  ) => Promise<WithId<OrderEntity>>;
  syncOrder: (order: OrderEntity) => void;
};

/** 会計の欄に出す Square の決済手段（左から順）。電子マネー（FELICA_ALL）は使わない */
const SQUARE_PAYMENT_TYPES: readonly SquarePaymentType[] = [
  "CARD_PRESENT",
  "QR_CODE",
];
const NO_SQUARE_PAYMENT_TYPES: readonly SquarePaymentType[] = [];

/** 送ったことを知らせる表示を出しておく時間 */
const NOTICE_MS = 2600;

/**
 * 入力欄・ダイアログ・シートの中で押したキー。レジのキー操作には使わない
 */
const isOutsideRegister = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog']",
  ) !== null;

type CashierDialogKind =
  | "assign"
  | "memo"
  | "removeAll"
  | "reset"
  | "cancelPayment";

/** 先払い（個別小計・小計分割）のダイアログ */
type PrepayDialogState =
  /** お客さんが端末で「割り勘」を選んだ。分け方（個別小計・小計分割）を選ぶ */
  | { kind: "splitChoice" }
  /** 個別小計の商品を選ぶ */
  | { kind: "items" }
  /** 小計分割の金額を入れる。preset は端末で決済できなかった決済手段（その手段で先に払う） */
  | { kind: "part"; preset: SquarePaymentType | null }
  /** 小計を金額で分けて受け取った（小計の残りがある） */
  | { kind: "partPaid"; tender: ReceivedTender }
  /** 個別小計を払い終えた（注文の残りがある） */
  | { kind: "subtotalPaid"; tender: ReceivedTender }
  /** 先払いを返金する（先会計の × は小計の分、先払いを取り消すは全部） */
  | {
      kind: "refund";
      all: boolean;
      tenderIds: number[];
      subtotalIds: number[];
    }
  /** 注文全体を払い終えた（先払いがあったときだけ） */
  | {
      kind: "settled";
      orderId: number;
      rows: SettledRow[];
      total: number;
      lastCash: ReceivedTender["cash"];
    };

/** 受け取った支払いを、受け取ったあとのダイアログに出す形にする */
const receivedTender = (
  tender: Omit<CashierTender, "id" | "subtotalId">,
): ReceivedTender => ({
  amount: tender.amount,
  methodLabel: tenderLabel(tender),
  cash:
    tender.method === "cash"
      ? { received: tender.received, change: tender.received - tender.amount }
      : null,
});

/** Square の返金の結果を、返金のダイアログに出す形にする */
const squareRefundResult = (checkout: SquareCheckout): SquareRefundResult =>
  checkout.refund_status === "pending" || checkout.refund_status === "refunded"
    ? { ok: true }
    : {
        ok: false,
        message:
          checkout.refund_status === "unknown"
            ? `返金できたか確かめられませんでした。もう一度押すと確かめます: ${checkout.refund_error ?? ""}`
            : (checkout.refund_error ?? "Square が受け付けませんでした"),
      };

/**
 * キャッシャー画面のコンポーネント
 *
 * メニュー｜注文（商品・割引・備考）｜会計 の 3 列。商品を入れて「一括会計」で会計の段階に進み、
 * 受取金額か Square の決済手段を選んで確定する。データの入出力は親コンポーネントに任せる
 *
 * 「個別小計」で商品を選んだ分、「小計分割・一部金額先払い」で金額で分けた分を先に会計できる
 * （cashierSplit）。受け取った分（先会計）は覚えておき、注文全体を払い終えたら、支払いを全部付けて
 * 注文を 1 つ送る。会計中は左の列に内訳を出す。
 */
const CashierV2 = ({
  items,
  orders,
  wsStatus,
  connectionIssues,
  canSaveNow,
  squareEnabled,
  squareDevice,
  printerAddresses,
  submitPayload,
  submitSquarePayload,
  syncOrder,
}: props) => {
  const newOrder = useAtomValue(editingOrderAtom);
  const draft = useAtomValue(cashierDraftAtom);
  const setDraft = useSetAtom(cashierDraftAtom);
  const applyOrderAction = useSetAtom(applyCashierOrderActionAtom);
  const applyDraftUpdate = useSetAtom(updateCashierDraftAtom);
  const [autoSquareRefund, setAutoSquareRefund] = useAtom(
    cashierAutoSquareRefundAtom,
  );
  const [view, setView] = useState<"register" | "past">("register");
  const [dialog, setDialog] = useState<CashierDialogKind | null>(null);
  const [prepayDialog, setPrepayDialog] = useState<PrepayDialogState | null>(
    null,
  );
  const [notice, setNotice] = useState<{ text: string; sub: string } | null>(
    null,
  );
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // 作る量の見込みには、キャンセルした注文を入れない（orders はキャンセルした注文も含む）
  const activeOrders = useMemo(
    () => orders?.filter((order) => !order.isCancelled()),
    [orders],
  );
  const { nextOrderId, manualOrderId, setOrderIdOverride, markOrderIdIssued } =
    useLatestOrderId(orders, canSaveNow);
  // 確定できるのは番号が決まっているとき：つながっていれば自動の番号、オフラインなら手で付けた番号。
  // オフラインの注文はこの端末に溜まり、つながったらまとめて送る（submitPayload）
  const canSubmitOrder = canSaveNow || manualOrderId !== null;
  // 番号を手で付ける必要があるのは、今すぐ保存できないとき（つなぎ始めの connecting は待つ）。
  // 端末がオフラインでも、切れたことに気づくまで WebSocket は open のままのことがあるので、wsStatus だけでは見ない
  const isNeedManualOrderId = !canSaveNow && wsStatus !== "connecting";
  const soundRef = useRef<HTMLAudioElement>(null);
  const store = useStore();
  /**
   * お客さん向けの表示（cashier-mini）に入力中の注文を送る。個別小計の会計中は小計の商品だけを、
   * 先払いがあるときはお釣りを間違えて見せないよう受取金額を出さない（displayOrder）
   */
  const syncDisplay = useCallback(
    (order: OrderEntity) => {
      syncOrder(displayOrder(order, store.get(cashierDraftAtom)));
    },
    [store, syncOrder],
  );
  /** 段階が変わったとき（注文の中身は変わらない）に、お客さん向けの表示を送り直す */
  const resyncDisplay = useCallback(
    () => syncDisplay(store.get(editingOrderAtom)),
    [store, syncDisplay],
  );
  const dispatchOrder = useCallback(
    (action: OrderAction) => {
      applyOrderAction({ action, syncOrder: syncDisplay });
    },
    [applyOrderAction, syncDisplay],
  );
  const updateDraft = useCallback(
    (update: (draft: CashierDraft) => CashierDraft) => {
      applyDraftUpdate({ update, syncOrder: syncDisplay });
    },
    [applyDraftUpdate, syncDisplay],
  );

  const playSound = useCallback(() => {
    soundRef.current?.play();
  }, []);

  const showNotice = useCallback((text: string, sub: string) => {
    clearTimeout(noticeTimerRef.current);
    setNotice({ text, sub });
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  // プリンターの IP アドレスが変わったら、つなぎ直す。用紙が変わっても、つなぎ直さずに刷るものの幅だけ変える
  const labelPrinterIp = printerAddresses.label_printer_ip;
  const printer = usePrinter(
    useMemo(() => eposPrinterAt(labelPrinterIp), [labelPrinterIp]),
    labelPrintableWidth(printerAddresses),
  );
  // 代理印刷をオンにしたレジは、CaOS・マスターが直接刷れなかった緊急のシールを、このレジのラベル用のプリンターで刷る
  const [labelPrintProxy, setLabelPrintProxy] = useLabelPrintProxySetting();
  const labelPrintRelay = useLabelPrintProxy(labelPrintProxy, printer);
  // レシートは会計のたびに刷る。領収書は過去の注文から求められたときだけ刷る。
  // 機種・用紙が変わっても、つなぎ直さずに画像の幅だけ変える
  const receiptPrinterIp = printerAddresses.receipt_printer_ip;
  const receiptPrinter = useReceiptPrinter(
    useMemo(
      () => eposPrinterAt(receiptPrinterIp, RECEIPT_EPOS_PRINTER_CONFIG),
      [receiptPrinterIp],
    ),
    receiptPrintableWidth(printerAddresses),
  );

  /**
   * 注文のシールを刷る。刷るのは会計を終えて注文を送るとき（注文全体を払い終えたとき）だけで、
   * 一括会計・Square の決済を始めたとき・先払いの途中では刷らない
   */
  const printOrderLabel = printer.printOrderLabel;

  // 先払いのレシートを刷った注文は、レシートに載せた番号（No.）のまま確定する（別のレジが送って次の番号が進んでも変えない）
  const fixedOrderId = draft.fixedOrderId;
  /**
   * FIXME #412 useEffect内でstateを更新している
   * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
   */
  useEffect(() => {
    dispatchOrder({
      type: "updateOrderId",
      orderId: fixedOrderId ?? nextOrderId,
    });
  }, [fixedOrderId, nextOrderId, dispatchOrder]);

  // 引換券番号を過去の注文と照らし合わせる。過去の注文が変わったら（提供された・別のレジで使われた）照らし直す
  const coupon = useMemo(
    () => couponStatus(draft.coupon, orders ?? []),
    [draft.coupon, orders],
  );
  // 打った番号で備考に移るか・打ち直すかの照合。過去の注文がまだ届いていなければ、割引できないと決めつけない
  const checkCoupon = useMemo(
    () =>
      orders === undefined
        ? undefined
        : (value: string) => couponStatus(value, orders),
    [orders],
  );
  const couponApplied = coupon.kind === "available";
  const couponOrderRef = useRef<WithId<OrderEntity> | null>(null);
  couponOrderRef.current = couponApplied ? coupon.order : null;
  const discountKey = draft.special
    ? "special"
    : couponApplied
      ? `coupon:${coupon.order.orderId}:${coupon.order.getCoffeeCups().length}`
      : "none";

  /**
   * FIXME #412 useEffect内でstateを更新している
   * 割引は過去の注文で決まるので、引換券番号・特殊な割引・過去の注文が変わるたびに注文へ写す
   */
  useEffect(() => {
    if (discountKey === "special") {
      dispatchOrder({ type: "applyServiceOneCupDiscount" });
    } else if (discountKey !== "none" && couponOrderRef.current) {
      dispatchOrder({
        type: "applyDiscount",
        discountOrder: couponOrderRef.current,
      });
    } else {
      dispatchOrder({ type: "removeDiscount" });
    }
  }, [discountKey, dispatchOrder]);

  const resetAll = useCallback(() => {
    dispatchOrder({ type: "clear" });
    setDraft(emptyCashierDraft());
    setDialog(null);
    setPrepayDialog(null);
  }, [dispatchOrder, setDraft]);

  const itemCount = newOrder.menus.length;
  const billing = newOrder.billingAmount;

  // 先払い（個別小計・小計分割）。割引は注文全体で割り引く杯数をコーヒーに割り振る
  const discountPerCup = newOrder.DISCOUNT_PER_CUP;
  const discountCups = newOrder.discount / discountPerCup;
  const split = draft.split;
  const paying = draft.step === "pay";
  const locked = hasTenders(draft);
  const prepaid = prepaidAmount(split);
  const orderRemaining = billing - prepaid;
  const current = currentSubtotal(draft);
  const currentRemaining =
    current === null ? orderRemaining : subtotalRemaining(split, current);
  const unpaid = unpaidLines(draft);
  /**
   * 一括で払う（先払いが無く、まだ払っていない商品を全部 1 つの小計にして、分けていない）。
   * このときは今までどおり 1 回の支払いで注文を送る
   */
  const wholeOrder =
    current !== null &&
    split.tenders.length === 0 &&
    split.part === null &&
    unpaid.every((line) => current.lineKeys.includes(line.key));
  // 小計。会計の段階は今払う額、入れる段階は注文の残り
  const due = !paying
    ? orderRemaining
    : wholeOrder
      ? billing
      : dueAmount(draft);

  // Square のボタンは、このレジで使う端末が決まっているときだけ出す
  const squareDeviceId = squareEnabled
    ? (squareDevice.device?.device_id ?? null)
    : null;
  const squarePaymentTypes =
    squareDeviceId !== null ? SQUARE_PAYMENT_TYPES : NO_SQUARE_PAYMENT_TYPES;
  // Square の決済は 1 円から
  const canStartSquare = canSaveNow && paying && itemCount > 0 && due >= 1;
  // 会計の段階で ↑↓ で選べる決済手段
  const payments = useMemo<CashierPayment[]>(
    () => (canStartSquare ? ["cash", ...squarePaymentTypes] : ["cash"]),
    [canStartSquare, squarePaymentTypes],
  );
  // 選んでいた Square が使えなくなったら（切れた・端末を外した）、現金に戻して見せる
  const viewDraft = useMemo(
    () =>
      payments.includes(draft.payment) ? draft : setPayment(draft, "cash"),
    [draft, payments],
  );

  /** 送る直前の注文を作る。createdAt を今にし、特記事項を足す（決済の途中からも呼ぶので、ストアから読む） */
  const prepareSubmit = useCallback(
    (base: OrderEntity) => {
      const submitOne = base.clone();
      submitOne.nowCreated();
      submitOne.addComment("cashier", store.get(cashierDraftAtom).memo);
      return submitOne;
    },
    [store],
  );

  /** 注文を送った後、次の注文を入力できるようにする */
  const afterSubmit = useCallback(() => {
    // 手動番号指定時、オフラインなら次の番号を手動のまま進める。
    // オンラインなら自動に戻し、届いている注文と手元の最大 + 1 にする（同じ番号を続けて付けない）
    if (manualOrderId !== null) {
      setOrderIdOverride(canSaveNow ? null : manualOrderId + 1);
    }
    resetAll();
    playSound();
  }, [manualOrderId, canSaveNow, setOrderIdOverride, resetAll, playSound]);

  /** 注文を送った後、次の注文を入力できるようにし、送ったことを知らせる */
  const finishSubmit = useCallback(
    (orderId: number, sub: string) => {
      afterSubmit();
      showNotice(`No.${orderId} を送信しました`, sub);
    },
    [afterSubmit, showNotice],
  );

  /**
   * 会計中の小計で受け取った（一括で払う注文でないとき）。その分のレシート（引換券番号は載せない）を刷り、
   * 受け取った分として覚える。注文全体を払い終えたら、支払いを全部付けて注文を送り、引換券番号のレシートを
   * 別に刷って、支払いの内訳とお釣りを出す。
   * まだ残っていれば、小計の残り（金額で分けた）か残りの商品（個別小計を払い終えた）を出し、
   * レシートに載せた番号（No.）で確定するよう、番号を固定する。
   * 下書きは決済の途中（非同期）からも呼ぶので、ストアから今の値を読む
   */
  const completeTender = useCallback(
    (
      tender: Omit<CashierTender, "id" | "subtotalId">,
      receipt: ReceiptPayment,
    ) => {
      const before = store.get(cashierDraftAtom);
      const order = store.get(editingOrderAtom);
      const subtotal = currentSubtotal(before);
      if (subtotal === null) {
        return;
      }
      const paidBefore = subtotalPaid(before.split, subtotal.id);
      const receiptOrder = subtotalOrder(
        order,
        before,
        subtotal,
        tender.received,
      );
      receiptOrder.nowCreated();
      receiptPrinter.printReceipt(receiptOrder, receipt, {
        prepaid: paidBefore,
        deferred: Math.max(subtotal.amount - paidBefore - tender.amount, 0),
      });
      const after = recordTender(before, tender);
      const received = receivedTender(tender);
      if (after.split.current === null && unpaidLines(after).length === 0) {
        const submitOne = splitOrderForSubmit(prepareSubmit(order), after);
        printOrderLabel(submitOne);
        receiptPrinter.printClaimReceipt(submitOne);
        const paidBySquare = submitOne.payments.some(
          (payment) => payment.method === "square",
        );
        // 「常に返金」なら、登録できたあとに Square で払った分を裏で返金する（注文は残す）
        submitPayload(
          submitOne,
          autoSquareRefund && paidBySquare
            ? (saved) => void refundSquareOrderAutomatically(saved)
            : undefined,
        );
        markOrderIdIssued(submitOne.orderId);
        afterSubmit();
        setPrepayDialog({
          kind: "settled",
          orderId: submitOne.orderId,
          rows: after.split.tenders.map((t) => ({
            id: t.id,
            label: tenderLabel(t),
            amount: t.amount,
            dot: tenderDot(t),
          })),
          total: submitOne.billingAmount,
          lastCash: received.cash,
        });
        return;
      }
      updateDraft(() => ({
        ...after,
        fixedOrderId: after.fixedOrderId ?? order.orderId,
      }));
      resyncDisplay();
      setPrepayDialog(
        after.split.current !== null
          ? { kind: "partPaid", tender: received }
          : { kind: "subtotalPaid", tender: received },
      );
    },
    [
      store,
      receiptPrinter,
      prepareSubmit,
      printOrderLabel,
      submitPayload,
      autoSquareRefund,
      markOrderIdIssued,
      afterSubmit,
      updateDraft,
      resyncDisplay,
    ],
  );

  /** 現金で送る。exactPayment なら受取金額を請求額ちょうどにする（お釣り 0） */
  const submitCash = useCallback(
    (exactPayment: boolean) => {
      if (!canSubmitOrder || draft.step !== "pay") {
        return;
      }
      if (!wholeOrder) {
        const received = exactPayment
          ? due
          : draft.received === ""
            ? null
            : Number(draft.received);
        if (due < 0 || received === null || received < due) {
          return;
        }
        completeTender(
          { method: "cash", amount: due, received },
          { method: "cash" },
        );
        return;
      }
      if (newOrder.menus.length === 0) {
        return;
      }
      if (
        exactPayment
          ? newOrder.billingAmount < 0
          : draft.received === "" || newOrder.getCharge() < 0
      ) {
        return;
      }
      const submitOne = prepareSubmit(newOrder);
      if (exactPayment) submitOne.received = submitOne.billingAmount;
      printOrderLabel(submitOne);
      receiptPrinter.printReceipt(submitOne, { method: "cash" });
      submitPayload(submitOne);
      markOrderIdIssued(submitOne.orderId);
      finishSubmit(
        submitOne.orderId,
        `お釣り ${formatYen(submitOne.getCharge())}`,
      );
    },
    [
      canSubmitOrder,
      draft.step,
      draft.received,
      wholeOrder,
      due,
      completeTender,
      newOrder,
      prepareSubmit,
      printOrderLabel,
      receiptPrinter,
      submitPayload,
      markOrderIdIssued,
      finishSubmit,
    ],
  );

  /**
   * Square で支払い済みの注文を送る。送れたら true
   *
   * 注文（order）を、その注文番号のまま送る。お預かりは請求額と同じにする。
   * 登録できたと分かってから入力を消し、シールとレシートを刷る。
   * 登録に失敗したら reject する（お金は受け取っているので、呼ぶ側で支払い済みのまま送り直せるようにする）。
   * 「常に返金（キャンセルしない）」なら、登録できたあとに裏で返金する（注文は残す）。返金できなくても
   * 登録は済んでいるので reject しない（送り直すと断られるだけ）。結果はトーストで知らせる。
   */
  const submitSquareOrder = useCallback(
    async (checkout: SquareCheckout, order: OrderEntity): Promise<boolean> => {
      if (!canSaveNow || order.menus.length === 0) {
        return false;
      }
      const submitOne = prepareSubmit(order);
      submitOne.received = submitOne.billingAmount;
      const savedOrder = await submitSquarePayload(submitOne, checkout.id);
      markOrderIdIssued(submitOne.orderId);
      if (autoSquareRefund) {
        void refundSquareOrderAutomatically(savedOrder);
      }
      printOrderLabel(submitOne);
      receiptPrinter.printReceipt(submitOne, {
        method: "square",
        paymentType: checkout.payment_type,
      });
      const paymentLabel =
        squarePaymentTypeLabel[checkout.payment_type as SquarePaymentType] ??
        checkout.payment_type;
      finishSubmit(submitOne.orderId, `Square・${paymentLabel}`);
      return true;
    },
    [
      canSaveNow,
      prepareSubmit,
      submitSquarePayload,
      markOrderIdIssued,
      autoSquareRefund,
      printOrderLabel,
      receiptPrinter,
      finishSubmit,
    ],
  );

  /** 小計の分（一括で払う注文でない）を Square で払っている。決済が終わったら受け取った分として覚える */
  const subtotalSquareRef = useRef(false);

  // 注文全体を払うときは、支払いが確定して注文を登録できたらシールを刷る。
  // 番号は決済を始めた時点ではなく今の番号で登録する（支払いを待つ間に別のレジが同じ番号で送っても重ならないように）。
  // 小計の分を払うときは、決済するのはその額だけ。支払いが確定したら受け取った分として覚え、
  // 注文全体を払い終えたら注文を送ってシールを刷る（completeTender）。
  const squarePayment = useSquarePayment({
    onPaid: async (checkout, order) => {
      if (!subtotalSquareRef.current) {
        const paid = order.clone();
        paid.orderId = store.get(editingOrderAtom).orderId;
        return submitSquareOrder(checkout, paid);
      }
      subtotalSquareRef.current = false;
      completeTender(
        {
          method: "square",
          amount: checkout.amount,
          received: checkout.amount,
          squareCheckoutId: checkout.id,
          squarePaymentType: checkout.payment_type as SquarePaymentType,
        },
        { method: "square", paymentType: checkout.payment_type },
      );
      return true;
    },
  });
  const squarePaymentActive = squarePayment.active;

  // 割り勘の分け方。端末の「割り勘」は、どちらかに進めるときだけ並べる
  // （小計分割の途中は、受け取ったあとの「残りを全て会計」を含めて並べない）
  const choices = splitChoices(draft, squarePaymentActive);
  const offerSplit =
    !isSplittingSubtotal(draft) &&
    (choices.items === null || choices.part === null);

  /**
   * お客さんが Square 端末で決済手段を選べるようにする（会計の段階で、スタッフがまだ選んでいない間）。
   * 選んだら、その決済手段で会計する（onTerminalSelectedRef）。「割り勘」なら分け方を選ぶウィンドウを出す。
   * スタッフがレジで決済手段を選ぶ（dismiss）・決済を始める・会計を終える・今払う額が変わる・
   * 先払いのダイアログを開くと取り消す
   */
  const squareSelectRequest = useMemo<SquarePaymentSelectRequest | null>(() => {
    if (
      squareDeviceId === null ||
      !canStartSquare ||
      squarePaymentActive ||
      prepayDialog !== null
    ) {
      return null;
    }
    const options: SquareActionOption[] = [
      "CASH",
      ...squarePaymentTypes,
      ...(offerSplit ? (["SPLIT"] as const) : []),
    ];
    return {
      key: `${squareDeviceId}:${current?.id ?? ""}:${split.tenders.length}:${due}:${options.join(",")}`,
      deviceId: squareDeviceId,
      amount: due,
      options,
    };
  }, [
    squareDeviceId,
    canStartSquare,
    squarePaymentActive,
    prepayDialog,
    current?.id,
    split.tenders.length,
    due,
    squarePaymentTypes,
    offerSplit,
  ]);
  // お客さんが選んだときは決済を始める（startSquarePayment）ので、それを作ってから中身を入れる
  const onTerminalSelectedRef = useRef<(option: SquareActionOption) => void>(
    () => {},
  );
  const squareSelect = useSquarePaymentSelect({
    request: squareSelectRequest,
    onSelected: (option) => onTerminalSelectedRef.current(option),
  });
  const dismissSquareSelect = squareSelect.dismiss;

  /** 会計の段階で、スタッフが決済の欄（決済手段・受取金額）を操作した。お客さんには端末で選ばせない */
  const updatePayment = useCallback(
    (update: (draft: CashierDraft) => CashierDraft) => {
      if (store.get(cashierDraftAtom).step === "pay") {
        dismissSquareSelect();
      }
      updateDraft(update);
    },
    [store, dismissSquareSelect, updateDraft],
  );

  /** 「未登録の Square 決済」を、入力中の注文（今の番号）で登録し、シールとレシートを刷る */
  const submitUnlinkedSquareOrder = useCallback(
    (checkout: SquareCheckout) => {
      submitSquareOrder(checkout, newOrder).catch((error) => {
        toast.error(
          `注文を送れませんでした: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    },
    [newOrder, submitSquareOrder],
  );

  const startSquarePayment = useCallback(
    (paymentType: SquarePaymentType) => {
      if (
        draft.step !== "pay" ||
        !canStartSquare ||
        squareDeviceId === null ||
        squarePaymentActive
      ) {
        return;
      }
      dismissSquareSelect();
      updateDraft((c) => setPayment(c, paymentType));
      if (!wholeOrder && current !== null) {
        // 小計の分は、今払う額だけを決済する
        subtotalSquareRef.current = true;
        squarePayment.start(
          subtotalOrder(newOrder, draft, current, 0),
          paymentType,
          squareDeviceId,
          due,
        );
        return;
      }
      subtotalSquareRef.current = false;
      squarePayment.start(newOrder, paymentType, squareDeviceId);
    },
    [
      draft,
      canStartSquare,
      squareDeviceId,
      squarePaymentActive,
      dismissSquareSelect,
      updateDraft,
      squarePayment.start,
      newOrder,
      wholeOrder,
      current,
      due,
    ],
  );

  /**
   * 小計を作って会計の段階に進む。シールはまだ刷らず、注文全体を払い終えて注文を送るときに刷る
   * （個別小計・小計分割でも、注文全体のシールを最後に 1 回だけ刷る）
   */
  const startSubtotal = useCallback(
    (update: (draft: CashierDraft) => CashierDraft) => {
      updateDraft(update);
      setPrepayDialog(null);
      resyncDisplay();
    },
    [updateDraft, resyncDisplay],
  );

  /** 一括会計・残りを会計。まだ払っていない商品を全部 1 つの小計にして会計する */
  const startPayment = useCallback(() => {
    if (!canGoPay(store.get(cashierDraftAtom))) {
      return;
    }
    startSubtotal((c) => beginRest(c, discountCups, discountPerCup));
  }, [store, startSubtotal, discountCups, discountPerCup]);

  /**
   * 決済手段のキーで選んだ Square の決済手段が、今は使えないことを知らせる。
   * 理由は canStartSquare・payments と同じ順に見る
   */
  const warnSquareUnavailable = useCallback(
    (paymentType: SquarePaymentType) => {
      const reason =
        squareDeviceId === null
          ? "Square の端末が決まっていません"
          : !canSaveNow
            ? "つながっていません（現金ならオフラインでも払えます）"
            : due < 1
              ? "請求額が 0 円です。現金で確定してください"
              : "今は始められません";
      toast.warning(
        `${squarePaymentTypeLabel[paymentType]}は使えません：${reason}`,
      );
    },
    [squareDeviceId, canSaveNow, due],
  );

  // 入れる段階で決済手段のキー（Alt+C・Alt+T など）を押したら、会計の段階に進んでからその決済手段を選ぶ
  // （今払う額は、進んで小計を作ってから決まるので）。Square の決済手段なら決済を始める
  const [queuedPayment, setQueuedPayment] = useState<CashierPayment | null>(
    null,
  );
  useEffect(() => {
    if (queuedPayment === null) {
      return;
    }
    setQueuedPayment(null);
    if (!paying) {
      return;
    }
    if (queuedPayment === "cash") {
      // 現金を選んで進んだので、お客さんには端末で選ばせない
      dismissSquareSelect();
    } else if (payments.includes(queuedPayment)) {
      startSquarePayment(queuedPayment);
    } else {
      warnSquareUnavailable(queuedPayment);
    }
  }, [
    queuedPayment,
    paying,
    payments,
    dismissSquareSelect,
    startSquarePayment,
    warnSquareUnavailable,
  ]);

  // お客さんが端末で選んだ。現金ならレジを現金にして知らせ、Square の決済手段なら決済を始める。
  // 「割り勘」なら分け方を選ぶウィンドウを出す
  onTerminalSelectedRef.current = (option) => {
    if (option === "SPLIT") {
      setPrepayDialog({ kind: "splitChoice" });
    } else if (option === "CASH") {
      updateDraft((c) => setPayment(c, "cash"));
      showNotice(
        "お客さんが端末で現金を選びました",
        "受取金額を入れて確定してください",
      );
    } else if (payments.includes(option)) {
      startSquarePayment(option);
    } else {
      warnSquareUnavailable(option);
    }
  };

  /** 個別小計。選んだ商品の小計を会計する */
  const startItemsSubtotal = useCallback(
    (keys: number[]) =>
      startSubtotal((c) =>
        beginSubtotal(c, "items", keys, discountCups, discountPerCup),
      ),
    [startSubtotal, discountCups, discountPerCup],
  );

  /** 個別小計の商品を選ぶ（入れる段階で、まだ払っていない商品が 2 点以上） */
  const canOpenItems = draft.step === "entry" && unpaid.length >= 2;
  const openItems = useCallback(() => {
    if (canOpenItems) {
      setPrepayDialog({ kind: "items" });
    }
  }, [canOpenItems]);

  /**
   * 会計取消。会計をやめて入れる段階に戻る（シールはまだ刷っていない）。
   * 小計の途中まで払ったら、払い終えるか取り消すまで戻れない
   */
  const cancelPayment = useCallback(() => {
    if (!canLeavePayment(draft)) {
      return;
    }
    updateDraft(leavePayment);
    resyncDisplay();
  }, [draft, updateDraft, resyncDisplay]);

  /**
   * 会計の段階で、薄くしたメニューを押した。会計を取り消すか尋ねる。
   * 小計を途中まで払ったら戻れないので、尋ねずに知らせる
   */
  const confirmCancelPayment = useCallback(() => {
    if (!canLeavePayment(draft)) {
      toast.warning(
        "この小計を途中まで払ったので、払い終えるか取り消すまで戻れません",
      );
      return;
    }
    setDialog("cancelPayment");
  }, [draft]);

  /**
   * 割り勘の分け方で個別小計を選んだ。会計の段階を抜けて（会計取消と同じ）、先に払う商品を選ぶ。
   * 選ぶのをやめたら入れる段階のまま
   */
  const switchToItems = useCallback(() => {
    if (choices.items !== null) {
      return;
    }
    updateDraft(leavePayment);
    resyncDisplay();
    setPrepayDialog({ kind: "items" });
  }, [choices.items, updateDraft, resyncDisplay]);

  /** 会計の段階の Esc。小計分割中なら分割をやめ、でなければ会計取消 */
  const leavePay = useCallback(() => {
    if (draft.split.part !== null) {
      updateDraft(cancelPart);
      resyncDisplay();
      return;
    }
    cancelPayment();
  }, [draft.split.part, updateDraft, resyncDisplay, cancelPayment]);

  /** 小計分割・一部金額先払い。いまの小計（の残り）を金額で分ける。割り勘のウィンドウのボタンと同じ条件で開く */
  const canSplit = choices.part === null;
  const openPart = useCallback(() => {
    if (canSplit) {
      setPrepayDialog({ kind: "part", preset: null });
    }
  }, [canSplit]);

  /** 先払いを返金する。subtotalId を渡せばその小計の分、渡さなければ全部 */
  const openRefund = useCallback(
    (subtotalId?: number) => {
      const tenders = split.tenders.filter(
        (t) => subtotalId === undefined || t.subtotalId === subtotalId,
      );
      if (tenders.length === 0) {
        return;
      }
      setPrepayDialog({
        kind: "refund",
        all: subtotalId === undefined,
        tenderIds: tenders.map((t) => t.id),
        subtotalIds:
          subtotalId === undefined
            ? split.subtotals.map((s) => s.id)
            : [subtotalId],
      });
    },
    [split],
  );

  /** 先払いの Square の決済を全額返金する（注文はまだ無いので、決済依頼を返金する） */
  const refundSquare = useCallback(
    async (checkoutId: string): Promise<SquareRefundResult> => {
      try {
        return squareRefundResult(
          await squareRepository.refundCheckout(checkoutId),
        );
      } catch (error) {
        if (error instanceof SquareCheckoutConflictError) {
          return { ok: false, message: error.message };
        }
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [],
  );

  /** 番号を手で付け直す。先払いのレシートで固定した番号があっても、手で付けた番号を使う */
  const overrideOrderId = useCallback(
    (orderId: number | null) => {
      updateDraft((current) =>
        current.fixedOrderId === null
          ? current
          : { ...current, fixedOrderId: null },
      );
      setOrderIdOverride(orderId);
    },
    [updateDraft, setOrderIdOverride],
  );

  const openAssign = useCallback(() => {
    if (canAssignSelected(draft)) {
      setDialog("assign");
    }
  }, [draft]);

  const openMemo = useCallback(() => {
    updateDraft(focusMemo);
    setDialog("memo");
  }, [updateDraft]);

  const openRemoveAll = useCallback(() => {
    if (newOrder.menus.length > 0) {
      setDialog("removeAll");
    }
  }, [newOrder]);

  // 押しているキー（同時押しの商品のため）。離したキーは、レジのキー操作を使わない間も忘れる
  const heldKeysRef = useRef<HeldKeys>(emptyHeldKeys());
  useEffect(() => {
    const release = (event: KeyboardEvent) => {
      heldKeysRef.current = releaseKey(
        heldKeysRef.current,
        event.code || event.key,
      );
    };
    // ほかのウィンドウに移ると keyup が届かないので、全部離したことにする
    const releaseAll = () => {
      heldKeysRef.current = emptyHeldKeys();
    };
    window.addEventListener("keyup", release);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", releaseAll);
    };
  }, []);

  // レジのキー操作。ダイアログ・決済中・過去の注文を見ている間は使わない
  useEffect(() => {
    if (
      view !== "register" ||
      dialog !== null ||
      prepayDialog !== null ||
      squarePaymentActive
    ) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      // Shift は商品キー（* # など）に使うので見ない。Alt は決済手段のキー（Alt+C など）に使う
      if (event.isComposing || event.metaKey || event.ctrlKey) {
        return;
      }
      if (isOutsideRegister(event.target)) {
        return;
      }
      // Alt と一緒に押したキー（決済手段のキー）は、同時押しの商品には数えない
      if (!event.altKey && !isModifierKey(event.key)) {
        heldKeysRef.current = pressKey(
          heldKeysRef.current,
          event.code || event.key,
          event.key,
        );
      }
      const held = heldKeysRef.current;
      const intent = event.altKey
        ? cashierPaymentKeyIntent(viewDraft, event.code, {
            payments,
            repeat: event.repeat,
          })
        : cashierKeyIntent(viewDraft, event.key, {
            menus: items ?? [],
            payments,
            held: heldKeyValues(held),
            heldLineKeys: heldLineKeys(held),
            repeat: event.repeat,
            checkCoupon,
          });
      if (intent.type === "ignore") {
        return;
      }
      // フォーカスの残ったボタンが Enter・Space で押されないよう、既定の動きは止める
      event.preventDefault();
      switch (intent.type) {
        case "update":
          updatePayment(() => intent.draft);
          heldKeysRef.current = rememberAddedLine(
            heldKeysRef.current,
            viewDraft,
            intent.draft,
          );
          return;
        case "openAssign":
          openAssign();
          return;
        case "openMemo":
          openMemo();
          return;
        case "goPay":
          startPayment();
          if (intent.payment !== undefined) {
            setQueuedPayment(intent.payment);
          }
          return;
        case "exactReceived":
          updatePayment((c) => setExactReceived(c, due));
          return;
        case "submitCash":
          submitCash(false);
          return;
        case "startSquare":
          startSquarePayment(intent.paymentType);
          return;
        case "paymentUnavailable":
          warnSquareUnavailable(intent.paymentType);
          return;
        case "leavePay":
          leavePay();
          return;
        case "reset":
          // 先払いがあると、受け取ったお金を返さないまま消してしまうので消さない
          if (hasTenders(viewDraft)) {
            toast.warning(
              "先払いがあるので消せません。「先払いを取り消す」で返金してから消してください",
            );
            return;
          }
          // 押し間違いで消さないよう、失うものがあれば確かめる
          if (hasDraftInput(viewDraft)) {
            setDialog("reset");
          } else {
            resetAll();
          }
          return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [
    view,
    dialog,
    prepayDialog,
    squarePaymentActive,
    viewDraft,
    items,
    payments,
    checkCoupon,
    due,
    updatePayment,
    openAssign,
    openMemo,
    startPayment,
    submitCash,
    startSquarePayment,
    warnSquareUnavailable,
    leavePay,
    resetAll,
  ]);

  const selectedLine =
    draft.selected === null ? null : draft.lines[draft.selected];
  // 取消の確認に出す、消えるもの
  const resetSummary = [
    itemCount > 0 && `商品 ${itemCount}点（${formatYen(newOrder.total)}）`,
    draft.coupon && `引換券番号 ${draft.coupon}`,
    draft.special && "特殊な割引",
    draft.memo && "特記事項",
    draft.received && `受取金額 ${formatYen(Number(draft.received))}`,
  ]
    .filter(Boolean)
    .join("・");
  const discountNote = draft.special
    ? "（特殊な割引）"
    : couponApplied
      ? `（引換券 ${draft.coupon}）`
      : "";

  // 会計中の左の列の内訳：いまの小計の説明と、色分けの帯（受け取った分・今払う分・残り）
  const yen = formatYen;
  const subtotalLabel = current?.kind === "items" ? "個別小計" : "小計";
  const currentPaid = current === null ? 0 : subtotalPaid(split, current.id);
  const context =
    !paying || current === null
      ? ""
      : split.part !== null
        ? `${subtotalLabel} ${yen(currentRemaining)} を分割 · このあと残り ${yen(currentRemaining - split.part)}`
        : current.kind === "items"
          ? `個別小計 ${current.lineKeys.length}点 · ${
              currentPaid > 0
                ? `${yen(currentPaid)} 受取済み`
                : `残りの商品 ${yen(orderRemaining - currentRemaining)}`
            }`
          : currentPaid > 0
            ? `分割で ${yen(currentPaid)} 受取済み`
            : "";
  const bar: BreakdownBarSegment[] =
    locked || (paying && due < orderRemaining)
      ? [
          ...split.tenders.map((t) => ({
            key: `tender-${t.id}`,
            amount: t.amount,
            color: tenderDot(t),
          })),
          ...(paying
            ? [{ key: "due", amount: due, color: "var(--color-prepay-line)" }]
            : []),
          {
            key: "rest",
            amount: Math.max(orderRemaining - (paying ? due : 0), 0),
            color: "var(--color-stone-200)",
          },
        ]
      : [];
  // 確定ボタンに添える説明
  const payNote =
    !paying || current === null
      ? ""
      : split.part !== null
        ? `分割 · この小計の残り ${yen(currentRemaining - split.part)}`
        : current.kind === "items" && orderRemaining - currentRemaining > 0
          ? `個別小計 · 残り ${yen(orderRemaining - currentRemaining)} は次に`
          : "";
  // 個別小計で選べる商品（割り振った割引と「割引をここに」）
  const allocation = allocateDiscount(draft, discountCups);
  const itemRows = unpaid.map((line) => ({
    key: line.key,
    number: draft.lines.indexOf(line) + 1,
    name: line.menu.name,
    price: line.menu.price,
    discount: (allocation.get(line.key) ?? 0) * discountPerCup,
    canPreferDiscount:
      discountCups > 0 &&
      !allocation.has(line.key) &&
      coffeeCupsOf(line.menu) > 0,
  }));
  const refundTenders =
    prepayDialog?.kind === "refund"
      ? split.tenders.filter((t) => prepayDialog.tenderIds.includes(t.id))
      : [];
  const squareState = squarePayment.state;
  const paidKeys = paidLineKeys(draft);
  const currentItemKeys = new Set(
    paying && current?.kind === "items" ? current.lineKeys : [],
  );

  // 商品の列。入れる段階は真ん中、会計の段階は左に押し出す（RegisterStrip）
  const orderPanel = (
    <OrderPanel
      draft={viewDraft}
      couponStatus={coupon}
      discount={newOrder.discount}
      coffeeCups={newOrder.getCoffeeCups().length}
      needsSplit={shouldSplitOrder(newOrder.menus)}
      paidKeys={paidKeys}
      currentItemKeys={currentItemKeys}
      prepaid={prepaid}
      canOpenItems={canOpenItems}
      canCancelPayment={canLeavePayment(draft)}
      onSelect={(index) => updateDraft((current) => selectLine(current, index))}
      onRemove={(index) => updateDraft((current) => removeLine(current, index))}
      onOpenAssign={openAssign}
      onRemoveAll={openRemoveAll}
      onFocusCoupon={() => updateDraft(focusCoupon)}
      onToggleSpecial={() =>
        updateDraft((current) => toggleSpecial(current, couponApplied))
      }
      onOpenMemo={openMemo}
      onOpenItems={openItems}
      onGoPay={startPayment}
      onCancelPayment={cancelPayment}
      onRefundAll={() => openRefund()}
    />
  );

  return (
    <div className="relative flex h-[calc(100dvh-0.5rem)] min-h-[600px] flex-col overflow-hidden bg-white font-noto text-stone-900">
      {view === "register" ? (
        <>
          <header className="flex h-14 flex-none items-center justify-between gap-4 whitespace-nowrap border-stone-200 border-b px-5">
            <div className="flex min-w-0 items-center gap-5">
              <OrderIdDisplay
                orderId={newOrder.orderId}
                isNeedManualOrderId={isNeedManualOrderId}
                manualOrderId={manualOrderId}
                onOrderIdOverride={overrideOrderId}
              />
              <ReadyTimeEstimate
                orders={activeOrders}
                drinkCups={newOrder.getDrinkCups().length}
              />
              {locked && (
                <span className="flex h-7 items-center gap-2 rounded-full bg-prepay-soft px-3 font-extrabold text-[13px] text-prepay">
                  <span className="h-1.5 w-1.5 rounded-full bg-prepay" />
                  先払い中
                  <span className="tabular-nums">
                    残り {formatYen(orderRemaining)}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 xl:gap-4">
              <div className="flex items-center gap-3.5 text-[13px] text-stone-500">
                {connectionIssues.map((issue) => (
                  <ConnectionIssueDot key={issue.key} issue={issue} />
                ))}
                <PrinterStatusDot
                  name="ラベル"
                  status={printer.status}
                  certificateUrl={eposCertificateUrl(labelPrinterIp)}
                />
                <PrinterStatusDot
                  name="レシート"
                  status={receiptPrinter.status}
                  certificateUrl={eposCertificateUrl(receiptPrinterIp)}
                />
              </div>
              <PendingPrints
                count={printer.pendingCount}
                onRetry={printer.retry}
              />
              <LabelPrintProxySwitch
                checked={labelPrintProxy}
                onCheckedChange={setLabelPrintProxy}
                waiting={labelPrintRelay.waiting}
              />
              {squareEnabled && (
                <SquareUnlinkedNotice
                  devices={squareDevice.devices}
                  currentBillingAmount={billing}
                  canSubmit={
                    canSubmitOrder &&
                    itemCount > 0 &&
                    !squarePaymentActive &&
                    !locked
                  }
                  onSubmitWithCheckout={submitUnlinkedSquareOrder}
                />
              )}
              {squareEnabled && (
                <SquareDeviceSelect
                  devices={squareDevice.devices}
                  device={squareDevice.device}
                  missing={squareDevice.missing}
                  onSelect={squareDevice.select}
                  disabled={squarePaymentActive}
                />
              )}
              {squareEnabled && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="auto-square-refund"
                    checked={autoSquareRefund}
                    onCheckedChange={setAutoSquareRefund}
                    // 決済中に切り替えると、その決済を返金するか分かりにくいので切り替えさせない
                    disabled={squarePaymentActive}
                    className="data-[state=checked]:bg-red-600"
                  />
                  <Label
                    htmlFor="auto-square-refund"
                    className={cn(
                      "text-[13px] text-stone-500",
                      autoSquareRefund && "font-bold text-red-600",
                    )}
                  >
                    常に返金
                    <span className="hidden xl:inline">
                      （キャンセルしない）
                    </span>
                  </Label>
                </div>
              )}
              <button
                type="button"
                onClick={() => setView("past")}
                className="h-11 rounded-lg border border-stone-200 bg-white px-4 font-medium text-slate-700 text-sm hover:bg-stone-50"
              >
                過去の注文
              </button>
            </div>
          </header>
          {/* 会計の列は 432px 以上にし、余った幅をメニューと 4:3 で分ける（メニューだけが広がらないように）。
              1280px より狭い画面（iPad など）では、メニューが細くなりすぎないよう会計の列を 392px にする */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_384px_392px] xl:grid-cols-[minmax(0,1fr)_384px_minmax(432px,0.75fr)]">
            {/* 会計の段階では、商品の列を左に押し出し、空いた真ん中に内訳（小計・受取金額・お釣り）を入れる。
                メニューは薄くして左端に残し、押したら会計を取り消すか尋ねる */}
            <RegisterStrip
              paying={paying}
              onMenuWhilePaying={confirmCancelPayment}
              menu={
                <MenuPanel
                  menus={items ?? []}
                  disabled={locked}
                  onAdd={(menu) =>
                    updateDraft((current) => addLine(current, menu))
                  }
                />
              }
              order={orderPanel}
              breakdown={
                <PayBreakdown
                  itemCount={itemCount}
                  total={newOrder.total}
                  discount={newOrder.discount}
                  discountNote={discountNote}
                  prepaid={prepaid}
                  tenders={split.tenders}
                  context={context}
                  bar={bar}
                  due={due}
                  itemsSubtotal={current?.kind === "items"}
                  deferred={
                    split.part !== null ? currentRemaining - split.part : null
                  }
                  cash={viewDraft.payment === "cash"}
                  received={viewDraft.received}
                  onRefundSubtotal={(subtotalId) => openRefund(subtotalId)}
                  onCancelPart={() => {
                    updateDraft(cancelPart);
                    resyncDisplay();
                  }}
                  hints={
                    <RegisterKeyHints
                      exampleKeys={exampleMenuKeys(items ?? [])}
                    />
                  }
                />
              }
            />
            <PayPanel
              draft={viewDraft}
              due={due}
              note={payNote}
              squarePaymentTypes={squarePaymentTypes}
              terminalSelect={squareSelect.status}
              terminalSelectMessage={squareSelect.message}
              canStartSquare={canStartSquare}
              canSubmit={canSubmitOrder}
              canSplit={canSplit}
              onCash={() =>
                updatePayment((current) => setPayment(current, "cash"))
              }
              onSquare={startSquarePayment}
              onDigits={(digits) =>
                updatePayment((current) =>
                  inputPadDigits(current, digits, checkCoupon),
                )
              }
              onDeleteDigit={() => updatePayment(deleteDigit)}
              onClearDigits={() => updatePayment(clearDigits)}
              onAddReceived={(amount) =>
                updatePayment((current) => addReceived(current, amount))
              }
              onExactReceived={() =>
                updatePayment((current) => setExactReceived(current, due))
              }
              onSubmitCash={() => submitCash(false)}
              onOpenSplit={openPart}
            />
          </div>
        </>
      ) : (
        <PastOrdersView
          orders={orders}
          connectionIssues={connectionIssues}
          squareRefundable={squareEnabled}
          onPrintFormalReceipt={receiptPrinter.printFormalReceipt}
          onPrintCancelLabel={printer.printCancelLabel}
          onBack={() => setView("register")}
        />
      )}
      <AssignDialog
        target={
          dialog === "assign" && selectedLine && draft.selected !== null
            ? `${draft.selected + 1}. ${selectedLine.menu.name}`
            : null
        }
        initial={{
          dripper: selectedLine?.menu.dripper ?? null,
          assignee: selectedLine?.menu.assignee ?? null,
        }}
        onCommit={(dripper, assignee) => {
          updateDraft((current) =>
            current.selected === null
              ? current
              : assignLine(current, current.selected, dripper, assignee),
          );
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
      <MemoDialog
        open={dialog === "memo"}
        orderId={newOrder.orderId}
        initial={draft.memo}
        onCommit={(memo) => {
          updateDraft((current) => setMemo(current, memo));
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "removeAll"}
        title="全削除"
        sub={`No.${newOrder.orderId}`}
        question={`商品 ${itemCount}点（${formatYen(newOrder.total)}） をすべて削除しますか？`}
        note="削除した商品は一覧から消え、戻せません（戻すときはもう一度足してください）。"
        hint="Enter でやめる ・ 消すときは「全削除する」を押す（Tab で移って Enter）"
        confirmLabel="全削除する"
        // 戻せないので、押し間違いの Enter では消さない
        focus="cancel"
        onConfirm={() => {
          updateDraft(removeAllLines);
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "cancelPayment"}
        title="会計取消"
        sub={`No.${newOrder.orderId}`}
        question="会計を取り消しますか？"
        note="商品の入力に戻ります。入れた受取金額は消えますが、商品・割引・備考はそのまま残ります。"
        hint="Enter でやめる ・ 取り消すときは「会計を取り消す」を押す（Tab で移って Enter）"
        confirmLabel="会計を取り消す"
        // メニューを押し間違えたあとの Enter（確定のつもり）で取り消さない
        focus="cancel"
        onConfirm={() => {
          setDialog(null);
          cancelPayment();
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reset"}
        title="取消"
        sub={`No.${newOrder.orderId}`}
        question="入力中の注文を消しますか？"
        note={`${resetSummary} が消えます。消した注文は戻せません。`}
        hint="Enter でやめる ・ 消すときは「消す」を押す（Tab で移って Enter）"
        confirmLabel="消す"
        // 戻せないので、押し間違いの Enter では消さない
        focus="cancel"
        onConfirm={resetAll}
        onClose={() => setDialog(null)}
      />
      <SquarePaymentDialog
        state={squarePayment.state}
        deviceName={
          squareDevice.devices.find(
            (device) => device.device_id === squarePayment.state?.deviceId,
          )?.name
        }
        canSubmitOrder={canSaveNow}
        remainingAfter={
          squareState && !wholeOrder
            ? currentRemaining - squareState.amount
            : undefined
        }
        onCancel={squarePayment.cancel}
        onRetry={squarePayment.retry}
        onCancelConflicting={squarePayment.cancelConflicting}
        onSubmitPaid={squarePayment.submitPaid}
        onClose={squarePayment.close}
        onSplit={
          squareState && paying && currentRemaining > 1
            ? () => {
                squarePayment.close();
                setPrepayDialog({
                  kind: "part",
                  preset: squareState.paymentType,
                });
              }
            : undefined
        }
      />
      <SplitChoiceDialog
        open={prepayDialog?.kind === "splitChoice"}
        due={due}
        itemsBlocked={choices.items}
        partBlocked={choices.part}
        onItems={switchToItems}
        onPart={openPart}
        onClose={() => setPrepayDialog(null)}
      />
      <SubtotalItemsDialog
        open={prepayDialog?.kind === "items"}
        rows={itemRows}
        remaining={orderRemaining}
        onPreferDiscount={(key) =>
          updateDraft((current) => preferDiscount(current, key))
        }
        onConfirm={startItemsSubtotal}
        onClose={() => setPrepayDialog(null)}
      />
      <PartAmountDialog
        open={prepayDialog?.kind === "part"}
        baseLabel={`${subtotalLabel}${currentPaid > 0 ? "の残り" : ""}`}
        base={currentRemaining}
        presetLabel={
          prepayDialog?.kind === "part" && prepayDialog.preset !== null
            ? squarePaymentTypeLabel[prepayDialog.preset]
            : null
        }
        onConfirm={(amount) => {
          const preset =
            prepayDialog?.kind === "part" ? prepayDialog.preset : null;
          updateDraft((current) =>
            preset === null
              ? setPart(current, amount)
              : setPayment(setPart(current, amount), preset),
          );
          setPrepayDialog(null);
          resyncDisplay();
        }}
        onClose={() => setPrepayDialog(null)}
      />
      <PartPaidDialog
        open={prepayDialog?.kind === "partPaid"}
        tender={prepayDialog?.kind === "partPaid" ? prepayDialog.tender : null}
        remainingLabel={current?.kind === "items" ? "個別小計の残り" : "残り"}
        remaining={currentRemaining}
        final={currentRemaining >= orderRemaining}
        onSplit={(amount) => {
          updateDraft((current) => setPart(current, amount));
          setPrepayDialog(null);
          resyncDisplay();
        }}
        onPayRest={() => setPrepayDialog(null)}
      />
      <SubtotalPaidDialog
        open={prepayDialog?.kind === "subtotalPaid"}
        tender={
          prepayDialog?.kind === "subtotalPaid" ? prepayDialog.tender : null
        }
        remainingCount={unpaid.length}
        remaining={orderRemaining}
        canMoreItems={unpaid.length >= 2}
        onMoreItems={() => setPrepayDialog({ kind: "items" })}
        onPayRest={() => {
          setPrepayDialog(null);
          startPayment();
        }}
      />
      <RefundDialog
        open={prepayDialog?.kind === "refund"}
        all={prepayDialog?.kind === "refund" && prepayDialog.all}
        rows={refundTenders.map((t) => ({
          id: t.id,
          label: tenderLabel(t),
          amount: t.amount,
          dot: tenderDot(t),
          squareCheckoutId: t.squareCheckoutId ?? null,
        }))}
        refundSquare={refundSquare}
        onFinish={() => {
          if (prepayDialog?.kind === "refund") {
            const { tenderIds, subtotalIds } = prepayDialog;
            updateDraft((current) =>
              removeTenders(current, tenderIds, subtotalIds),
            );
          }
          setPrepayDialog(null);
          resyncDisplay();
        }}
        onClose={() => setPrepayDialog(null)}
      />
      <SettledDialog
        open={prepayDialog?.kind === "settled"}
        orderId={prepayDialog?.kind === "settled" ? prepayDialog.orderId : 0}
        rows={prepayDialog?.kind === "settled" ? prepayDialog.rows : []}
        total={prepayDialog?.kind === "settled" ? prepayDialog.total : 0}
        lastCash={
          prepayDialog?.kind === "settled" ? prepayDialog.lastCash : null
        }
        onClose={() => setPrepayDialog(null)}
      />
      {notice && (
        <output className="-translate-x-1/2 pointer-events-none absolute top-18 left-1/2 z-40 flex items-center gap-3.5 whitespace-nowrap rounded-xl bg-stone-900 px-5 py-3 text-white shadow-[0_12px_32px_-8px_rgba(0,0,0,.35)]">
          <span className="font-bold text-base">{notice.text}</span>
          <span className="text-sm text-stone-300">{notice.sub}</span>
        </output>
      )}
      <audio src={bellTwice} ref={soundRef}>
        <track kind="captions" />
      </audio>
    </div>
  );
};

export { CashierV2 };
