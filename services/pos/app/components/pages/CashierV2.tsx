import type { ItemEntity, OrderEntity, WithId } from "@cafeore/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import bellTwice from "~/assets/bell_twice.mp3";
import { Switch } from "~/components/ui/switch";
import { usePrinter } from "~/label/print-util";
import { cn } from "~/lib/utils";
import { useInputStatus } from "../functional/useInputStatus";
import { useLatestOrderId } from "../functional/useLatestOrderId";
import { useObserveEmergency } from "../functional/useObserveEmergency";
import { useOrderState } from "../functional/useOrderState";
import { usePreventNumberKeyUpDown } from "../functional/usePreventNumberKeyUpDown";
import { useSyncCahiserOrder } from "../functional/useSyncCahiserOrder";
import { useUISession } from "../functional/useUISession";
import { AttractiveTextArea } from "../molecules/AttractiveTextArea";
import { InputHeader } from "../molecules/InputHeader";
import { PrinterStatus } from "../molecules/PrinterStatus";
import { DiscountInput } from "../organisms/DiscountInput";
import { ItemButtons } from "../organisms/ItemButtons";
import { OrderItemEdit } from "../organisms/OrderItemEdit";
import { OrderReceivedInput } from "../organisms/OrderReceivedInput";
import { SubmitSection } from "../organisms/SubmitSection";
import { Label } from "../ui/label";

type props = {
  items: WithId<ItemEntity>[] | undefined;
  orders: WithId<OrderEntity>[] | undefined;
  submitPayload: (order: OrderEntity) => void;
  syncOrder: (order: OrderEntity) => void;
};

/**
 * キャッシャー画面のコンポーネント
 *
 * データの入出力は親コンポーネントに任せる
 */
const CashierV2 = ({ items, orders, submitPayload, syncOrder }: props) => {
  const [newOrder, newOrderDispatch] = useOrderState();
  const {
    inputStatus,
    proceedStatus,
    previousStatus,
    resetStatus,
    setInputStatus,
  } = useInputStatus();
  const [descComment, setDescComment] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [UISession, renewUISession] = useUISession();
  const { nextOrderId } = useLatestOrderId(orders);
  const soundRef = useRef<HTMLAudioElement>(null);

  const playSound = useCallback(() => {
    soundRef.current?.play();
  }, []);

  useSyncCahiserOrder(newOrder, syncOrder);

  const printer = usePrinter();

  useObserveEmergency({
    onEmergencyAdded: useCallback(
      (order: OrderEntity) => {
        console.log("緊急オーダーが追加されました:", order);
        printer.printOrderLabel(order);
        playSound();
      },
      [printer, playSound],
    ),
  });

  usePreventNumberKeyUpDown();

  /**
   * FIXME #412 useEffect内でstateを更新している
   * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
   */
  useEffect(() => {
    newOrderDispatch({ type: "updateOrderId", orderId: nextOrderId });
  }, [nextOrderId, newOrderDispatch]);

  const resetAll = useCallback(() => {
    newOrderDispatch({ type: "clear" });
    resetStatus();
    renewUISession();
  }, [newOrderDispatch, resetStatus, renewUISession]);

  const submitOrder = useCallback(() => {
    if (newOrder.getCharge() < 0) {
      return;
    }
    if (newOrder.items.length === 0) {
      return;
    }
    // 送信する直前に createdAt を更新する
    const submitOne = newOrder.clone();
    submitOne.nowCreated();
    // 備考を追加
    submitOne.addComment("cashier", descComment);
    printer.printOrderLabel(submitOne);
    submitPayload(submitOne);
    resetAll();
    playSound();
  }, [newOrder, resetAll, printer, submitPayload, descComment, playSound]);

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
        (item) => newOrderDispatch({ type: "addItem", item }),
        [newOrderDispatch],
      )}
    />
  );

  return (
    <>
      <div className="p-4">
        <div className="flex justify-between">
          <div className="font-extrabold text-3xl">No.{newOrder.orderId}</div>
          <div className="flex items-center space-x-2">
            <Switch
              id="menu-button"
              checked={menuOpen}
              onCheckedChange={setMenuOpen}
            />
            <Label htmlFor="menu-button">メニュー表示</Label>
          </div>
          <PrinterStatus status={printer.status} />
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
                (item) => newOrderDispatch({ type: "addItem", item }),
                [newOrderDispatch],
              )}
              onRemoveItem={useCallback(
                (idx) => newOrderDispatch({ type: "removeItem", idx }),
                [newOrderDispatch],
              )}
              mutateItem={useCallback(
                (idx, action) =>
                  newOrderDispatch({ type: "mutateItem", idx, action }),
                [newOrderDispatch],
              )}
              focus={inputStatus === "items"}
              discountOrder={useMemo(
                () => newOrder.discountOrderId !== null,
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
            <div className="flex justify-center">
              <DiscountInput
                key={`DiscountInput-${UISession.key}`}
                focus={inputStatus === "discount"}
                orders={orders}
                onDiscountOrderFind={useCallback(
                  (discountOrder) =>
                    newOrderDispatch({ type: "applyDiscount", discountOrder }),
                  [newOrderDispatch],
                )}
                onDiscountOrderRemoved={useCallback(
                  () => newOrderDispatch({ type: "removeDiscount" }),
                  [newOrderDispatch],
                )}
                onClick={useCallback(() => {
                  setInputStatus("discount");
                }, [setInputStatus])}
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
                    newOrderDispatch({ type: "setReceived", received }),
                  [newOrderDispatch],
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
