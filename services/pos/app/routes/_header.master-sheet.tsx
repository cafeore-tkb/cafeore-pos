import type { ItemEntity, OrderEntity, WithId } from "@cafeore/common";
import { useEffect, useMemo, useState } from "react";
import type { MetaFunction } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "マスターシート / 珈琲・俺POS" }];
};

const CUP_COLUMNS = ["1st", "2nd", "3rd", "4th", "5th", "6th"] as const;
const MAX_CUPS_PER_CELL = 2;
const EMPTY_TRAILING_ROWS = 10;
const DRAG_DATA_TYPE = "application/x-cafeore-cup";
const ASSIGNMENTS_STORAGE_KEY = "cafeore-pos:master-sheet:assignments";

type Assignments = Record<string, string[]>;

type CupEntry = {
  key: string;
  index: number;
  item: WithId<ItemEntity>;
  order: WithId<OrderEntity>;
};

const cellKey = (rowIndex: number, columnIndex: number) =>
  `${rowIndex}:${columnIndex}`;

const cupColor = (item: WithId<ItemEntity>) => {
  if (item.name === "限定") return "bg-red-200";

  switch (item.item_type.name) {
    case "iceOre":
      return "bg-sky-200";
    case "hotOre":
      return "bg-orange-200";
    case "ice":
      return "bg-blue-200";
    case "milk":
      return "bg-gray-200";
    default:
      return "bg-white";
  }
};

const CupChip = ({
  cup,
  assigned,
  stacked,
  onClick,
}: {
  cup: CupEntry;
  assigned?: boolean;
  stacked?: boolean;
  onClick?: () => void;
}) => {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (onClick && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={cn(
        "relative",
        stacked && "mr-1.5 mb-1.5",
        assigned && "opacity-45",
      )}
    >
      {stacked && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-xl border border-slate-500 shadow-sm",
            cupColor(cup.item),
          )}
        />
      )}
      <Card
        draggable
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(DRAG_DATA_TYPE, cup.key);
          event.dataTransfer.setData("text/plain", cup.key);
        }}
        className={cn(
          "relative z-[1] cursor-grab select-none border-slate-500 px-2 py-2 active:cursor-grabbing",
          cupColor(cup.item),
          onClick && "hover:ring-2 hover:ring-slate-400",
        )}
      >
        <p className="font-bold text-base">{cup.item.abbr}</p>
        <p className="text-slate-600 text-xs">No. {cup.order.orderId}</p>
        {cup.item.assignee && (
          <p className="text-xs">指名：{cup.item.assignee}</p>
        )}
      </Card>
    </div>
  );
};

