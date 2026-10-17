import {
  type GeneratorParams,
  type MenuEntity,
  type MenuPlan,
  type WithId,
  initialPlan,
  latestYear,
  menuType,
  pastItemShares,
  pastTypeShares,
  pastTypes,
  weightOf,
} from "@cafeore/common";
import { useMemo } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** メニューに入っている品目の数（2 つ以上ならセット） */
export const unitsOf = (menu: MenuEntity) =>
  menu.items.reduce((sum, { quantity }) => sum + quantity, 0);

/** 種類の名前 → 表示名（DB の種類）。メニューに出てこない種類は名前のまま */
export const typeLabelsOf = (menus: MenuEntity[]) => {
  const labels = new Map<string, string>();
  for (const menu of menus)
    for (const { item } of menu.items)
      labels.set(item.item_type.name, item.item_type.display_name);
  return (type: string) => labels.get(type) ?? type;
};

const pct = (x: number) => `${x.toFixed(1)}%`;

const numberInput =
  "h-9 w-20 rounded-md border px-2 text-right disabled:bg-stone-100";

type Props = {
  params: GeneratorParams;
  menus: WithId<MenuEntity>[];
  plan: MenuPlan;
  onChange: (plan: MenuPlan) => void;
  disabled: boolean;
};

/**
 * 種類ごとの割合と、種類の中のメニューの割合を決める。
 * どのメニューがどの種類かは DB のアイテムの種類で決まるので、ここでは選ばない。
 */
