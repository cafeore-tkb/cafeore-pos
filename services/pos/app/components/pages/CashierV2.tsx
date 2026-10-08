import type { MenuEntity, OrderEntity, WithId } from "@cafeore/common";
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
  dismissSubmitFailed,
  notifySubmitFailed,
} from "../functional/submitFailedToast";
import { useInputStatus } from "../functional/useInputStatus";
import { useLatestOrderId } from "../functional/useLatestOrderId";
import type { OrderAction } from "../functional/useOrderState";
import { usePreventNumberKeyUpDown } from "../functional/usePreventNumberKeyUpDown";
import { useSubmitKey } from "../functional/useSubmitKey";
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
import { SubmitSection } from "../organisms/SubmitSection";
import { Label } from "../ui/label";

type props = {
  items: WithId<MenuEntity>[] | undefined; // itemMasterを渡す
  orders: WithId<OrderEntity>[] | undefined;
  wsStatus: "connecting" | "open" | "closed" | "error";
  canSubmitOrder: boolean;
  /**
   * 保存した注文を返す。失敗したら reject する
   *
   * idempotencyKey が同じなら、保存済みでも新しく作らずにその注文を返す
   */
  submitPayload: (
    order: OrderEntity,
    idempotencyKey: string | undefined,
  ) => Promise<WithId<OrderEntity>>;
  syncOrder: (order: OrderEntity) => void;
};

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
  const [submitFocusTarget, setSubmitFocusTarget] = useState<
    "submit" | "exactPayment"
  >("submit");
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

  // 保存中の二重送信を防ぐ。ref は同じ描画のうちに Enter が連打された場合のため
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const submitKey = useSubmitKey();

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
    // 入力を消したら、同じ内容を打ち直しても別の注文として扱う
    submitKey.reset();
  }, [dispatchOrder, resetStatus, renewUISession, submitKey.reset]);

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

  const focusSubmitAction = useCallback(
    (target: "submit" | "exactPayment") => {
      if (
        inputStatus === "submit" &&
        !(target === "exactPayment" && hasReceivedInput)
      ) {
        setSubmitFocusTarget(target);
      }
    },
    [inputStatus, hasReceivedInput],
  );

  /**
   * FIXME #412 useEffect内でstateを更新している
   */
  useEffect(() => {
    if (inputStatus === "submit" && !canEnterSubmit) {
      setInputStatus("received");
    }
  }, [inputStatus, canEnterSubmit, setInputStatus]);

  const submitOrder = useCallback(
    async (exactPayment?: boolean) => {
      if (submittingRef.current) {
        return;
      }
      if (!canSubmitOrder) {
        return;
      }
      if (!exactPayment && newOrder.getCharge() < 0) {
        return;
      }
      if (newOrder.menus.length === 0) {
        return;
      }
      // 送信する直前に createdAt を更新する
      const submitOne = newOrder.clone();
      if (exactPayment) submitOne.received = submitOne.billingAmount;
      submitOne.nowCreated();
      goodsOnlyServed(submitOne);
      // 備考を追加
      submitOne.addComment("cashier", descComment);

      // 保存できたことを確かめてから、ラベル印刷と画面のリセットをする (#732)
      // 失敗したときは入力をそのまま残し、もう一度送信できるようにする
      submittingRef.current = true;
      setSubmitting(true);
      let savedOrder: WithId<OrderEntity>;
      try {
        savedOrder = await submitPayload(
          submitOne,
          submitKey.keyFor(submitOne),
        );
      } catch (error) {
        console.error(error);
        notifySubmitFailed(submitOne.orderId, error);
        return;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
      dismissSubmitFailed();
      // 送り直しで保存済みの注文が返ったときは、その注文の番号でラベルを出す
      submitOne.orderId = savedOrder.orderId;
      printer.printOrderLabel(submitOne);

      // オフライン時（手動番号指定時）は次の番号を自動設定
      if (manualOrderId !== null && wsStatus !== "open") {
        setOrderIdOverride(manualOrderId + 1);
      }

      resetAll();
      setServiceActive(false);
      playSound();
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
      submitKey.keyFor,
    ],
  );

  const keyEventHandlers = useMemo(() => {
    return {
      ArrowRight: proceedStatusGuarded,
      ArrowLeft: previousStatus,
      ArrowUp: () => focusSubmitAction("submit"),
      ArrowDown: () => focusSubmitAction("exactPayment"),
      Escape: () => {
        resetAll();
      },
    };
  }, [proceedStatusGuarded, previousStatus, focusSubmitAction, resetAll]);

  /**
   * OK
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // 保存中に Escape などで入力を消すと、失敗したときに打ち直しになる
      if (submittingRef.current) {
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
  }, [keyEventHandlers]);

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
            <PrinterStatus status={printer.status} />
            <PastOrderSideSheet orders={orders} author="cashier" withGoods />
          </div>
        </div>
        {/* 保存中は入力を変えられないようにする。失敗したら同じ入力で送り直すため */}
        <div
          className={cn("flex gap-5 px-2", submitting && "pointer-events-none")}
        >
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
            {/* disabled にするとフォーカスが外れて Enter で再送できなくなるので、押せなくするだけにする */}
            <div
              aria-busy={submitting}
              className={cn(submitting && "pointer-events-none opacity-50")}
            >
              <fieldset
                disabled={!canEnterSubmit}
                className="min-w-0 border-0 p-0"
              >
                <SubmitSection
                  submitOrder={submitOrder}
                  onExactPayment={() => submitOrder(true)}
                  order={newOrder}
                  focus={inputStatus === "submit"}
                  focusTarget={submitFocusTarget}
                  exactPaymentDisabled={
                    newOrder.menus.length === 0 || hasReceivedInput
                  }
                />
              </fieldset>
              {submitting && (
                <p className="text-center text-sm text-stone-500">保存中…</p>
              )}
            </div>
          </div>
        </div>
        <audio src={bellTwice} ref={soundRef}>
          <track kind="captions" />
        </audio>
      </div>
    </>
  );
};

export { CashierV2 };
