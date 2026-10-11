import type {
  MenuEntity,
  OrderEntity,
  SquarePaymentType,
  WithId,
} from "@cafeore/common";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import bellTwice from "~/assets/bell_twice.mp3";
import { Switch } from "~/components/ui/switch";
import { usePrinter } from "~/label/print-util";
import { cn } from "~/lib/utils";
import {
  applyCashierOrderActionAtom,
  editingOrderAtom,
} from "../functional/cashierAtoms";
import {
  cashierDescCommentAtom,
  cashierMenuOpenAtom,
  cashierServiceActiveAtom,
} from "../functional/cashierUiAtoms";
import {
  type SubmitFocusTarget,
  moveSubmitFocus,
} from "../functional/submitFocus";
import { useInputStatus } from "../functional/useInputStatus";
import { useLatestOrderId } from "../functional/useLatestOrderId";
import type { OrderAction } from "../functional/useOrderState";
import { usePreventNumberKeyUpDown } from "../functional/usePreventNumberKeyUpDown";
import type { SquareDeviceSelection } from "../functional/useSquareDevice";
import { useSquarePayment } from "../functional/useSquarePayment";
import { useUISession } from "../functional/useUISession";
import { AttractiveTextArea } from "../molecules/AttractiveTextArea";
import { InputHeader } from "../molecules/InputHeader";
import { OrderIdDisplay } from "../molecules/OrderIdDisplay";
import { PastOrderSideSheet } from "../molecules/PastOrderSideSheet";
import { PrinterStatus } from "../molecules/PrinterStatus";
import { DiscountInput } from "../organisms/DiscountInput";
import { ItemButtons } from "../organisms/ItemButtons";
import { OrderItemEdit } from "../organisms/OrderItemEdit";
import { OrderReceivedInput } from "../organisms/OrderReceivedInput";
import { ServiceDiscountButton } from "../organisms/ServiceDiscountButton";
import { SquareDeviceSelect } from "../organisms/SquareDeviceSelect";
import { SquarePaymentDialog } from "../organisms/SquarePaymentDialog";
import { SquareUnlinkedNotice } from "../organisms/SquareUnlinkedNotice";
import { SubmitSection } from "../organisms/SubmitSection";
import { Label } from "../ui/label";

type props = {
  items: WithId<MenuEntity>[] | undefined; // itemMasterを渡す
  orders: WithId<OrderEntity>[] | undefined;
  wsStatus: "connecting" | "open" | "closed" | "error";
  canSubmitOrder: boolean;
  /** Square 連携が有効か。無効なら Square のボタンも端末の選択も出さない */
  squareEnabled: boolean;
  /** このレジで使う Square 端末。決まっていなければ Square のボタンを出さない */
  squareDevice: SquareDeviceSelection;
  submitPayload: (order: OrderEntity) => void;
  /** Square で支払い済みの注文を送る。登録できなければ reject する */
  submitSquarePayload: (
    order: OrderEntity,
    squareCheckoutId: string,
  ) => Promise<void>;
  syncOrder: (order: OrderEntity) => void;
};

/** 確定欄に出す Square の決済手段（上から順） */
const SQUARE_PAYMENT_TYPES: readonly SquarePaymentType[] = [
  "CARD_PRESENT",
  "FELICA_ALL",
  "QR_CODE",
];

/**
 * キャッシャー画面のコンポーネント
 *
 * データの入出力は親コンポーネントに任せる
 */
