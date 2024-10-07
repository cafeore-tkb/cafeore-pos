import type { WithId } from "common/lib/typeguard";
import type { ItemEntity } from "common/models/item";
import type { OrderEntity } from "common/models/order";
import { useCallback, useEffect, useState } from "react";
import { ItemAssign } from "./ItemAssign";

const keys = ["q", "d", "c", "w", "a", "v", "e", "s", "z", "x", "b"];

type props = {
  order: OrderEntity;
  items: WithId<ItemEntity>[] | undefined;
  focus: boolean;
  onAddItem: (item: WithId<ItemEntity>) => void;
  onRemoveItem: (idx: number) => void;
  mutateItem: (
    idx: number,
    action: (prev: WithId<ItemEntity>) => WithId<ItemEntity>,
  ) => void;
  discountOrder: boolean;
};

/**
 * オーダーのアイテムや割引情報を表示するコンポーネント
 */
const OrderItemEdit = ({
  focus,
  discountOrder,
  onAddItem,
  onRemoveItem,
  mutateItem,
  order,
  items,
}: props) => {
  const [itemFocus, setItemFocus] = useState<number>(0);
  const [editable, setEditable] = useState(false);

  /**
   * step だけ itemFocus を移動する
   *
   * - step が正の場合、次のアイテムに移動
   * - step が負の場合、前のアイテムに移動
   */
  const moveItemFocus = useCallback(
    (step: number) => {
      setItemFocus(
        (prev) => (prev + step + order.items.length) % order.items.length,
      );
    },
    [order.items],
  );

  /**
   * assign 入力欄を開く/閉じる
   */
  const switchEditable = useCallback(() => {
    if (editable) {
      setEditable(false);
    } else {
      setEditable(true);
    }
  }, [editable]);

  const removeItem = useCallback(() => {
    if (itemFocus === -1) return;
    onRemoveItem(itemFocus);
  }, [itemFocus, onRemoveItem]);

  // ↑・↓ が押されたときに itemFocus を移動
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowUp":
          moveItemFocus(-1);
          setEditable(false);
          break;
        case "ArrowDown":
          moveItemFocus(1);
          setEditable(false);
          break;
      }
    };
    if (focus) {
      window.addEventListener("keydown", handler);
    }
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [focus, moveItemFocus]);

  // Enter が押されたときに assign 入力欄を開く
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        switchEditable();
      }
    };
    if (focus) {
      window.addEventListener("keydown", handler);
    }
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [focus, switchEditable]);

  // キー操作でアイテムを追加
  // Backspace でアイテムを削除
  useEffect(() => {
    if (!items) return;
    const handler = (event: KeyboardEvent) => {
      for (const [idx, item] of items.entries()) {
        if (editable) return;
        if (event.key === keys[idx]) {
          onAddItem(item);
        }
      }
      if (event.key === "Backspace") {
        removeItem();
      }
    };
    if (focus) {
      window.addEventListener("keydown", handler);
    }
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [items, focus, editable, onAddItem, removeItem]);

  // focus が外れたときに itemFocus をリセット
  useEffect(() => {
    if (!focus) {
      setItemFocus(-1);
      setEditable(false);
    } else {
      setItemFocus(0);
    }
  }, [focus]);

  // itemFocus が range 外に出ないように調整
  useEffect(() => {
    setItemFocus((prev) =>
      Math.min(order.items.length - 1, Math.max(-1, prev)),
    );
  });

  return (
    <>
      <div className="flex justify-end pb-10">
        <p className="text-sm text-stone-400">上下矢印キーでアイテムを選択</p>
      </div>
      <div className="grid gap-5 pb-10">
        {order.items.map((item, idx) => (
          <ItemAssign
            key={`${idx}-${item.id}`}
            item={item}
            idx={idx}
            mutateItem={mutateItem}
            focus={editable && idx === itemFocus}
            highlight={idx === itemFocus}
          />
        ))}
      </div>
      <hr className="my-3" />
      <div className="grid grid-cols-6 text-stone-400">
        <p className="col-span-5 font-bold">小計</p>
        <div className="flex items-center justify-end text-right">
          &yen;{order.total}
        </div>
      </div>
      {discountOrder && (
        <>
          <hr className="my-3" />
          <div className="grid grid-cols-6 text-stone-400">
            <p className="col-span-5 font-bold">割引</p>
            <div className="flex items-center justify-end text-right">
              &minus; &yen;{order.discount}
            </div>
          </div>
        </>
      )}
      <hr className="my-3" />
      <div className="grid grid-cols-6">
        <p className="col-span-5 font-bold text-lg">合計</p>
        <div className="flex items-center justify-end text-right">
          &yen;{order.billingAmount}
        </div>
      </div>
    </>
  );
};

export { OrderItemEdit };
