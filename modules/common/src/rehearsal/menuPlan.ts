// 生成器が出す種類ごとの個数（「hot × 2」）を、今年のメニューに置き換える。
//
// どのメニューがどの種類かは POS の DB から決める：メニューに入っているアイテムの種類の名前
// （item_types.name）が、過去の注文に入っている種類と同じものになる（`menuType()`）。
// 対応表や名前合わせは持たない。
//
// 割合は 2 段で、どちらもオペ練の画面で決める（DB には持たない）。
//
// * 種類ごとの割合：全体のうち、その種類が何 % か。去年と変えると、過去の注文の組の
//   重みを付け直して、生成される個数の割合をそこに合わせる（`reweightBaskets()`）
// * 種類の中の割合：その種類の 1 個を、今年のどのメニューにするか。決めていなければ等分

import type { GeneratedOrder, Rng } from "./generator";
import type { Basket, GeneratorParams } from "./params";

export type MenuPlan = {
  version: 2;
  /** 種類の名前 → 割合（%）。足して 100 にならなくても、比で使う */
  typeShares: Record<string, number>;
  /** メニューの id → 種類の中の割合。無いメニューは `DEFAULT_WEIGHT`（等分）。0 で出さない */
  weights: Record<string, number>;
};

/** 種類の中の割合を決めていないメニューの重み。同じ種類のメニューで等分になる */
export const DEFAULT_WEIGHT = 1;

/** 置き換えに使うメニュー（API のメニューのうち使う項目だけ） */
export type PlanMenu = {
  id: string;
  name: string;
  items: {
    quantity: number;
    item: { item_type: { name: string; makes_cup: boolean } };
  }[];
};

const units = (items: PlanMenu["items"]) =>
  items.reduce((sum, { quantity }) => sum + quantity, 0);

/**
 * メニューが 1 個ぶんとして出る種類。
 *
 * * カップを作るアイテムがちょうど 1 杯 → その種類（物販が付いたセットもここ）
 * * カップを作るアイテムが無く、全部で 1 個 → その種類（物販）
 * * それ以外（2 杯以上のセットなど）→ null。オペ練では出さない
 */
export const menuType = (menu: PlanMenu): string | null => {
  const cups = menu.items.filter(({ item }) => item.item_type.makes_cup);
  if (units(cups) === 1) return cups[0].item.item_type.name;
  if (cups.length === 0 && units(menu.items) === 1)
    return menu.items[0].item.item_type.name;
  return null;
};

/** セットに入っている物販（カップを作らないアイテム）の種類ごとの個数 */
export const goodsInMenu = (menu: PlanMenu): Record<string, number> => {
  if (!menu.items.some(({ item }) => item.item_type.makes_cup)) return {};
  const goods: Record<string, number> = {};
  for (const { item, quantity } of menu.items) {
    if (item.item_type.makes_cup) continue;
    goods[item.item_type.name] = (goods[item.item_type.name] ?? 0) + quantity;
  }
  return goods;
};

export const weightOf = (plan: MenuPlan, menuId: string) =>
  Math.max(plan.weights[menuId] ?? DEFAULT_WEIGHT, 0);

/** 過去のデータに入っている年のうち、いちばん新しい年（"2025" など） */
export const latestYear = (params: GeneratorParams) =>
  params.items
    .flatMap((item) => Object.keys(item.counts))
    .sort()
    .at(-1) ?? null;

/** 過去のデータに出てくる種類（去年よく出た順。同じなら名前順） */
export const pastTypes = (params: GeneratorParams) => {
  const year = latestYear(params);
  const shares = year ? pastTypeShares(params, year) : {};
  return [...new Set(params.items.map((item) => item.type))].sort(
    (a, b) => (shares[b] ?? 0) - (shares[a] ?? 0) || a.localeCompare(b),
  );
};

/** その年の種類ごとの割合（%） */
export const pastTypeShares = (params: GeneratorParams, year: string) => {
  const counts: Record<string, number> = {};
  for (const item of params.items) {
    counts[item.type] = (counts[item.type] ?? 0) + (item.counts[year] ?? 0);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    Object.entries(counts).map(([type, n]) => [
      type,
      total > 0 ? (100 * n) / total : 0,
    ]),
  ) as Record<string, number>;
};

