import type {
  ItemEntity,
  OrderEntity,
  OrderStatType,
  WithId,
} from "@cafeore/common";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type MetaFunction, useSubmit } from "react-router";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { InputComment } from "~/components/molecules/InputComment";
import { PastOrderSideSheet } from "~/components/molecules/PastOrderSideSheet";
import { RealtimeElapsedTime } from "~/components/molecules/RealtimeElapsedTime";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "マスターシート / 珈琲・俺POS" }];
};

export { clientAction } from "./_header.master";

const CUP_COLUMNS = ["1st", "2nd", "3rd", "4th", "5th", "6th"] as const;
const MAX_CUPS_PER_CELL = 2;
const EMPTY_TRAILING_ROWS = 10;
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
  selected,
  onClick,
}: {
  cup: CupEntry;
  assigned?: boolean;
  stacked?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) => {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (onClick && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
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
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative z-[1] select-none border-slate-500 px-1.5 py-1",
          cupColor(cup.item),
          onClick && "cursor-pointer hover:ring-2 hover:ring-slate-400",
          selected && "ring-4 ring-blue-600",
        )}
      >
        <p className="font-bold text-sm">{cup.item.abbr}</p>
        <p className="text-[10px] text-slate-600">No. {cup.order.orderId}</p>
        {cup.item.assignee && (
          <p className="text-[10px]">指名：{cup.item.assignee}</p>
        )}
      </Card>
    </div>
  );
};

