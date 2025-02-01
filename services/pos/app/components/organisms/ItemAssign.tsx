import { type ItemEntity, type WithId, type2label } from "@cafeore/common";
import { Cross2Icon, Pencil2Icon } from "@radix-ui/react-icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { useFocusRef } from "../functional/useFocusRef";
import { Input } from "../ui/input";

type props = {
  item: WithId<ItemEntity>;
  idx: number;
  mutateItem: (
    idx: number,
    action: (prev: WithId<ItemEntity>) => WithId<ItemEntity>,
  ) => void;
  removeItem: () => void;
  highlight: boolean;
  focus: boolean;
  onClick: () => void;
};

/**
 * Enterでアサイン入力欄を開けて、アイテムのアサインを変更できるコンポーネント
 */
const ItemAssign = memo(
  ({ item, idx, mutateItem, focus, highlight, onClick, removeItem }: props) => {
    const [assignee, setAssinee] = useState<string | null>(null);

    const assignInputRef = useFocusRef<HTMLInputElement>(focus);

    const saveAssignInput = useCallback(() => {
      mutateItem(idx, (prev) => {
        const copy = prev.clone();
        copy.assignee = assignee;
        return copy;
      });
    }, [assignee, idx, mutateItem]);

    // アサイン入力欄を閉じるときに保存
    useEffect(() => {
      if (!focus) {
        saveAssignInput();
      }
    }, [focus, saveAssignInput]);

    const assignView = useMemo(() => {
      if (item.assignee) return item.assignee;
      return highlight ? "Enterで入力" : "　　　　　　";
    }, [highlight, item.assignee]);

    return (
      <div
        className={cn(
          "grid grid-cols-6 border-white border-l-2",
          highlight && "border-orange-600",
        )}
      >
        <div className="col-span-5 flex items-center">
          <p className="flex-none p-3 font-bold font-mono text-lg">{idx + 1}</p>
          <div className="flex-1">
            <p className="font-bold text-lg">{item.name}</p>
            <p className="text-stone-500 text-xs">{type2label[item.type]}</p>
            <div className="flex justify-end">
              {focus ? (
                <Input
                  ref={assignInputRef}
                  value={assignee ?? ""}
                  onChange={(e) => setAssinee(e.target.value)}
                  placeholder="指名"
                  className="h-6 w-1/2 border-stone-300 border-b-2 text-sm"
                />
              ) : (
                <div
                  className={cn(
                    "flex w-1/2 items-center border-stone-300 border-b-2",
                    highlight && "border-stone-950",
                  )}
                >
                  {highlight && (
                    <Pencil2Icon className="w-1/6 stroke-stone-400 pr-1" />
                  )}
                  <button type="button" onClick={onClick} className="w-5/6">
                    <p className="flex-none text-sm text-stone-400">
                      {assignView}
                    </p>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex flex-1 items-start justify-end">
            <button type="button" className="mt-2" onClick={removeItem}>
              <Cross2Icon className="h-4 w-4 stroke-stone-400" />
            </button>
          </div>
          <div className="flex flex-1 items-start justify-center">
            <p className="text-right">&yen;{item.price}</p>
          </div>
        </div>
      </div>
    );
  },
);

export { ItemAssign };