/** その年の、種類の中での過去の商品ごとの割合（%）。多い順。画面で去年の内訳として見せるだけ */
export const pastItemShares = (
  params: GeneratorParams,
  year: string,
  type: string,
) => {
  const rows = params.items
    .filter((item) => item.type === type && (item.counts[year] ?? 0) > 0)
    .map((item) => ({ name: item.name, count: item.counts[year] ?? 0 }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows
    .map((row) => ({ ...row, share: (100 * row.count) / total }))
    .sort((a, b) => b.count - a.count);
};

/** 最初の形：種類ごとの割合は去年のまま、種類の中は等分 */
export const initialPlan = (params: GeneratorParams): MenuPlan => {
  const year = latestYear(params);
  return {
    version: 2,
    typeShares: year ? pastTypeShares(params, year) : {},
    weights: {},
  };
};

/** 割合が 0 より大きいのに、出せるメニューが 1 つも無い種類 */
export const unassignedTypes = (plan: MenuPlan, menus: PlanMenu[]) =>
  Object.keys(plan.typeShares)
    .filter((type) => (plan.typeShares[type] ?? 0) > 0)
    .filter(
      (type) =>
        !menus.some(
          (menu) => menuType(menu) === type && weightOf(plan, menu.id) > 0,
        ),
    )
    .sort();

const unitsOfBasket = (basket: Basket) =>
  Object.values(basket.types).reduce((a, b) => a + b, 0);

/** 重みの付いた注文の組から、種類ごとの個数の割合（合計 1） */
export const typeSharesOf = (baskets: Basket[]) => {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const basket of baskets) {
    for (const [type, n] of Object.entries(basket.types)) {
      counts[type] = (counts[type] ?? 0) + n * basket.weight;
      total += n * basket.weight;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).map(([type, n]) => [type, n / total]),
  );
};

/**
 * 注文の組の重みを付け直して、種類ごとの個数の割合を `targetShares` に合わせる。
 *
 * 注文は丸ごと引くまま（「同じものを人数分」の組を壊さない）で、どの組がどれだけ出るかだけを
 * 変える。各組の重みに `Π (目標 / いまの割合)^(その種類の個数 / 組の個数)` を掛けるのを繰り返す。
 * 割合 0 の種類を含む組は出なくなる。重みの合計は元のまま。
 *
 * 過去の組に無い種類の割合を上げることはできない（その種類が出る組が無いため）。
 */
export const reweightBaskets = (
  baskets: Basket[],
  targetShares: Record<string, number>,
  iterations = 300,
): Basket[] => {
  const total = Object.values(targetShares).reduce(
    (a, b) => a + Math.max(b, 0),
    0,
  );
  if (total <= 0) return baskets;
  const target = (type: string) => Math.max(targetShares[type] ?? 0, 0) / total;

  const weightTotal = baskets.reduce((a, b) => a + b.weight, 0);
  let current = baskets.map((b) => ({ ...b }));
  for (let i = 0; i < iterations; i++) {
    const shares = typeSharesOf(current);
    current = current.map((basket) => {
      const n = unitsOfBasket(basket);
      if (n === 0) return basket;
      let factor = 1;
      for (const [type, count] of Object.entries(basket.types)) {
        const now = shares[type] ?? 0;
        factor *= now > 0 ? (target(type) / now) ** (count / n) : 0;
      }
      return { ...basket, weight: basket.weight * factor };
    });
    const sum = current.reduce((a, b) => a + b.weight, 0);
    if (sum === 0) return baskets;
    current = current.map((b) => ({
      ...b,
      weight: (b.weight * weightTotal) / sum,
    }));
  }
  return current;
};

/** 画面に出す注文 1 件の中身。出せるメニューが無い種類は `menuId` が null */
export type PlannedLine = {
  menuId: string | null;
  type: string;
  count: number;
};

const pickWeighted = <T>(
  rng: Rng,
  entries: { value: T; weight: number }[],
): T | null => {
  const total = entries.reduce((a, e) => a + e.weight, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const entry of entries) {
    r -= entry.weight;
    if (r < 0) return entry.value;
  }
  return entries[entries.length - 1].value;
};

/**
 * 生成した注文の 1 個ずつを、今年のメニューに置き換える。同じメニューはまとめる。
 * 種類の中のメニューは 1 個ごとに独立に引く（「hot × 2」が別の豆になることもある）。
 *
 * 物販の付いたセットを引いたら、その物販のぶん注文の物販を減らす（過去の注文ではセットの物販も
 * 物販として数えているため）。そのためにセットに入りうる物販の種類は最後に置き換える。
 */
export const planOrder = (
  order: GeneratedOrder,
  plan: MenuPlan,
  menus: PlanMenu[],
  rng: Rng,
): PlannedLine[] => {
  const byType = new Map<string, { value: PlanMenu; weight: number }[]>();
  for (const menu of menus) {
    const type = menuType(menu);
    const weight = weightOf(plan, menu.id);
    if (!type || weight <= 0) continue;
    byType.set(type, [...(byType.get(type) ?? []), { value: menu, weight }]);
  }
  const setGoods = new Set(
    menus.flatMap((menu) => Object.keys(goodsInMenu(menu))),
  );

  const lines = new Map<string, PlannedLine>();
  const included: Record<string, number> = {};
  const add = (type: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const menu = pickWeighted(rng, byType.get(type) ?? []);
      const key = menu?.id ?? `type:${type}`;
      const line = lines.get(key) ?? {
        menuId: menu?.id ?? null,
        type,
        count: 0,
      };
      line.count += 1;
      lines.set(key, line);
      if (!menu) continue;
      for (const [goods, count] of Object.entries(goodsInMenu(menu)))
        included[goods] = (included[goods] ?? 0) + count;
    }
  };
  const types = Object.keys(order.types).sort();
  for (const type of types.filter((t) => !setGoods.has(t)))
    add(type, order.types[type]);
  for (const type of types.filter((t) => setGoods.has(t)))
    add(type, Math.max(order.types[type] - (included[type] ?? 0), 0));
  return [...lines.values()];
};