export default function MasterSheet() {
  const { orders } = useOrdersWSContext();
  const submit = useSubmit();
  const isOperational = useOrderStat();
  const [assignments, setAssignments] = useState<Assignments>({});
  const [selectedCupKey, setSelectedCupKey] = useState<string>();
  const [hasLoadedAssignments, setHasLoadedAssignments] = useState(false);

  const activeOrders = useMemo(
    () =>
      orders
        .filter((order) => order.servedAt === null)
        .sort((a, b) => a.orderId - b.orderId),
    [orders],
  );

  const allCups = useMemo(
    () =>
      orders.flatMap((order) =>
        order.getDrinkCups().map((item, index) => ({
          key: `${order.id}:${index}`,
          index,
          item,
          order,
        })),
      ),
    [orders],
  );

  const cups = useMemo(
    () => allCups.filter((cup) => cup.order.servedAt === null),
    [allCups],
  );

  const cupsByKey = useMemo(
    () => new Map(allCups.map((cup) => [cup.key, cup])),
    [allCups],
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
    if (!hasLoadedAssignments || allCups.length === 0) return;
    const currentCupKeys = new Set(allCups.map((cup) => cup.key));
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
  }, [allCups, cupsByKey, hasLoadedAssignments]);

  useEffect(() => {
    if (selectedCupKey && !cups.some((cup) => cup.key === selectedCupKey)) {
      setSelectedCupKey(undefined);
    }
  }, [cups, selectedCupKey]);

  const getCupMoveGroup = (cup: CupEntry) => {
    const matchingCups = allCups.filter(
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

  const canAssignCupToCell = (cupKey: string, targetCellKey: string) => {
    const cup = cupsByKey.get(cupKey);
    if (!cup) return false;

    const movingCupKeys = getCupMoveGroup(cup).map(
      (movingCup) => movingCup.key,
    );
    const targetCupKeys = (assignments[targetCellKey] ?? []).filter(
      (key) => !movingCupKeys.includes(key),
    );
    if (targetCupKeys.length + movingCupKeys.length > MAX_CUPS_PER_CELL) {
      return false;
    }

    const targetCupName = cupsByKey.get(targetCupKeys[0])?.item.name;
    return !targetCupName || targetCupName === cup.item.name;
  };

  const assignSelectedCup = (targetCellKey: string) => {
    if (!selectedCupKey || !canAssignCupToCell(selectedCupKey, targetCellKey)) {
      return;
    }

    moveCup(selectedCupKey, targetCellKey);
    setSelectedCupKey(undefined);
  };

  const unassignCup = (cupKey: string) => {
    moveCup(cupKey);
    setSelectedCupKey(undefined);
  };

  const unassignedCount = cups.filter(
    (cup) => !assignedCupKeys.has(cup.key),
  ).length;
  const selectedCup = selectedCupKey
    ? cupsByKey.get(selectedCupKey)
    : undefined;

  const mutateOrder = (order: OrderEntity, descComment: string) => {
    if (!order.id || descComment.trim() === "") return;

    submit(
      {
        intent: "addComment",
        servedOrderId: order.id,
        descComment,
      },
      { method: "POST" },
    );
  };

  const submitOrderStatChange = useCallback(
    (status: OrderStatType) => {
      submit(
        {
          intent: "changeOrderStat",
          status,
        },
        { method: "POST" },
      );
    },
    [submit],
  );

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden bg-slate-50 p-2 font-sans text-slate-950">
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <h1 className="font-bold text-2xl">マスターシート</h1>
          <p className="text-slate-600 text-xs">
            注文カードを選び、次に表の枠を選んで割り振ります
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="shrink-0 text-sm">提供待ち：{activeOrders.length}件</p>
          <p className="shrink-0 font-bold text-sm">
            未割り振り：{unassignedCount}杯
          </p>
          <Button
            type="button"
            className={cn(
              "h-8 px-3 text-xs",
              isOperational
                ? "bg-red-700 hover:bg-red-600"
                : "bg-sky-700 hover:bg-sky-600",
            )}
            onClick={() =>
              submitOrderStatChange(isOperational ? "stop" : "operational")
            }
          >
            {isOperational ? "オーダーストップ" : "オーダー再開"}
          </Button>
          <PastOrderSideSheet
            orders={orders}
            cardUser="master"
            cardTiming="past"
            comment={mutateOrder}
            compact
          />
          <Button
            type="button"
            variant="outline"
            className="h-8 px-3 text-xs"
            disabled={assignedCupKeys.size === 0}
            onClick={() => {
              setAssignments({});
              setSelectedCupKey(undefined);
            }}
          >
            割り振りをリセット
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)] items-stretch gap-2">
        <div className="h-full min-h-0 overflow-auto rounded-md border-2 border-slate-900 bg-white shadow-sm">
          <table className="w-full min-w-[550px] table-fixed border-collapse">
            <colgroup>
              <col className="w-20" />
              {CUP_COLUMNS.map((label) => (
                <col key={label} />
              ))}
              <col className="w-14" />
            </colgroup>
            <thead className="sticky top-2 z-[1] bg-slate-100">
              <tr>
                <th className="h-16 border-slate-900 border-r-4 border-b-4 px-1 font-bold text-base">
                  注文 No.
                </th>
                {CUP_COLUMNS.map((label) => (
                  <th
                    key={label}
                    className="h-16 border-slate-900 border-r-2 border-b-4 px-1 font-bold text-2xl"
                  >
                    {label}
                    <span className="block font-normal text-[9px] text-slate-500">
                      最大2杯
                    </span>
                  </th>
                ))}
                <th className="h-16 border-slate-900 border-b-4 border-l-4 px-1 font-bold text-sm">
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
                const allRowOrdersServed =
                  rowCups.length > 0 &&
                  rowCups.every((cup) => cup.order.servedAt !== null);

                return (
                  <tr
                    key={rowKey}
                    className={cn(
                      "h-28",
                      allRowOrdersServed &&
                        "bg-slate-200 text-slate-500 grayscale",
                    )}
                  >
                    <th className="border-slate-900 border-r-4 border-b-2 px-1 text-center">
                      {orderNumbers.length === 0 ? (
                        <span className="text-2xl text-slate-300">—</span>
                      ) : (
                        <div className="flex flex-wrap justify-center gap-1">
                          {orderNumbers.map((orderNumber) => (
                            <span
                              key={orderNumber}
                              className="rounded bg-slate-900 px-1.5 py-1 font-bold text-white text-xs"
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

                      const canAssign = selectedCupKey
                        ? canAssignCupToCell(selectedCupKey, targetKey)
                        : false;

                      return (
                        <td
                          key={label}
                          className="border-slate-900 border-r-2 border-b-2 p-1 align-top"
                        >
                          <div
                            className={cn(
                              "relative grid min-h-24 grid-rows-2 gap-1 rounded border border-slate-300 border-dashed p-1",
                              assignedCups.length >= MAX_CUPS_PER_CELL &&
                                "border-slate-500 border-solid",
                            )}
                          >
                            {selectedCupKey && canAssign && (
                              <button
                                type="button"
                                aria-label={`${label}の枠に配置`}
                                className="absolute inset-0 z-20 cursor-pointer rounded bg-transparent"
                                onClick={() => assignSelectedCup(targetKey)}
                              />
                            )}
                            {getCupDisplays(assignedCups).map((display) => (
                              <CupChip
                                key={display.cup.key}
                                cup={display.cup}
                                stacked={display.stacked}
                                onClick={() => unassignCup(display.cup.key)}
                              />
                            ))}
                            {assignedCups.length === 0 && (
                              <p className="row-span-2 self-center text-center text-[10px] text-slate-400">
                                {selectedCupKey ? "ここに配置" : "枠を選択"}
                              </p>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-slate-900 border-b-2 border-l-4 px-1 text-center font-bold text-2xl">
                      {rowCups.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section className="flex h-full min-h-0 flex-col rounded-md border-2 border-slate-900 bg-white p-2 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2 border-slate-900 border-b-2 pb-2">
            <div>
              <h2 className="font-bold text-xl">注文内容</h2>
              <p className="text-[10px] text-slate-500">
                カードを選択後、表の枠を選択してください
              </p>
            </div>
            <div className="text-right text-xs">
              <p className="font-bold">未割り振り {unassignedCount}杯</p>
              {selectedCup && (
                <p className="font-bold text-blue-700">
                  選択：{selectedCup.item.abbr} No.{selectedCup.order.orderId}
                </p>
              )}
            </div>
          </div>

          {activeOrders.length === 0 ? (
            <p className="min-h-0 flex-1 overflow-y-auto py-8 text-center text-slate-500">
              表示する注文内容はありません
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto pr-1">
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
                      order.status === "calling" &&
                        "bg-slate-100 text-slate-500",
                    )}
                  >
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-slate-900 border-b-2 bg-slate-100 px-2 py-1.5">
                      <h3 className="font-bold text-lg">
                        注文 No. {order.orderId}
                      </h3>
                      <div className="text-right">
                        <p className="font-bold">{orderCups.length}杯</p>
                        <RealtimeElapsedTime order={order} compact />
                      </div>
                    </CardHeader>

                    <CardContent className="p-2">
                      <div className="grid grid-cols-2 gap-1.5">
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
                              selected={display.groupedCupKeys.includes(
                                selectedCupKey ?? "",
                              )}
                              onClick={
                                isAssigned
                                  ? () => unassignCup(display.cup.key)
                                  : () =>
                                      setSelectedCupKey((current) =>
                                        current === display.cup.key
                                          ? undefined
                                          : display.cup.key,
                                      )
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

                      <InputComment order={order} addComment={mutateOrder} />
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
