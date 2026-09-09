import {
  type ItemEntity,
  type OrderEntity,
  type WithId,
  orderRepository,
} from "@cafeore/common";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { transformToteSet } from "../functional/transformToteSet";
import { useInputStatus } from "../functional/useInputStatus";
import { useLatestOrderId } from "../functional/useLatestOrderId";
import type { OrderAction } from "../functional/useOrderState";
import { usePreventNumberKeyUpDown } from "../functional/usePreventNumberKeyUpDown";
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
  items: WithId<ItemEntity>[] | undefined; // itemMasterを渡す
  orders: WithId<OrderEntity>[] | undefined;
  wsStatus: "connecting" | "open" | "closed" | "error";
  submitPayload: (order: OrderEntity) => void;
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
    resetStatus();
    renewUISession();
  }, [dispatchOrder, resetStatus, renewUISession]);

  const submitOrder = useCallback(() => {
    if (newOrder.getCharge() < 0) {
      return;
    }
    if (newOrder.items.length === 0) {
      return;
    }
    const toteSetProcessedOrder = transformToteSet(newOrder, items ?? []);
    // 送信する直前に createdAt を更新する
    const submitOne = toteSetProcessedOrder.clone();
    submitOne.nowCreated();
    goodsOnlyServed(submitOne);
    // 備考を追加
    submitOne.addComment("cashier", descComment);
    printer.printOrderLabel(submitOne);
    submitPayload(submitOne);

    // オフライン時（手動番号指定時）は次の番号を自動設定
    if (manualOrderId !== null && wsStatus !== "open") {
      setOrderIdOverride(manualOrderId + 1);
    }

    resetAll();
    setServiceActive(false);
    playSound();
  }, [
    newOrder,
    resetAll,
    printer,
    submitPayload,
    descComment,
    playSound,
    manualOrderId,
    setOrderIdOverride,
    wsStatus,
    items,
    setServiceActive,
  ]);

  const keyEventHandlers = useMemo(() => {
    return {
      ArrowRight: proceedStatus,
      ArrowLeft: previousStatus,
      Escape: () => {
        resetAll();
      },
    };
  }, [proceedStatus, previousStatus, resetAll]);

  /**
   * OK
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
                  (received) =>
                    dispatchOrder({ type: "setReceived", received }),
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
            <SubmitSection
              submitOrder={submitOrder}
              order={newOrder}
              focus={inputStatus === "submit"}
            />
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
