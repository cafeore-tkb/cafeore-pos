import {
  type MenuEntity,
  type OrderEntity,
  type PrinterSettings,
  type SquareCheckout,
  type SquarePaymentType,
  type WithId,
  shouldSplitOrder,
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
import { orderLabelJob } from "~/label/order-label";
import { usePrinter, useReceiptPrinter } from "~/label/print-util";
import type { ReceiptPayment } from "~/label/receipt";
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
  backToEntry,
  canAssignSelected,
  canGoPay,
  cashierKeyIntent,
  clearDigits,
  couponStatus,
  deleteDigit,
  emptyCashierDraft,
  focusCoupon,
  focusMemo,
  goPay,
  hasDraftInput,
  inputDigits,
  selectLine,
  setExactReceived,
  setMemo,
  setPayment,
  toggleSpecial,
  toggleVoid,
  voidAll,
} from "../functional/cashierDraft";
import {
  type CashierSplitPayment,
  cancelSplit,
  pickAllSplitLines,
  preferDiscount,
  recordSplitPayment,
  splitBill,
  splitOrderForSubmit,
  splitPaymentOrder,
  splitUpperLines,
  startSplit,
  toggleSplitLine,
} from "../functional/cashierSplit";
import { cashierAutoSquareRefundAtom } from "../functional/cashierUiAtoms";
import type { ConnectionIssue } from "../functional/connectionIssues";
import { refundSquareOrderAutomatically } from "../functional/refundSquareOrderAutomatically";
import { useLatestOrderId } from "../functional/useLatestOrderId";
import type { OrderAction } from "../functional/useOrderState";
import type { SquareDeviceSelection } from "../functional/useSquareDevice";
import { useSquarePayment } from "../functional/useSquarePayment";
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
import { MemoDialog } from "../organisms/cashier/MemoDialog";
import { MenuPanel } from "../organisms/cashier/MenuPanel";
import { OrderPanel } from "../organisms/cashier/OrderPanel";
import { PastOrdersView } from "../organisms/cashier/PastOrdersView";
import { PayPanel } from "../organisms/cashier/PayPanel";
import {
  ConnectionIssueDot,
  PrinterStatusDot,
} from "../organisms/cashier/PrinterStatusDot";
import { SplitPanel } from "../organisms/cashier/SplitPanel";
import { Label } from "../ui/label";

