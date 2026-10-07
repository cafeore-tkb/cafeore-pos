import {
  type MenuEntity,
  type OrderEntity,
  type OrderPayment,
  type SquarePaymentType,
  type WithId,
  orderRepository,
} from "@cafeore/common";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { goodsOnlyServed } from "../functional/goodsOnlyServed";
import {
  type SubmitFocusTarget,
  moveSubmitFocus,
} from "../functional/submitFocus";
import { useInputStatus } from "../functional/useInputStatus";
import { useLatestOrderId } from "../functional/useLatestOrderId";
import type { OrderAction } from "../functional/useOrderState";
import { usePreventNumberKeyUpDown } from "../functional/usePreventNumberKeyUpDown";
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
import { SquarePaymentDialog } from "../organisms/SquarePaymentDialog";
import { SquareUnlinkedNotice } from "../organisms/SquareUnlinkedNotice";
import { SubmitSection } from "../organisms/SubmitSection";
import { Label } from "../ui/label";

type props = {
  items: WithId<MenuEntity>[] | undefined; // itemMasterを渡す
  orders: WithId<OrderEntity>[] | undefined;
  wsStatus: "connecting" | "open" | "closed" | "error";
  canSubmitOrder: boolean;
  /** Square 連携が有効か。無効なら Square のボタンを出さない */
  squareEnabled: boolean;
  submitPayload: (order: OrderEntity, payment?: OrderPayment) => void;
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
  submitPayload,
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

  // 過去の注文を取得（全注文）
  const servedOrders = useMemo(
    () =>
      orders
        ? orders
            .slice()
            .sort((a, b) => b.orderId - a.orderId) // 注文番号の降順（新しい順）
        : [],
    [orders],
  );

  // 過去の注文からのコメント追加機能
  const addComment = async (servedOrder: OrderEntity, descComment: string) => {
    if (servedOrder.id)
      orderRepository.addComment(servedOrder.id, "cashier", descComment);
  };

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

  // 確定欄で押せるボタン。↑↓キーはこの中で動く。
  const availableSubmitTargets = useMemo(() => {
    const targets: SubmitFocusTarget[] = [];
    if (billingOk) targets.push("submit");
    if (newOrder.menus.length > 0 && !hasReceivedInput) {
      targets.push("exactPayment");
    }
    if (squareEnabled && newOrder.menus.length > 0) {
      targets.push(...SQUARE_PAYMENT_TYPES);
    }
    return targets;
  }, [billingOk, newOrder, hasReceivedInput, squareEnabled]);

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

  /**
   * 注文を送る。送れたら true
   *
   * square を渡したときは Square で支払い済み。決済を始めた時点の注文（square.order）を、
   * 画面に出ている注文番号で送る。お預かりは請求額と同じにする。
   */
  const submitOrder = useCallback(
    (options?: {
      exactPayment?: boolean;
      square?: { checkoutId: string; order: OrderEntity };
    }): boolean => {
      if (!canSubmitOrder) {
        return false;
      }
      const base = options?.square?.order ?? newOrder;
      if (
        !options?.square &&
        !options?.exactPayment &&
        newOrder.getCharge() < 0
      ) {
        return false;
      }
      if (base.menus.length === 0) {
        return false;
      }
      // 送信する直前に createdAt を更新する
      const submitOne = base.clone();
      if (options?.square) {
        submitOne.orderId = newOrder.orderId;
        submitOne.received = submitOne.billingAmount;
      } else if (options?.exactPayment) {
        submitOne.received = submitOne.billingAmount;
      }
      submitOne.nowCreated();
      goodsOnlyServed(submitOne);
      // 備考を追加
      submitOne.addComment("cashier", descComment);
      printer.printOrderLabel(submitOne);
      submitPayload(
        submitOne,
        options?.square
          ? { method: "square", squareCheckoutId: options.square.checkoutId }
          : undefined,
      );

      // オフライン時（手動番号指定時）は次の番号を自動設定
      if (manualOrderId !== null && wsStatus !== "open") {
        setOrderIdOverride(manualOrderId + 1);
      }

      resetAll();
      setServiceActive(false);
      playSound();
      return true;
    },
    [
      canSubmitOrder,
      newOrder,
      resetAll,
      printer,
      submitPayload,
      descComment,
      playSound,
      manualOrderId,
      setOrderIdOverride,
      wsStatus,
      setServiceActive,
    ],
  );

  const squarePayment = useSquarePayment({
    onPaid: (checkout, order) =>
      submitOrder({ square: { checkoutId: checkout.id, order } }),
  });

  const startSquarePayment = useCallback(
    (paymentType: SquarePaymentType) => {
      if (!canEnterSubmit) {
        return;
      }
      squarePayment.start(newOrder, paymentType);
    },
    [canEnterSubmit, squarePayment.start, newOrder],
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
                currentBillingAmount={newOrder.billingAmount}
                canSubmit={canEnterSubmit && !squarePaymentActive}
                onSubmitWithCheckout={(checkout) =>
                  submitOrder({
                    square: { checkoutId: checkout.id, order: newOrder },
                  })
                }
              />
            )}
            <PrinterStatus status={printer.status} />
            <PastOrderSideSheet
              orders={servedOrders}
              cardUser={"cashier"}
              cardTiming={"all"}
              comment={addComment}
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
                onExactPayment={() => submitOrder({ exactPayment: true })}
                order={newOrder}
                focus={inputStatus === "submit" && !squarePaymentActive}
                focusTarget={submitFocusTarget}
                availableTargets={availableSubmitTargets}
                squarePaymentTypes={squareEnabled ? SQUARE_PAYMENT_TYPES : []}
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