export default function MasterSheet() {
  const { orders } = useOrdersWSContext();
  const [assignments, setAssignments] = useState<Assignments>({});
  const [hasLoadedAssignments, setHasLoadedAssignments] = useState(false);

  const activeOrders = useMemo(
    () =>
      orders
        .filter((order) => order.servedAt === null)
        .sort((a, b) => a.orderId - b.orderId),
    [orders],
  );

  const cups = useMemo(
    () =>
      activeOrders.flatMap((order) =>
        order.getDrinkCups().map((item, index) => ({
          key: `${order.id}:${index}`,
          index,
          item,
          order,
        })),
      ),
    [activeOrders],
  );

  const cupsByKey = useMemo(
    () => new Map(cups.map((cup) => [cup.key, cup])),
    [cups],
  );
  const assignedCupKeys = useMemo(
    () => new Set(Object.values(assignments).flat()),
    [assignments],
  );
  const masterRows = useMemo(() => {
    const lastOccupiedRow = Object.entries(assignments).reduce(
      (lastRow, [key, cupKeys]) => {
        if (cupKeys.length === 0) return lastRow;
        const rowIndex = Number(key.split(":")[0]);
        return Number.isInteger(rowIndex)
          ? Math.max(lastRow, rowIndex)
          : lastRow;
      },
      -1,
    );

    return Array.from(
      { length: lastOccupiedRow + 1 + EMPTY_TRAILING_ROWS },
      (_, rowIndex) => `master-row-${rowIndex}`,
    );
  }, [assignments]);

  useEffect(() => {
    try {
      const savedAssignments = window.localStorage.getItem(
        ASSIGNMENTS_STORAGE_KEY,
      );
      if (savedAssignments) {
        const parsedAssignments: unknown = JSON.parse(savedAssignments);
        if (
          parsedAssignments &&
          typeof parsedAssignments === "object" &&
          !Array.isArray(parsedAssignments)
        ) {
          setAssignments(
            Object.fromEntries(
              Object.entries(parsedAssignments).filter(
                (entry): entry is [string, string[]] =>
                  Array.isArray(entry[1]) &&
                  entry[1].every((cupKey) => typeof cupKey === "string"),
              ),
            ),
          );
        }
      }
    } catch {
      window.localStorage.removeItem(ASSIGNMENTS_STORAGE_KEY);
    } finally {
      setHasLoadedAssignments(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedAssignments) return;
    window.localStorage.setItem(
      ASSIGNMENTS_STORAGE_KEY,
      JSON.stringify(assignments),
    );
  }, [assignments, hasLoadedAssignments]);

  useEffect(() => {
    if (!hasLoadedAssignments || cups.length === 0) return;
    const currentCupKeys = new Set(cups.map((cup) => cup.key));
    setAssignments((current) => {
      let changed = false;
      const next: Assignments = {};

      for (const [key, cupKeys] of Object.entries(current)) {
        const existingCupKeys = cupKeys.filter((cupKey) =>
          currentCupKeys.has(cupKey),
        );
        const firstCupName = cupsByKey.get(existingCupKeys[0])?.item.name;
        const validCupKeys = existingCupKeys
          .filter((cupKey) => cupsByKey.get(cupKey)?.item.name === firstCupName)
          .slice(0, MAX_CUPS_PER_CELL);
        if (validCupKeys.length !== cupKeys.length) changed = true;
        if (validCupKeys.length > 0) next[key] = validCupKeys;
      }

      return changed ? next : current;
    });
  }, [cups, cupsByKey, hasLoadedAssignments]);

  const getCupMoveGroup = (cup: CupEntry) => {
    const matchingCups = cups.filter(
      (candidate) =>
        candidate.order.id === cup.order.id &&
        candidate.item.name === cup.item.name,
    );
    const cupPosition = matchingCups.findIndex(
      (candidate) => candidate.key === cup.key,
    );
    const pairStart =
      Math.floor(cupPosition / MAX_CUPS_PER_CELL) * MAX_CUPS_PER_CELL;
    return matchingCups.slice(pairStart, pairStart + MAX_CUPS_PER_CELL);
  };

  const getCupDisplays = (sourceCups: CupEntry[]) => {
    const sourceCupKeys = new Set(sourceCups.map((cup) => cup.key));
    const displayedCupKeys = new Set<string>();

    return sourceCups.flatMap((cup) => {
      if (displayedCupKeys.has(cup.key)) return [];

      const displayedGroup = getCupMoveGroup(cup).filter((groupedCup) =>
        sourceCupKeys.has(groupedCup.key),
      );
      for (const groupedCup of displayedGroup) {
        displayedCupKeys.add(groupedCup.key);
      }

      return [
        {
          cup,
          groupedCupKeys: displayedGroup.map((groupedCup) => groupedCup.key),
          stacked: displayedGroup.length === MAX_CUPS_PER_CELL,
        },
      ];
    });
  };

  const moveCup = (cupKey: string, targetCellKey?: string) => {
    const cup = cupsByKey.get(cupKey);
    if (!cup) return;
    const movingCupKeys = getCupMoveGroup(cup).map(
      (movingCup) => movingCup.key,
    );

    setAssignments((current) => {
      const next = Object.fromEntries(
        Object.entries(current).map(([key, cupKeys]) => [
          key,
          cupKeys.filter((keyToCheck) => !movingCupKeys.includes(keyToCheck)),
        ]),
      );

      if (!targetCellKey) return next;

      const targetCups = next[targetCellKey] ?? [];
      if (targetCups.length + movingCupKeys.length > MAX_CUPS_PER_CELL) {
        return current;
      }

      const targetCupName = targetCups
        .map((key) => cupsByKey.get(key))
        .find((targetCup) => targetCup !== undefined)?.item.name;
      if (targetCupName && targetCupName !== cup.item.name) {
        return current;
      }

      next[targetCellKey] = [...targetCups, ...movingCupKeys];
      return next;
    });
  };

  const readDraggedCup = (event: React.DragEvent) =>
    event.dataTransfer.getData(DRAG_DATA_TYPE) ||
    event.dataTransfer.getData("text/plain");

  const unassignedCount = cups.length - assignedCupKeys.size;

  return (
    <main className="h-[calc(100dvh-3.5rem)] overflow-hidden bg-slate-50 p-3 font-sans text-slate-950">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl">マスターシート</h1>
          <p className="mt-1 text-slate-600 text-sm">
            同じ注文・商品名のカップは2杯ずつまとめて移動します
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="shrink-0 font-bold text-lg">
            未割り振り：{unassignedCount}杯
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={assignedCupKeys.size === 0}
            onClick={() => setAssignments({})}
          >
            割り振りをリセット
          </Button>
        </div>
      </div>

      <div className="grid h-[calc(100%-5rem)] min-h-0 grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] items-stretch gap-4">
        <div className="h-full min-h-0 overflow-auto rounded-md border-2 border-slate-900 bg-white shadow-sm">
          <table className="w-full min-w-[960px] table-fixed border-collapse">
            <colgroup>
              <col className="w-36" />
              {CUP_COLUMNS.map((label) => (
                <col key={label} />
              ))}
              <col className="w-28" />
            </colgroup>
            <thead className="sticky top-2 z-[1] bg-slate-100">
              <tr>
                <th className="h-24 border-slate-900 border-r-4 border-b-4 px-2 font-bold text-2xl">
                  注文 No.
                </th>
                {CUP_COLUMNS.map((label) => (
                  <th
                    key={label}
                    className="h-24 border-slate-900 border-r-2 border-b-4 px-2 font-bold text-4xl"
                  >
                    {label}
                    <span className="mt-1 block font-normal text-slate-500 text-xs">
                      最大2杯
                    </span>
                  </th>
                ))}
                <th className="h-24 border-slate-900 border-b-4 border-l-4 px-2 font-bold text-xl">
                  総杯数
                </th>
              </tr>
            </thead>
            <tbody>
              {masterRows.map((rowKey, rowIndex) => {
                const rowCupKeys = CUP_COLUMNS.flatMap(
                  (_, columnIndex) =>
                    assignments[cellKey(rowIndex, columnIndex)] ?? [],
                );
                const rowCups = rowCupKeys
                  .map((cupKey) => cupsByKey.get(cupKey))
                  .filter((cup): cup is CupEntry => cup !== undefined);
                const orderNumbers = Array.from(
                  new Set(rowCups.map((cup) => cup.order.orderId)),
                ).sort((a, b) => a - b);

                return (
                  <tr key={rowKey} className="h-36">
                    <th className="border-slate-900 border-r-4 border-b-2 px-2 text-center">
                      {orderNumbers.length === 0 ? (
                        <span className="text-2xl text-slate-300">—</span>
                      ) : (
                        <div className="flex flex-wrap justify-center gap-1">
                          {orderNumbers.map((orderNumber) => (
                            <span
                              key={orderNumber}
                              className="rounded bg-slate-900 px-2 py-1 font-bold text-lg text-white"
                            >
                              No. {orderNumber}
                            </span>
                          ))}
                        </div>
                      )}
                    </th>
                    {CUP_COLUMNS.map((label, columnIndex) => {
                      const targetKey = cellKey(rowIndex, columnIndex);
                      const assignedCups = (assignments[targetKey] ?? [])
                        .map((cupKey) => cupsByKey.get(cupKey))
                        .filter((cup): cup is CupEntry => cup !== undefined);

                      return (
                        <td
                          key={label}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            moveCup(readDraggedCup(event), targetKey);
                          }}
                          className="border-slate-900 border-r-2 border-b-2 p-2 align-top"
                        >
                          <div
                            className={cn(
                              "grid min-h-28 grid-rows-2 gap-2 rounded border-2 border-slate-300 border-dashed p-1",
                              assignedCups.length >= MAX_CUPS_PER_CELL &&
                                "border-slate-500 border-solid",
                            )}
                          >
                            {getCupDisplays(assignedCups).map((display) => (
                              <CupChip
                                key={display.cup.key}
                                cup={display.cup}
                                stacked={display.stacked}
                                onClick={() => moveCup(display.cup.key)}
                              />
                            ))}
                            {assignedCups.length === 0 && (
                              <p className="row-span-2 self-center text-center text-slate-400 text-sm">
                                ここにドロップ
                              </p>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-slate-900 border-b-2 border-l-4 px-2 text-center font-bold text-4xl">
                      {rowCups.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            moveCup(readDraggedCup(event));
          }}
          className="flex h-full min-h-0 flex-col rounded-md border-2 border-slate-900 bg-white p-4 shadow-sm"
        >
          <div className="mb-4 flex items-center justify-between gap-4 border-slate-900 border-b-2 pb-3">
            <div>
              <h2 className="font-bold text-2xl">注文内容</h2>
              <p className="mt-1 text-slate-500 text-sm">
                配置済みのカップをここへ戻すと割り振りを解除できます
              </p>
            </div>
            <p className="font-bold">未割り振り {unassignedCount}杯</p>
          </div>

          {activeOrders.length === 0 ? (
            <p className="min-h-0 flex-1 overflow-y-auto py-8 text-center text-slate-500">
              表示する注文内容はありません
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 auto-rows-max content-start gap-4 overflow-y-auto pr-1">
              {activeOrders.map((order) => {
                const orderCups = cups.filter(
                  (cup) => cup.order.id === order.id,
                );
                const otherItems = order.items.filter(
                  (item) => item.item_type.name === "others",
                );

                return (
                  <Card
                    key={order.id}
                    className={cn(
                      "overflow-hidden border-2 border-slate-900",
                      order.readyAt !== null && "bg-slate-100 text-slate-500",
                    )}
                  >
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-slate-900 border-b-2 bg-slate-100 px-4 py-3">
                      <h3 className="font-bold text-2xl">
                        注文 No. {order.orderId}
                      </h3>
                      <p className="font-bold">{orderCups.length}杯</p>
                    </CardHeader>

                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 gap-2">
                        {getCupDisplays(orderCups).map((display) => {
                          const isAssigned = display.groupedCupKeys.some(
                            (cupKey) => assignedCupKeys.has(cupKey),
                          );

                          return (
                            <CupChip
                              key={display.cup.key}
                              cup={display.cup}
                              assigned={isAssigned}
                              stacked={display.stacked}
                              onClick={
                                isAssigned
                                  ? () => moveCup(display.cup.key)
                                  : undefined
                              }
                            />
                          );
                        })}
                      </div>

                      {otherItems.length > 0 && (
                        <div className="mt-3 border-slate-300 border-t pt-3">
                          <p className="mb-1 font-bold text-sm">その他の商品</p>
                          <p>
                            {otherItems.map((item) => item.name).join("、")}
                          </p>
                        </div>
                      )}

                      {order.comments.length > 0 && (
                        <div className="mt-3 rounded bg-yellow-50 p-3 text-slate-800">
                          <p className="mb-1 font-bold text-sm">コメント</p>
                          {order.comments.map((comment, index) => (
                            <p
                              key={`${comment.createdAt.toISOString()}-${index}`}
                            >
                              {comment.text}
                            </p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
