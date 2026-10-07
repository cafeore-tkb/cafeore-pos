import {
  DRIPPER_NUMBERS,
  type MenuEntity,
  type WithId,
  assignmentDisplay,
  dripperLabel,
} from "@cafeore/common";
import { Cross2Icon, Pencil2Icon } from "@radix-ui/react-icons";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { useFocusRef } from "../functional/useFocusRef";
import { Input } from "../ui/input";

type props = {
  item: WithId<MenuEntity>;
  idx: number;
  mutateItem: (
    idx: number,
    action: (prev: WithId<MenuEntity>) => WithId<MenuEntity>,
  ) => void;
  removeItem: () => void;
  highlight: boolean;
  focus: boolean;
  onClick: () => void;
};

/**
 * 番号のキー（1〜6）で指名、0 で指名なし
 */
const dripperFromKey = (key: string): number | null | undefined => {
  if (key === "0") return null;
  const n = Number(key);
  return DRIPPER_NUMBERS.find((d) => d === n);
};

/**
 * Enterで指名の入力欄を開けて、アイテムの指名を変更できるコンポーネント
 *
 * 指名はドリッパーの番号（1st〜6th）が必須で、自由記述（ラベルに印刷する文）は番号に添えるだけ
 */
const ItemAssign = memo(
  ({ item, idx, mutateItem, focus, highlight, onClick, removeItem }: props) => {
    const [dripper, setDripper] = useState<number | null>(item.dripper);
    const [assignee, setAssignee] = useState(item.assignee ?? "");
    const wasFocused = useRef(focus);

    const dripperRef = useFocusRef<HTMLSelectElement>(focus);

    // 入力欄を開いたときは今の指名から始め、閉じたときに保存する
    /**
     * FIXME #412 useEffect内でstateを更新している
     * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
     */
    useEffect(() => {
      if (focus && !wasFocused.current) {
        setDripper(item.dripper);
        setAssignee(item.assignee ?? "");
      }
      if (!focus && wasFocused.current) {
        mutateItem(idx, (prev) => {
          const copy = prev.clone();
          copy.assign(dripper, assignee);
          if (
            copy.dripper === prev.dripper &&
            copy.assignee === prev.assignee
          ) {
            return prev;
          }
          return copy;
        });
      }
      wasFocused.current = focus;
    }, [focus, item, dripper, assignee, idx, mutateItem]);

    const assignView = useMemo(() => {
      const display = assignmentDisplay(item);
      if (display) {
        // 内部の表示は番号で、自由記述はラベルに印刷する文として添える
        return item.dripper !== null && item.assignee
          ? `${display}（${item.assignee}）`
          : display;
      }
      return highlight ? "Enterで入力" : "　　指名　　";
    }, [highlight, item]);

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
            <p className="text-stone-500 text-xs">
              {item.item_type.display_name}
            </p>
            <div className="flex justify-end">
              {focus ? (
                <div className="flex w-3/4 gap-1">
                  <select
                    ref={dripperRef}
                    aria-label="指名する番号"
                    value={dripper ?? ""}
                    onChange={(e) =>
                      setDripper(
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    onKeyDown={(e) => {
                      const next = dripperFromKey(e.key);
                      if (next === undefined) return;
                      e.preventDefault();
                      setDripper(next);
                    }}
                    className="h-6 w-2/5 rounded-md border border-stone-300 px-1 text-sm"
                  >
                    <option value="">指名なし</option>
                    {DRIPPER_NUMBERS.map((d) => (
                      <option key={d} value={d}>
                        {dripperLabel(d)}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="指名の自由記述"
                    value={dripper === null ? "" : assignee}
                    disabled={dripper === null}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder={
                      dripper === null
                        ? "番号を選ぶと書ける"
                        : `ラベルの文（空なら${dripperLabel(dripper)}）`
                    }
                    className="h-6 w-3/5 border-stone-300 border-b-2 text-sm"
                  />
                </div>
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
                    <p className="flex-none truncate text-sm text-stone-400">
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