const CashierV2 = ({
  items,
  orders,
  wsStatus,
  canSubmitOrder,
  squareEnabled,
  squareDevice,
  submitPayload,
  submitSquarePayload,
  syncOrder,
}: props) => {
  const newOrder = useAtomValue(editingOrderAtom);
  const applyOrderAction = useSetAtom(applyCashierOrderActionAtom);
  const {
    inputStatus,
    proceedStatus,
    previousStatus,
    resetStatus,
    setInputStatus,
  } = useInputStatus();
  const [descComment, setDescComment] = useAtom(cashierDescCommentAtom);
  const [menuOpen, setMenuOpen] = useAtom(cashierMenuOpenAtom);
  const [UISession, renewUISession] = useUISession();
  const { nextOrderId, manualOrderId, setOrderIdOverride } =
    useLatestOrderId(orders);
  const soundRef = useRef<HTMLAudioElement>(null);
  const [serviceActive, setServiceActive] = useAtom(cashierServiceActiveAtom);
  const [hasReceivedInput, setHasReceivedInput] = useState(false);
  const [submitFocusTarget, setSubmitFocusTarget] =
    useState<SubmitFocusTarget>("submit");
  const dispatchOrder = useCallback(
    (action: OrderAction) => {
      applyOrderAction({ action, syncOrder });
    },
    [applyOrderAction, syncOrder],
  );

  const playSound = useCallback(() => {
    soundRef.current?.play();
  }, []);

  const printer = usePrinter();

  usePreventNumberKeyUpDown();

  /**
   * FIXME #412 useEffect内でstateを更新している
   * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
   */
  useEffect(() => {
    dispatchOrder({ type: "updateOrderId", orderId: nextOrderId });
  }, [nextOrderId, dispatchOrder]);

  const resetAll = useCallback(() => {
    dispatchOrder({ type: "clear" });
    setHasReceivedInput(false);
    resetStatus();
    renewUISession();
  }, [dispatchOrder, resetStatus, renewUISession]);

  const canEnterSubmit = canSubmitOrder && newOrder.menus.length > 0;
  const billingOk = newOrder.menus.length > 0 && newOrder.getCharge() >= 0;

  const proceedStatusGuarded = useCallback(() => {
    if (inputStatus === "received" && !canEnterSubmit) {
      return;
    }
    if (inputStatus === "received") {
      setSubmitFocusTarget(billingOk ? "submit" : "exactPayment");
    }
    proceedStatus();
  }, [inputStatus, canEnterSubmit, billingOk, proceedStatus]);

  // Square のボタンは、このレジで使う端末が決まっているときだけ出す
  const squareDeviceId = squareEnabled
    ? (squareDevice.device?.device_id ?? null)
    : null;

  // 確定欄で押せるボタン。↑↓キーはこの中で動く。
  const availableSubmitTargets = useMemo(() => {
    const targets: SubmitFocusTarget[] = [];
    if (billingOk) targets.push("submit");
    if (newOrder.menus.length > 0 && !hasReceivedInput) {
      targets.push("exactPayment");
    }
    if (squareDeviceId !== null && newOrder.menus.length > 0) {
      targets.push(...SQUARE_PAYMENT_TYPES);
    }
    return targets;
  }, [billingOk, newOrder, hasReceivedInput, squareDeviceId]);

  const moveSubmitFocusBy = useCallback(
    (step: number) => {
      if (inputStatus === "submit") {
        setSubmitFocusTarget((prev) =>
          moveSubmitFocus(prev, availableSubmitTargets, step),
        );
      }
    },
    [inputStatus, availableSubmitTargets],
  );

  /**
   * FIXME #412 useEffect内でstateを更新している
   */
  useEffect(() => {
    if (inputStatus === "submit" && !canEnterSubmit) {
      setInputStatus("received");
    }
  }, [inputStatus, canEnterSubmit, setInputStatus]);

  /** 送る直前の注文を作る。createdAt を今にし、備考を足す */
  const prepareSubmit = useCallback(
    (base: OrderEntity) => {
      const submitOne = base.clone();
      submitOne.nowCreated();
      submitOne.addComment("cashier", descComment);
      return submitOne;
    },
    [descComment],
  );

  /** 注文を送った後、次の注文を入力できるようにする */
  const finishSubmit = useCallback(() => {
    // オフライン時（手動番号指定時）は次の番号を自動設定
    if (manualOrderId !== null && wsStatus !== "open") {
      setOrderIdOverride(manualOrderId + 1);
    }

    resetAll();
    setServiceActive(false);
    playSound();
  }, [
    manualOrderId,
    wsStatus,
    setOrderIdOverride,
    resetAll,
    setServiceActive,
    playSound,
  ]);

  const submitOrder = useCallback(
    (exactPayment?: boolean) => {
      if (!canSubmitOrder) {
        return;
      }
      if (!exactPayment && newOrder.getCharge() < 0) {
        return;
      }
      if (newOrder.menus.length === 0) {
        return;
      }
      const submitOne = prepareSubmit(newOrder);
      if (exactPayment) submitOne.received = submitOne.billingAmount;
      printer.printOrderLabel(submitOne);
      submitPayload(submitOne);
      finishSubmit();
    },
    [
      canSubmitOrder,
      newOrder,
      prepareSubmit,
      printer,
      submitPayload,
      finishSubmit,
    ],
  );

  /**
   * Square で支払い済みの注文を送る。送れたら true
   *
   * 決済を始めた時点の注文（order）を、画面に出ている注文番号で送る。お預かりは請求額と同じにする。
   * 現金と違い、登録できたと分かってから印刷し、入力を消す。登録に失敗したら reject する
   * （お金は受け取っているので、呼ぶ側で支払い済みのまま送り直せるようにする）。
   */
  const submitSquareOrder = useCallback(
    async (checkoutId: string, order: OrderEntity): Promise<boolean> => {
      if (!canSubmitOrder || order.menus.length === 0) {
        return false;
      }
      const submitOne = prepareSubmit(order);
      submitOne.orderId = newOrder.orderId;
      submitOne.received = submitOne.billingAmount;
      await submitSquarePayload(submitOne, checkoutId);
      printer.printOrderLabel(submitOne);
      finishSubmit();
      return true;
    },
    [
      canSubmitOrder,
      prepareSubmit,
      newOrder,
      submitSquarePayload,
      printer,
      finishSubmit,
    ],
  );

  const squarePayment = useSquarePayment({
    onPaid: (checkout, order) => submitSquareOrder(checkout.id, order),
  });

  const startSquarePayment = useCallback(
    (paymentType: SquarePaymentType) => {
      if (!canEnterSubmit || squareDeviceId === null) {
        return;
      }
      squarePayment.start(newOrder, paymentType, squareDeviceId);
    },
    [canEnterSubmit, squareDeviceId, squarePayment.start, newOrder],
  );

  const keyEventHandlers = useMemo(() => {
    return {
      ArrowRight: proceedStatusGuarded,
      ArrowLeft: previousStatus,
      ArrowUp: () => moveSubmitFocusBy(-1),
      ArrowDown: () => moveSubmitFocusBy(1),
      Escape: () => {
        resetAll();
      },
    };
  }, [proceedStatusGuarded, previousStatus, moveSubmitFocusBy, resetAll]);

  /**
   * OK
   */
  const squarePaymentActive = squarePayment.active;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // 決済中は注文を変えられないようにする（Esc で注文が消えるのも防ぐ）
      if (squarePaymentActive) {
        return;
      }
      const key = event.key;
      for (const [keyName, keyHandler] of Object.entries(keyEventHandlers)) {
        if (key === keyName) {
          keyHandler();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [keyEventHandlers, squarePaymentActive]);

  const itemMenu = (
    <ItemButtons
      items={items ?? []}
      addItem={useCallback(
        (item) => dispatchOrder({ type: "addItem", item }),
        [dispatchOrder],
      )}
    />
  );

  return (
    <>
      <div className="p-4">
        <div className="flex justify-between">
          <OrderIdDisplay
            orderId={newOrder.orderId}
            isNeedManualOrderId={
              wsStatus !== "connecting" && wsStatus !== "open"
            }
            manualOrderId={manualOrderId}
            onOrderIdOverride={setOrderIdOverride}
          />
          <div className="flex items-center space-x-2">
            <Switch
              id="menu-button"
              checked={menuOpen}
              onCheckedChange={setMenuOpen}
            />
            <Label htmlFor="menu-button">メニュー表示</Label>
          </div>
          <div className="flex items-center space-x-2">
            {squareEnabled && (
              <SquareUnlinkedNotice
                devices={squareDevice.devices}
                currentBillingAmount={newOrder.billingAmount}
                canSubmit={canEnterSubmit && !squarePaymentActive}
                onSubmitWithCheckout={(checkout) => {
                  submitSquareOrder(checkout.id, newOrder).catch((error) => {
                    toast.error(
                      `注文を送れませんでした: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  });
                }}
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
            <PrinterStatus status={printer.status} />
            <PastOrderSideSheet
              orders={orders}
              author="cashier"
              withGoods
              squareRefundable={squareEnabled}
            />
          </div>
        </div>
        <div className="flex gap-5 px-2">
          <div>{menuOpen && itemMenu}</div>
          <div className="flex-1">
            <InputHeader
              title="商品"
              focus={inputStatus === "items"}
              number={1}
            />
            <OrderItemEdit
              order={newOrder}
              onAddItem={useCallback(
                (item) => dispatchOrder({ type: "addItem", item }),
                [dispatchOrder],
              )}
              onRemoveItem={useCallback(
                (idx) => dispatchOrder({ type: "removeItem", idx }),
                [dispatchOrder],
              )}
              mutateItem={useCallback(
                (idx, action) =>
                  dispatchOrder({ type: "mutateItem", idx, action }),
                [dispatchOrder],
              )}
              focus={inputStatus === "items"}
              discountOrder={useMemo(
                () => newOrder.discountOrderCups !== 0,
                [newOrder],
              )}
              onClick={useCallback(() => {
                setInputStatus("items");
              }, [setInputStatus])}
            />
          </div>
          <div className={cn("flex-1", menuOpen && "hidden")}>
            <InputHeader
              title="割引"
              focus={inputStatus === "discount"}
              number={2}
            />
            <div className="pt-5">
              <DiscountInput
                key={`DiscountInput-${UISession.key}`}
                focus={inputStatus === "discount"}
                disabled={serviceActive}
                orders={orders}
                onDiscountOrderFind={useCallback(
                  (discountOrder) =>
                    dispatchOrder({ type: "applyDiscount", discountOrder }),
                  [dispatchOrder],
                )}
                onDiscountOrderRemoved={useCallback(
                  () => dispatchOrder({ type: "removeDiscount" }),
                  [dispatchOrder],
                )}
                onClick={useCallback(() => {
                  setInputStatus("discount");
                }, [setInputStatus])}
              />
            </div>
            <div className="">
              <ServiceDiscountButton
                active={serviceActive}
                disabled={newOrder.discountOrderId !== null}
                onServiceDiscountOrder={useCallback(() => {
                  dispatchOrder({ type: "applyServiceOneCupDiscount" });
                  setServiceActive(true);
                }, [dispatchOrder, setServiceActive])}
                onDiscountOrderRemoved={useCallback(() => {
                  if (serviceActive) {
                    dispatchOrder({ type: "removeDiscount" });
                    setServiceActive(false);
                  }
                }, [dispatchOrder, serviceActive, setServiceActive])}
              />
            </div>
          </div>
          <div className={cn("flex-1", menuOpen && "hidden")}>
            <InputHeader
              title="備考"
              focus={inputStatus === "description"}
              number={3}
            />
            <div className="pt-5">
              <AttractiveTextArea
                key={`Description-${UISession.key}`}
                onTextSet={setDescComment}
                focus={inputStatus === "description"}
                onClick={useCallback(() => {
                  setInputStatus("description");
                }, [setInputStatus])}
              />
            </div>
          </div>
          <div className="flex-1">
            <InputHeader
              title="会計"
              focus={inputStatus === "received"}
              number={4}
            />
            <div className="pt-5">
              <OrderReceivedInput
                key={`Received-${UISession.key}`}
                onTextSet={useCallback(
                  (received) => {
                    setHasReceivedInput(received !== "");
                    dispatchOrder({ type: "setReceived", received });
                  },
                  [dispatchOrder],
                )}
                focus={inputStatus === "received"}
                order={newOrder}
                onClick={useCallback(() => {
                  setInputStatus("received");
                }, [setInputStatus])}
              />
            </div>
          </div>
          <div className={cn("flex-1", menuOpen && "hidden")}>
            <InputHeader
              title="確定"
              focus={inputStatus === "submit"}
              number={5}
            />
            <fieldset
              disabled={!canEnterSubmit}
              className="min-w-0 border-0 p-0"
            >
              <SubmitSection
                submitOrder={submitOrder}
                onExactPayment={() => submitOrder(true)}
                order={newOrder}
                focus={inputStatus === "submit" && !squarePaymentActive}
                focusTarget={submitFocusTarget}
                availableTargets={availableSubmitTargets}
                squarePaymentTypes={
                  squareDeviceId !== null ? SQUARE_PAYMENT_TYPES : []
                }
                onSquarePayment={startSquarePayment}
              />
            </fieldset>
          </div>
        </div>
        <SquarePaymentDialog
          state={squarePayment.state}
          canSubmitOrder={canSubmitOrder}
          onCancel={squarePayment.cancel}
          onRetry={squarePayment.retry}
          onCancelConflicting={squarePayment.cancelConflicting}
          onSubmitPaid={squarePayment.submitPaid}
          onClose={squarePayment.close}
        />
        <audio src={bellTwice} ref={soundRef}>
          <track kind="captions" />
        </audio>
      </div>
    </>
  );
};

export { CashierV2 };