export const MenuPlanEditor = ({
  params,
  menus,
  plan,
  onChange,
  disabled,
}: Props) => {
  const year = latestYear(params);
  const past = useMemo(
    () => (year ? pastTypeShares(params, year) : null),
    [params, year],
  );
  const labelOf = typeLabelsOf(menus);

  // 過去に出た種類（去年よく出た順）のあとに、今年のメニューにだけある種類
  const typed = menus.map((menu) => ({ menu, type: menuType(menu) }));
  const pastOrder = pastTypes(params);
  const types = [
    ...pastOrder,
    ...[...new Set(typed.map((t) => t.type))]
      .filter((type): type is string => !!type && !pastOrder.includes(type))
      .sort(),
  ];
  const untyped = typed.filter((t) => t.type === null).map((t) => t.menu);

  const shareTotal = types.reduce(
    (sum, type) => sum + (plan.typeShares[type] ?? 0),
    0,
  );

  const setTypeShare = (type: string, value: number) =>
    onChange({
      ...plan,
      typeShares: { ...plan.typeShares, [type]: Math.max(0, value) },
    });
  const setWeight = (id: string, weight: number) =>
    onChange({
      ...plan,
      weights: { ...plan.weights, [id]: Math.max(0, weight) },
    });

  const exportPlan = () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rehearsal-menu-plan.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importPlan = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as MenuPlan;
      if (parsed?.version !== 2 || typeof parsed.weights !== "object") {
        alert("割合の形ではありません");
        return;
      }
      // 今のメニューに無い id は捨てる
      const known = new Set(menus.map((m) => m.id));
      onChange({
        version: 2,
        typeShares: parsed.typeShares ?? {},
        weights: Object.fromEntries(
          Object.entries(parsed.weights).filter(([id]) => known.has(id)),
        ),
      });
    } catch {
      alert("JSON として読めませんでした");
    }
  };

  return (
    <details className="rounded-lg border p-4" open={!disabled}>
      <summary className="cursor-pointer font-bold">
        出す割合（今年のメニュー {menus.length} 件）
      </summary>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={disabled || !year}
          onClick={() =>
            onChange({ ...plan, typeShares: initialPlan(params).typeShares })
          }
        >
          種類の割合を去年にそろえる（{year ?? "—"} 年）
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange({ ...plan, weights: {} })}
        >
          種類の中を等分にする
        </Button>
        <Button size="sm" variant="outline" onClick={exportPlan}>
          割合を書き出す
        </Button>
        <label
          className={cn(
            "text-sm",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          読み込む
          <input
            type="file"
            accept="application/json,.json"
            className="ml-2 text-sm"
            disabled={disabled}
            onChange={(e) => importPlan(e.target.files?.[0])}
          />
        </label>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        メニューの種類は、商品管理でアイテムに付けた種類で決まります（物販の付いたセットはドリンクの種類で
        1 個ぶん）。割合は足して 100
        にならなくても比で使います。種類の中の割合は、決めていなければ等分です。この画面で決めた割合はこの端末に覚えておきます。
      </p>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-stone-600">
            <th className="py-1">種類 / メニュー</th>
            <th className="py-1 text-right">去年</th>
            <th className="py-1 text-right">今回</th>
            <th className="py-1 pl-4">去年の内訳</th>
          </tr>
        </thead>
        {types.map((type) => {
          const rows = typed.filter((t) => t.type === type).map((t) => t.menu);
          const weightTotal = rows.reduce(
            (sum, menu) => sum + weightOf(plan, menu.id),
            0,
          );
          const share = plan.typeShares[type] ?? 0;
          return (
            <tbody key={type} className="border-b">
              <tr className="align-top">
                <td className="py-1 font-bold">
                  {labelOf(type)}
                  {rows.length === 0 && share > 0 && (
                    <span className="ml-2 font-normal text-amber-700 text-xs">
                      今年のメニューに無いので、種類の名前のまま出ます
                    </span>
                  )}
                </td>
                <td className="py-1 text-right text-stone-600">
                  {past ? pct(past[type] ?? 0) : "—"}
                </td>
                <td className="py-1 text-right">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className={numberInput}
                    value={Number(share.toFixed(1))}
                    disabled={disabled}
                    onChange={(e) => setTypeShare(type, Number(e.target.value))}
                  />
                  {shareTotal > 0 &&
                    Math.abs(shareTotal - 100) > 0.05 &&
                    share > 0 && (
                      <div className="text-stone-500 text-xs">
                        実際は {pct((100 * share) / shareTotal)}
                      </div>
                    )}
                  {!pastOrder.includes(type) && (
                    <div className="text-stone-500 text-xs">
                      過去の注文に無い種類は出せません
                    </div>
                  )}
                </td>
                <td className="py-1 pl-4 text-stone-600">
                  {year &&
                    pastItemShares(params, year, type)
                      .map(({ name, share }) => `${name} ${share.toFixed(0)}%`)
                      .join("、")}
                </td>
              </tr>
              {rows.map((menu) => {
                const weight = weightOf(plan, menu.id);
                return (
                  <tr key={menu.id} className="align-top">
                    <td className="py-1 pl-4">
                      {menu.name}
                      {unitsOf(menu) > 1 && (
                        <span className="ml-2 rounded bg-amber-100 px-1 text-amber-900 text-xs">
                          セット
                        </span>
                      )}
                      <span className="ml-2 text-stone-500">
                        ￥{menu.price}
                      </span>
                    </td>
                    <td />
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className={numberInput}
                        value={Number(weight.toFixed(1))}
                        disabled={disabled}
                        onChange={(e) =>
                          setWeight(menu.id, Number(e.target.value))
                        }
                      />
                      {weightTotal > 0 && (
                        <div className="text-stone-500 text-xs">
                          {weight > 0
                            ? `種類の中で ${pct((100 * weight) / weightTotal)}`
                            : "出さない"}
                        </div>
                      )}
                    </td>
                    <td />
                  </tr>
                );
              })}
            </tbody>
          );
        })}
        <tfoot>
          <tr>
            <td className="py-1">合計</td>
            <td />
            <td
              className={cn(
                "py-1 text-right",
                Math.abs(shareTotal - 100) > 0.05 && "text-amber-700",
              )}
            >
              {pct(shareTotal)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      {untyped.length > 0 && (
        <p className="mt-3 text-sm text-stone-600">
          オペ練では出ないメニュー（2 杯以上のセットなど）：
          {untyped.map((menu) => menu.name).join("、")}
        </p>
      )}
    </details>
  );
};