type props = {
  items: WithId<MenuEntity>[] | undefined; // itemMasterを渡す
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
  /** つなぐプリンター（ラベル用・レシート用）の IP アドレス */
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

/** シールの中身が同じかを比べるためのキー（刷る印刷データそのもの） */
const labelKey = (order: OrderEntity) => JSON.stringify(orderLabelJob(order));

/** 会計の欄に出す Square の決済手段（左から順） */
const SQUARE_PAYMENT_TYPES: readonly SquarePaymentType[] = [
  "CARD_PRESENT",
  "FELICA_ALL",
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

type CashierDialogKind = "assign" | "memo" | "voidAll" | "reset";

/**
 * キャッシャー画面のコンポーネント
 *
 * メニュー｜注文（商品・割引・備考）｜会計 の 3 列。商品を入れて「一括会計」で会計の段階に進み、
 * 受取金額か Square の決済手段を選んで確定する。データの入出力は親コンポーネントに任せる
 *
 * 「個別会計」を押すと、左の列に商品を上下の枠に分けて出し、下の枠に入れた商品ずつ会計する
 * （cashierSplit）。払った分は覚えておき、最後の会計で支払いを全部付けて注文を 1 つ送る。
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
  const [notice, setNotice] = useState<{ text: string; sub: string } | null>(
    null,
  );
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const { nextOrderId, manualOrderId, setOrderIdOverride, markOrderIdIssued } =
    useLatestOrderId(orders);
  // 確定できるのは番号が決まっているとき：つながっていれば自動の番号、オフラインなら手で付けた番号。
  // オフラインの注文はこの端末に溜まり、つながったらまとめて送る（submitPayload）
  const canSubmitOrder = canSaveNow || manualOrderId !== null;
  // 番号を手で付ける必要があるのは、今すぐ保存できないとき（つなぎ始めの connecting は待つ）。
  // 端末がオフラインでも、切れたことに気づくまで WebSocket は open のままのことがあるので、wsStatus だけでは見ない
  const isNeedManualOrderId = !canSaveNow && wsStatus !== "connecting";
  const soundRef = useRef<HTMLAudioElement>(null);
  const store = useStore();
  /**
   * お客さん向けの表示（cashier-mini）に入力中の注文を送る。個別会計の会計の段階では、
   * 今回の会計（下の枠）だけを見せる
   */
  const syncDisplay = useCallback(
    (order: OrderEntity) => {
      const current = store.get(cashierDraftAtom);
      syncOrder(
        current.split !== null && current.step === "pay"
          ? splitPaymentOrder(order, current)
          : order,
      );
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

  // プリンターの IP アドレスが変わったら、つなぎ直す
  const labelPrinterIp = printerAddresses.label_printer_ip;
  const printer = usePrinter(
    useMemo(() => eposPrinterAt(labelPrinterIp), [labelPrinterIp]),
  );
  // レシートは会計のたびに刷る。領収書は過去の注文から求められたときだけ刷る
  const receiptPrinterIp = printerAddresses.receipt_printer_ip;
  const receiptPrinter = useReceiptPrinter(
    useMemo(
      () => eposPrinterAt(receiptPrinterIp, RECEIPT_EPOS_PRINTER_CONFIG),
      [receiptPrinterIp],
    ),
  );

  /**
   * 注文のシールを刷る。このレジで先に刷った、まだ登録していない注文と同じ中身なら刷り直さない
   * （一括会計・Square の決済で先に刷ったシールを、確定・会計し直しのときにそのまま使う）。
   * 刷ったら番号と中身を下書き（printedLabel）に覚え、番号は確定まで変えない。注文を消したとき・登録したときに忘れる。
   * 決済の途中（非同期）からも呼ぶので、下書きはストアから今の値を読む。
   */
  const printOrderLabel = useCallback(
    (order: OrderEntity) => {
      const key = labelKey(order);
      if (store.get(cashierDraftAtom).printedLabel?.key === key) {
        return;
      }
      printer.printOrderLabel(order);
      updateDraft((current) => ({
        ...current,
        printedLabel: { orderId: order.orderId, key },
      }));
    },
    [store, printer, updateDraft],
  );

  // 先にシールを刷った注文は、シールの番号のまま確定する（別のレジが送って次の番号が進んでも変えない）
  const printedOrderId = draft.printedLabel?.orderId ?? null;
  /**
   * FIXME #412 useEffect内でstateを更新している
   * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
   */
  useEffect(() => {
    dispatchOrder({
      type: "updateOrderId",
      orderId: printedOrderId ?? nextOrderId,
    });
  }, [printedOrderId, nextOrderId, dispatchOrder]);

  // 引換券番号を過去の注文と照らし合わせる。過去の注文が変わったら（提供された・別のレジで使われた）照らし直す
  const coupon = useMemo(
    () => couponStatus(draft.coupon, orders ?? []),
    [draft.coupon, orders],
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
  }, [dispatchOrder, setDraft]);

  /**
   * 先に刷ったシールを取り消す。取り消しのシールを刷り、覚えていたシールを忘れる。
   * skipOrderId なら、その番号は使わずに次の番号へ進める（「取消 No.N」のあとに同じ No.N のシールが出ないように）
   */
  const cancelPrintedLabel = useCallback(
    (skipOrderId: boolean) => {
      const printed = store.get(cashierDraftAtom).printedLabel;
      if (printed === null) {
        return;
      }
      const canceled = newOrder.clone();
      canceled.orderId = printed.orderId;
      printer.printCancelLabel(canceled);
      updateDraft((current) => ({ ...current, printedLabel: null }));
      if (skipOrderId) {
        markOrderIdIssued(printed.orderId);
        if (manualOrderId !== null) {
          setOrderIdOverride(printed.orderId + 1);
        }
      }
    },
    [
      store,
      newOrder,
      printer,
      updateDraft,
      markOrderIdIssued,
      manualOrderId,
      setOrderIdOverride,
    ],
  );

  /** 入力中の注文を消す。先に刷ったシールがあれば取り消しのシールを刷る */
  const discardOrder = useCallback(() => {
    cancelPrintedLabel(true);
    resetAll();
  }, [cancelPrintedLabel, resetAll]);

  const itemCount = newOrder.menus.length;
  const billing = newOrder.billingAmount;

  // 個別会計の今回の会計（下の枠）。割引は注文全体で割り引く杯数をコーヒーに割り振る
  const discountPerCup = newOrder.DISCOUNT_PER_CUP;
  const discountCups = newOrder.discount / discountPerCup;
  const bill = useMemo(
    () =>
      draft.split === null
        ? null
        : splitBill(draft, discountCups, discountPerCup),
    [draft, discountCups, discountPerCup],
  );
  const splitPayments = draft.split?.payments ?? [];
  /**
   * 会計の欄に出す金額。個別会計の途中の会計は下の枠の分だけ、最後の会計は注文全体から
   * 先に払った分（先会計）を引いた残り
   */
  const pay =
    bill === null
      ? {
          itemCount,
          total: newOrder.total,
          discount: newOrder.discount,
          prepaid: 0,
          amount: billing,
        }
      : bill.last
        ? {
            itemCount,
            total: newOrder.total,
            discount:
              splitPayments.reduce((acc, p) => acc + p.discount, 0) +
              bill.discount,
            prepaid: bill.paidAmount,
            amount: bill.amount,
          }
        : {
            itemCount: bill.lines.length,
            total: bill.total,
            discount: bill.discount,
            prepaid: 0,
            amount: bill.amount,
          };
  const payAmount = pay.amount;

  // Square のボタンは、このレジで使う端末が決まっているときだけ出す
  const squareDeviceId = squareEnabled
    ? (squareDevice.device?.device_id ?? null)
    : null;
  const squarePaymentTypes =
    squareDeviceId !== null ? SQUARE_PAYMENT_TYPES : NO_SQUARE_PAYMENT_TYPES;
  // Square の決済は 1 円から
  const canStartSquare =
    canSaveNow &&
    (bill === null
      ? itemCount > 0 && billing >= 0
      : bill.lines.length > 0 && bill.amount >= 1);
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

  /** 送る直前の注文を作る。createdAt を今にし、特記事項を足す */
  const prepareSubmit = useCallback(
    (base: OrderEntity) => {
      const submitOne = base.clone();
      submitOne.nowCreated();
      submitOne.addComment("cashier", draft.memo);
      return submitOne;
    },
    [draft.memo],
  );

  /** 注文を送った後、次の注文を入力できるようにする */
  const finishSubmit = useCallback(
    (orderId: number, sub: string) => {
      // オフライン時（手動番号指定時）は次の番号を自動設定
      if (manualOrderId !== null && !canSaveNow) {
        setOrderIdOverride(manualOrderId + 1);
      }

      resetAll();
      playSound();
      showNotice(`No.${orderId} を送信しました`, sub);
    },
    [
      manualOrderId,
      canSaveNow,
      setOrderIdOverride,
      resetAll,
      playSound,
      showNotice,
    ],
  );

  /**
   * 個別会計の今回の会計（下の枠）を払い終えた。レシートを刷り、払った分として覚える。
   * 最後の会計なら、払った分を全部付けて注文を送る（シールは先に刷ったものをそのまま使う）。
   * paymentOrder は今回の会計だけの注文（splitPaymentOrder）。下書きは決済の途中（非同期）からも
   * 呼ぶので、ストアから今の値を読む
   */
  const completeSplitPayment = useCallback(
    (
      paymentOrder: OrderEntity,
      payment: Omit<CashierSplitPayment, "lineKeys">,
      receipt: ReceiptPayment,
      sub: string,
    ) => {
      receiptPrinter.printReceipt(paymentOrder, receipt);
      const current = store.get(cashierDraftAtom);
      const last = splitUpperLines(current).length === 0;
      const recorded = recordSplitPayment(current, payment);
      const count = recorded.split?.payments.length ?? 0;
      if (!last) {
        updateDraft(() => recorded);
        resyncDisplay();
        showNotice(`個別会計 ${count}回目を確定しました`, sub);
        return;
      }
      const submitOne = splitOrderForSubmit(
        prepareSubmit(store.get(editingOrderAtom)),
        recorded,
      );
      printOrderLabel(submitOne);
      const paidBySquare = submitOne.payments.some(
        (split) => split.method === "square",
      );
      // 「常に返金」なら、登録できたあとに Square で払った分を裏で返金する（注文は残す）
      submitPayload(
        submitOne,
        autoSquareRefund && paidBySquare
          ? (saved) => void refundSquareOrderAutomatically(saved)
          : undefined,
      );
      markOrderIdIssued(submitOne.orderId);
      finishSubmit(submitOne.orderId, `個別会計 ${count}回・${sub}`);
    },
    [
      receiptPrinter,
      store,
      updateDraft,
      resyncDisplay,
      showNotice,
      prepareSubmit,
      printOrderLabel,
      submitPayload,
      autoSquareRefund,
      markOrderIdIssued,
      finishSubmit,
    ],
  );

  /** 個別会計の今回の会計を現金で払う。exactPayment なら受取金額をちょうどにする（お釣り 0） */
  const submitSplitCash = useCallback(
    (exactPayment: boolean) => {
      if (bill === null || bill.lines.length === 0 || bill.amount < 0) {
        return;
      }
      const received = exactPayment
        ? bill.amount
        : draft.received === ""
          ? null
          : Number(draft.received);
      if (received === null || received < bill.amount) {
        return;
      }
      const paymentOrder = splitPaymentOrder(newOrder, draft);
      paymentOrder.nowCreated();
      paymentOrder.received = received;
      completeSplitPayment(
        paymentOrder,
        {
          method: "cash",
          amount: bill.amount,
          received,
          discountCups: bill.discountCups,
          discount: bill.discount,
        },
        { method: "cash" },
        `お釣り ${formatYen(received - bill.amount)}`,
      );
    },
    [bill, draft, newOrder, completeSplitPayment],
  );

  /** 現金で送る。exactPayment なら受取金額を請求額ちょうどにする（お釣り 0） */
  const submitCash = useCallback(
    (exactPayment: boolean) => {
      if (!canSubmitOrder || draft.step !== "pay") {
        return;
      }
      if (draft.split !== null) {
        submitSplitCash(exactPayment);
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
      draft.split,
      draft.received,
      submitSplitCash,
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
   * 端末に決済画面を出せた Square の決済と、そのとき先に印刷したシールの注文番号。
   * 「未登録の Square 決済」から結び付けるときに、同じシールを刷り直さないために使う。
   */
  const prePrintedRef = useRef(new Map<string, number>());

  /**
   * Square で支払い済みの注文を送る。送れたら true
   *
   * 注文（order）を、その注文番号のまま送る。お預かりは請求額と同じにする。
   * 登録できたと分かってから入力を消し、レシートを刷る。print なら、そのときシールも印刷する。
   * 登録に失敗したら reject する（お金は受け取っているので、呼ぶ側で支払い済みのまま送り直せるようにする）。
   * 「常に返金（キャンセルしない）」なら、登録できたあとに裏で返金する（注文は残す）。返金できなくても
   * 登録は済んでいるので reject しない（送り直すと断られるだけ）。結果はトーストで知らせる。
   */
  const submitSquareOrder = useCallback(
    async (
      checkout: SquareCheckout,
      order: OrderEntity,
      print: boolean,
    ): Promise<boolean> => {
      if (!canSaveNow || order.menus.length === 0) {
        return false;
      }
      const submitOne = prepareSubmit(order);
      submitOne.received = submitOne.billingAmount;
      const savedOrder = await submitSquarePayload(submitOne, checkout.id);
      if (autoSquareRefund) {
        void refundSquareOrderAutomatically(savedOrder);
      }
      if (print) {
        printOrderLabel(submitOne);
      }
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
      autoSquareRefund,
      printOrderLabel,
      receiptPrinter,
      finishSubmit,
    ],
  );

  /**
   * 個別会計の会計を Square で払っている間の、その会計で割り引いた杯数と額。
   * 一括会計の決済なら null。決済が終わったら払った分として覚える
   */
  const splitSquareRef = useRef<{
    discountCups: number;
    discount: number;
  } | null>(null);

  // シールは端末に決済画面が出た時点で先に印刷し、支払いを待つ間に作り始められるようにする。
  // 登録はシールと同じ番号（決済を始めた時点の番号）で行う。お金を受け取らずに終わっても
  // 印刷はしない（ダイアログで知らせる）。
  // 個別会計の会計では、決済するのは今回の会計の分だけ。シールは注文全体のものを刷り、
  // 支払いが確定したら払った分として覚える（最後の会計なら注文を送る）。
  const squarePayment = useSquarePayment({
    onStarted: (checkout, order) => {
      if (splitSquareRef.current !== null) {
        printOrderLabel(store.get(editingOrderAtom));
        return;
      }
      prePrintedRef.current.set(checkout.id, order.orderId);
      printOrderLabel(order);
    },
    onPaid: async (checkout, order) => {
      const split = splitSquareRef.current;
      if (split === null) {
        return submitSquareOrder(checkout, order, false);
      }
      splitSquareRef.current = null;
      const paymentType = checkout.payment_type as SquarePaymentType;
      const paid = order.clone();
      paid.nowCreated();
      paid.received = paid.billingAmount;
      completeSplitPayment(
        paid,
        {
          method: "square",
          amount: paid.billingAmount,
          received: paid.billingAmount,
          ...split,
          squareCheckoutId: checkout.id,
          squarePaymentType: paymentType,
        },
        { method: "square", paymentType: checkout.payment_type },
        `Square・${squarePaymentTypeLabel[paymentType] ?? checkout.payment_type}`,
      );
      return true;
    },
  });
  const squarePaymentActive = squarePayment.active;

  /**
   * 「未登録の Square 決済」を、入力中の注文で登録する。
   * このレジで先にシールを印刷した決済なら、刷り直さず、シールと同じ番号で登録する。
   * そうでなければ（別のレジで決済した・画面を開き直したなど）、今の番号で登録して印刷する。
   */
  const submitUnlinkedSquareOrder = useCallback(
    (checkout: SquareCheckout) => {
      const prePrintedOrderId = prePrintedRef.current.get(checkout.id);
      const order = newOrder.clone();
      if (prePrintedOrderId !== undefined) {
        order.orderId = prePrintedOrderId;
      }
      submitSquareOrder(checkout, order, prePrintedOrderId === undefined).catch(
        (error) => {
          toast.error(
            `注文を送れませんでした: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
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
      updateDraft((current) => setPayment(current, paymentType));
      if (bill !== null) {
        // 個別会計は今回の会計（下の枠）の分だけを決済する
        splitSquareRef.current = {
          discountCups: bill.discountCups,
          discount: bill.discount,
        };
        squarePayment.start(
          splitPaymentOrder(newOrder, draft),
          paymentType,
          squareDeviceId,
        );
        return;
      }
      splitSquareRef.current = null;
      squarePayment.start(newOrder, paymentType, squareDeviceId);
    },
    [
      draft,
      canStartSquare,
      squareDeviceId,
      squarePaymentActive,
      updateDraft,
      squarePayment.start,
      newOrder,
      bill,
    ],
  );

  /**
   * 一括会計・個別会計の下の枠の会計。会計の段階に進み、シールを先に刷る（Square と同じく、
   * お金を受け取る間に作り始められるように）。個別会計でも注文全体のシールを 1 回だけ刷る。
   * 番号を決められない（オフラインで番号を付けていない）ときは、確定のときに刷る
   */
  const startPayment = useCallback(() => {
    if (!canGoPay(draft)) {
      return;
    }
    updateDraft(goPay);
    if (draft.split !== null) {
      resyncDisplay();
    }
    if (canSubmitOrder) {
      printOrderLabel(newOrder);
    }
  }, [
    draft,
    newOrder,
    updateDraft,
    resyncDisplay,
    canSubmitOrder,
    printOrderLabel,
  ]);

  /**
   * 会計取消。入れる段階に戻り、先に刷ったシールは取り消しのシールを刷って使わない。
   * 個別会計で払い始めていたら、シールはそのまま使い、下の枠の商品を選び直す段階に戻る
   */
  const cancelPayment = useCallback(() => {
    if ((draft.split?.payments.length ?? 0) === 0) {
      cancelPrintedLabel(true);
    }
    updateDraft(backToEntry);
    resyncDisplay();
  }, [draft.split, cancelPrintedLabel, updateDraft, resyncDisplay]);

  /** 番号を手で付け直す。先に刷ったシールの番号とずれるので、取り消しのシールを刷る */
  const overrideOrderId = useCallback(
    (orderId: number | null) => {
      cancelPrintedLabel(false);
      setOrderIdOverride(orderId);
    },
    [cancelPrintedLabel, setOrderIdOverride],
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

  const openVoidAll = useCallback(() => {
    if (newOrder.menus.length > 0) {
      setDialog("voidAll");
    }
  }, [newOrder]);

  // レジのキー操作。ダイアログ・決済中・過去の注文を見ている間は使わない
  useEffect(() => {
    if (view !== "register" || dialog !== null || squarePaymentActive) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      // Shift は商品キー（* # など）に使うので見ない
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isOutsideRegister(event.target)) {
        return;
      }
      const intent = cashierKeyIntent(viewDraft, event.key, {
        menus: items ?? [],
        payments,
      });
      if (intent.type === "ignore") {
        return;
      }
      // フォーカスの残ったボタンが Enter・Space で押されないよう、既定の動きは止める
      event.preventDefault();
      switch (intent.type) {
        case "update":
          updateDraft(() => intent.draft);
          return;
        case "openAssign":
          openAssign();
          return;
        case "openMemo":
          openMemo();
          return;
        case "goPay":
          startPayment();
          return;
        case "exactReceived":
          updateDraft((current) => setExactReceived(current, payAmount));
          return;
        case "submitCash":
          submitCash(false);
          return;
        case "startSquare":
          startSquarePayment(intent.paymentType);
          return;
        case "reset":
          // 押し間違いで消さないよう、失うものがあれば確かめる
          if (hasDraftInput(viewDraft)) {
            setDialog("reset");
          } else {
            discardOrder();
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
    squarePaymentActive,
    viewDraft,
    items,
    payments,
    payAmount,
    updateDraft,
    openAssign,
    openMemo,
    startPayment,
    submitCash,
    startSquarePayment,
    discardOrder,
  ]);

  const selectedLine =
    draft.selected === null ? null : draft.lines[draft.selected];
  // 取消の確認に出す、消えるもの
  const splitPaidAmount = splitPayments.reduce((acc, p) => acc + p.amount, 0);
  const resetSummary = [
    itemCount > 0 && `商品 ${itemCount}点（${formatYen(newOrder.total)}）`,
    splitPayments.length > 0 &&
      `個別会計で払った ${splitPayments.length}回分（${formatYen(splitPaidAmount)}）`,
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
                orders={orders}
                drinkCups={newOrder.getDrinkCups().length}
              />
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
              {squareEnabled && (
                <SquareUnlinkedNotice
                  devices={squareDevice.devices}
                  currentBillingAmount={billing}
                  canSubmit={
                    canSubmitOrder &&
                    itemCount > 0 &&
                    !squarePaymentActive &&
                    draft.split === null
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
            {bill === null ? (
              <MenuPanel
                menus={items ?? []}
                disabled={draft.step === "pay"}
                onAdd={(menu) =>
                  updateDraft((current) => addLine(current, menu))
                }
              />
            ) : (
              <SplitPanel
                draft={draft}
                bill={bill}
                discountPerCup={discountPerCup}
                hasDiscount={discountCups > 0}
                disabled={draft.step === "pay"}
                onToggle={(key) =>
                  updateDraft((current) => toggleSplitLine(current, key))
                }
                onPickAll={() => updateDraft(pickAllSplitLines)}
                onPreferDiscount={(key) =>
                  updateDraft((current) => preferDiscount(current, key))
                }
              />
            )}
            <OrderPanel
              draft={viewDraft}
              couponStatus={coupon}
              discount={newOrder.discount}
              coffeeCups={newOrder.getCoffeeCups().length}
              needsSplit={shouldSplitOrder(newOrder.menus)}
              printedOrderId={draft.printedLabel?.orderId ?? null}
              splitBill={bill}
              discountPerCup={discountPerCup}
              onSelect={(index) =>
                updateDraft((current) => selectLine(current, index))
              }
              onToggleVoid={(index) =>
                updateDraft((current) => toggleVoid(current, index))
              }
              onOpenAssign={openAssign}
              onVoidAll={openVoidAll}
              onFocusCoupon={() => updateDraft(focusCoupon)}
              onToggleSpecial={() =>
                updateDraft((current) => toggleSpecial(current, couponApplied))
              }
              onOpenMemo={openMemo}
              onGoPay={startPayment}
              onBackToEntry={cancelPayment}
              onStartSplit={() => updateDraft(startSplit)}
              onCancelSplit={() => updateDraft(cancelSplit)}
            />
            <PayPanel
              draft={viewDraft}
              itemCount={pay.itemCount}
              total={pay.total}
              discount={pay.discount}
              discountNote={discountNote}
              prepaid={pay.prepaid}
              billing={payAmount}
              splitNote={
                bill === null
                  ? null
                  : `個別会計 ${splitPayments.length + 1}回目${bill.last ? "（最後の会計）" : ""}`
              }
              sendsOrder={bill === null || bill.last}
              squarePaymentTypes={squarePaymentTypes}
              canStartSquare={canStartSquare}
              canSubmit={canSubmitOrder}
              onCash={() =>
                updateDraft((current) => setPayment(current, "cash"))
              }
              onSquare={startSquarePayment}
              onDigits={(digits) =>
                updateDraft((current) => inputDigits(current, digits))
              }
              onDeleteDigit={() => updateDraft(deleteDigit)}
              onClearDigits={() => updateDraft(clearDigits)}
              onAddReceived={(amount) =>
                updateDraft((current) => addReceived(current, amount))
              }
              onExactReceived={() =>
                updateDraft((current) => setExactReceived(current, payAmount))
              }
              onSubmitExact={() => submitCash(true)}
              onSubmitCash={() => submitCash(false)}
            />
          </div>
        </>
      ) : (
        <PastOrdersView
          orders={orders}
          connectionIssues={connectionIssues}
          squareRefundable={squareEnabled}
          onPrintFormalReceipt={receiptPrinter.printFormalReceipt}
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
        open={dialog === "voidAll"}
        title="全削除"
        sub={`No.${newOrder.orderId}`}
        question={`商品 ${itemCount}点（${formatYen(newOrder.total)}） をすべて削除しますか？`}
        note="削除した商品は二重線で一覧に残り、「削除を戻す」で 1 点ずつ戻せます。"
        hint="Enter で全削除 ・ Esc で閉じる"
        confirmLabel="全削除する"
        // 削除は戻せるので、Enter で全削除できるようにする
        focus="confirm"
        onConfirm={() => {
          updateDraft(voidAll);
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reset"}
        title="取消"
        sub={`No.${newOrder.orderId}`}
        question="入力中の注文を消しますか？"
        note={`${resetSummary} が消えます。消した注文は戻せません。${
          draft.printedLabel
            ? `先に刷った No.${draft.printedLabel.orderId} のシールは使わず、取り消しのシールを刷ります。`
            : ""
        }${
          splitPayments.length > 0
            ? "個別会計で払った分は、現金は手で返し、Square で払った分は右上の「未登録の Square 決済」から返金してください。"
            : ""
        }`}
        hint="Enter でやめる ・ 消すときは「消す」を押す（Tab で移って Enter）"
        confirmLabel="消す"
        // 戻せないので、押し間違いの Enter では消さない
        focus="cancel"
        onConfirm={discardOrder}
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
        onCancel={squarePayment.cancel}
        onRetry={squarePayment.retry}
        onCancelConflicting={squarePayment.cancelConflicting}
        onSubmitPaid={squarePayment.submitPaid}
        onClose={squarePayment.close}
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
