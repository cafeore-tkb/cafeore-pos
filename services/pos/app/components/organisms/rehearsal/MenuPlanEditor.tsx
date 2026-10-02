import {
  DRINK_ROLES,
  type GeneratorParams,
  type MenuEntity,
  type MenuPlan,
  PLAN_ROLES,
  ROLE_LABELS,
  type WithId,
  evenPlan,
  lastYearPlan,
  latestYear,
  matchPastItem,
  pastItemShares,
  pastRoleShares,
} from "@cafeore/common";
import { useMemo } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** メニューに入っている品目の数（2 つ以上ならセット） */
export const unitsOf = (menu: MenuEntity) =>
  menu.items.reduce((sum, { quantity }) => sum + quantity, 0);

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
 * 生成器の分類（役割カテゴリ）を今年のメニューに割り当てる。
 * 分類ごとの割合と、分類の中の割合の 2 段で決める。
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
    () => (year ? pastRoleShares(params, year) : null),
    [params, year],
  );
  const shareTotal = DRINK_ROLES.reduce(
    (sum, role) => sum + (plan.roleShares[role] ?? 0),
    0,
  );

  const planMenus = menus.map((menu) => ({ id: menu.id, name: menu.name }));
  const roleOrder = (role: string | null) =>
    role === null
      ? PLAN_ROLES.length
      : (PLAN_ROLES as readonly string[]).indexOf(role);
  const sortedMenus = [...menus].sort(
    (a, b) =>
      roleOrder(plan.menus[a.id]?.role ?? null) -
        roleOrder(plan.menus[b.id]?.role ?? null) ||
      a.name.localeCompare(b.name, "ja"),
  );
  const roleWeightTotal = (role: string) =>
    Object.values(plan.menus)
      .filter((a) => a.role === role)
      .reduce((sum, a) => sum + a.weight, 0);

  const setRoleShare = (role: string, value: number) =>
    onChange({
      ...plan,
      roleShares: { ...plan.roleShares, [role]: Math.max(0, value) },
    });
  const setMenu = (id: string, role: string | null, weight: number) =>
    onChange({
      ...plan,
      menus: { ...plan.menus, [id]: { role, weight: Math.max(0, weight) } },
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
      if (parsed?.version !== 1 || typeof parsed.menus !== "object") {
        alert("メニューの割り当ての形ではありません");
        return;
      }
      // 今のメニューに無い id は捨てる
      const known = new Set(menus.map((m) => m.id));
      onChange({
        version: 1,
        roleShares: parsed.roleShares ?? {},
        menus: {
          ...plan.menus,
          ...Object.fromEntries(
            Object.entries(parsed.menus).filter(([id]) => known.has(id)),
          ),
        },
      });
    } catch {
      alert("JSON として読めませんでした");
    }
  };

  return (
    <details className="rounded-lg border p-4" open={!disabled}>
      <summary className="cursor-pointer font-bold">
        メニューの割り当て（今年のメニュー {menus.length} 件）
      </summary>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={disabled || !year}
          onClick={() => onChange(lastYearPlan(params, planMenus, plan))}
        >
          去年と同じ割合（{year ?? "—"} 年）
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange(evenPlan(plan))}
        >
          分類の中を均等にする
        </Button>
        <Button size="sm" variant="outline" onClick={exportPlan}>
          割り当てを書き出す
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
        「去年と同じ割合」は、名前が去年の商品と同じメニューにその商品の割合を入れ、名前が当たらないメニュー（新メニューやセット）には、今年なくなった商品のぶんを等分します。割合は足して
        100 にならなくても、比で使います。
      </p>

      <h3 className="mt-4 font-bold">分類ごとの割合（ドリンクの杯数）</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-stone-600">
            <th className="py-1">分類</th>
            <th className="py-1 text-right">去年</th>
            <th className="py-1 text-right">今回</th>
            <th className="py-1 pl-4">去年の内訳</th>
          </tr>
        </thead>
        <tbody>
          {DRINK_ROLES.map((role) => (
            <tr key={role} className="border-b align-top">
              <td className="py-1">{ROLE_LABELS[role]}</td>
              <td className="py-1 text-right text-stone-600">
                {past ? pct(past[role]) : "—"}
              </td>
              <td className="py-1 text-right">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className={numberInput}
                  value={Number((plan.roleShares[role] ?? 0).toFixed(1))}
                  disabled={disabled}
                  onChange={(e) => setRoleShare(role, Number(e.target.value))}
                />
                {shareTotal > 0 &&
                  Math.abs(shareTotal - 100) > 0.05 &&
                  (plan.roleShares[role] ?? 0) > 0 && (
                    <div className="text-stone-500 text-xs">
                      実際は{" "}
                      {pct((100 * (plan.roleShares[role] ?? 0)) / shareTotal)}
                    </div>
                  )}
              </td>
              <td className="py-1 pl-4 text-stone-600">
                {year &&
                  pastItemShares(params, year, role)
                    .map(
                      ({ item, share }) => `${item.name} ${share.toFixed(0)}%`,
                    )
                    .join("、")}
              </td>
            </tr>
          ))}
        </tbody>
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

      <h3 className="mt-4 font-bold">今年のメニュー</h3>
      <p className="text-sm text-stone-600">
        分類を選び、分類の中の割合を入れてください。セットのメニューも、そのドリンクの分類に入れれば出ます（1
        杯ぶんとして出ます）。
      </p>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-stone-600">
            <th className="py-1">メニュー</th>
            <th className="py-1">分類</th>
            <th className="py-1 text-right">分類の中の割合</th>
          </tr>
        </thead>
        <tbody>
          {sortedMenus.map((menu) => {
            const assigned = plan.menus[menu.id] ?? { role: null, weight: 0 };
            const past = matchPastItem(params, menu.name);
            const total = assigned.role ? roleWeightTotal(assigned.role) : 0;
            return (
              <tr key={menu.id} className="border-b align-top">
                <td className="py-1">
                  <span className="font-bold">{menu.name}</span>
                  {unitsOf(menu) > 1 && (
                    <span className="ml-2 rounded bg-amber-100 px-1 text-amber-900 text-xs">
                      セット
                    </span>
                  )}
                  <span className="ml-2 text-stone-500">￥{menu.price}</span>
                  <div className="text-stone-500 text-xs">
                    {menu.items
                      .map(({ item, quantity }) => `${item.name} × ${quantity}`)
                      .join("、")}
                    {past && `（去年の「${past.name}」）`}
                  </div>
                </td>
                <td className="py-1">
                  <select
                    className="h-9 rounded-md border px-2 disabled:bg-stone-100"
                    value={assigned.role ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      setMenu(menu.id, e.target.value || null, assigned.weight)
                    }
                  >
                    <option value="">出さない</option>
                    {PLAN_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 text-right">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={numberInput}
                    value={Number(assigned.weight.toFixed(1))}
                    disabled={disabled || !assigned.role}
                    onChange={(e) =>
                      setMenu(menu.id, assigned.role, Number(e.target.value))
                    }
                  />
                  {assigned.role && total > 0 && (
                    <div className="text-stone-500 text-xs">
                      実際は {pct((100 * assigned.weight) / total)}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
};
