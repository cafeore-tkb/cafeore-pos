import { useCallback, useEffect, useState } from "react";
import type { WithId } from "~/lib/typeguard";
import type { ItemEntity } from "~/models/item";
import type { OrderEntity } from "~/models/order";
import { ItemAssign } from "./ItemAssign";

const keys = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];

type props = {
  order: OrderEntity;
  items: WithId<ItemEntity>[] | undefined;
  focus: boolean;
  onAddItem: (item: WithId<ItemEntity>) => void;
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
  mutateItem,
  order,
  items,
}: props) => {
  const [itemFocus, setItemFocus] = useState<number>(-1);
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
  useEffect(() => {
    if (!items) return;
    const handler = (event: KeyboardEvent) => {
      for (const [idx, item] of items.entries()) {
        if (editable) return;
        if (event.key === keys[idx]) {
          onAddItem(item);
        }
      }
    };
    if (focus) {
      window.addEventListener("keydown", handler);
    }
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [items, focus, editable, onAddItem]);

  // focus が外れたときに itemFocus をリセット
  useEffect(() => {
    if (!focus) {
      setItemFocus(-1);
    }
  }, [focus]);

  return (
    <>
      {focus && (
        <>
          <p>商品を追加: キーボードの a, s, d, f, g, h, j, k, l, ;</p>
          <p>↑・↓でアイテムのフォーカスを移動</p>
          <p>Enterで指名の入力欄を開く</p>
        </>
      )}
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
      {discountOrder && (
        <div className="grid grid-cols-2">
          <p className="font-bold text-lg">割引</p>
          <div>-&yen;{order.discount}</div>
        </div>
      )}
    </>
  );
};

export { OrderItemEdit };
