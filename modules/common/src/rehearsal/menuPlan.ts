// 生成器が出す役割カテゴリ（「シングルオリジン × 1」）を、今年のメニューに置き換える。
//
// 割り当ては 2 段で決める。
//
// * 分類ごとの割合：ドリンク全体のうち、その分類が何 % か。去年と変えると、過去の注文の組の
//   重みを付け直して、生成される杯数の割合をそこに合わせる（`reweightBaskets()`）
// * 分類の中の割合：その分類の 1 杯を、今年のどのメニューにするか。セットのメニューもここに入れる
//
// 今年のメニューの key は変わりうるので、去年との対応は名前で取る（`matchPastItem()`）。

import type { GeneratedOrder, Rng } from "./generator";
import type { Basket, GeneratorParams, PastItem } from "./params";
import { GOODS_ROLE } from "./roles";

/** 画面に並べるドリンクの分類（去年よく出た順） */
export const DRINK_ROLES = [
  "signature_blend",
  "house_blend",
  "ice_ore",
  "single_origin",
  "ice_coffee",
  "premium",
  "ice_milk",
  "hot_ore",
] as const;

/** 割り当てに出てくる分類（ドリンク + 物販） */
export const PLAN_ROLES = [...DRINK_ROLES, GOODS_ROLE] as const;

export type MenuAssignment = {
  /** 分類。null は「出さない」 */
  role: string | null;
  /** 分類の中の割合（%）。分類の中で足して 100 にならなくても、比で使う */
  weight: number;
};

export type MenuPlan = {
  version: 1;
  /** ドリンクの分類ごとの割合（%）。足して 100 にならなくても、比で使う */
  roleShares: Record<string, number>;
  /** メニューの id → 割り当て */
  menus: Record<string, MenuAssignment>;
};

/** 割り当ての対象になるメニュー（API のメニューのうち使う項目だけ） */
export type PlanMenu = { id: string; name: string };

const normalize = (name: string) => name.normalize("NFKC").replace(/\s+/g, "");

/** 過去のデータに入っている年のうち、いちばん新しい年（"2025" など） */
export const latestYear = (params: GeneratorParams) =>
  params.items
    .flatMap((item) => Object.keys(item.counts))
    .sort()
    .at(-1) ?? null;

/** その年のドリンクの分類ごとの割合（%） */
export const pastRoleShares = (params: GeneratorParams, year: string) => {
  const cups: Record<string, number> = {};
  for (const item of params.items) {
    if (item.role === GOODS_ROLE) continue;
    cups[item.role] = (cups[item.role] ?? 0) + (item.counts[year] ?? 0);
  }
  const total = Object.values(cups).reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    DRINK_ROLES.map((role) => [
      role,
      total > 0 ? (100 * (cups[role] ?? 0)) / total : 0,
    ]),
  ) as Record<string, number>;
};

/** その年の、分類の中での商品ごとの割合（%）。多い順 */
export const pastItemShares = (
  params: GeneratorParams,
  year: string,
  role: string,
) => {
  const rows = params.items
    .filter((item) => item.role === role && (item.counts[year] ?? 0) > 0)
    .map((item) => ({ item, count: item.counts[year] ?? 0 }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows
    .map(({ item, count }) => ({ item, count, share: (100 * count) / total }))
    .sort((a, b) => b.count - a.count);
};

/** 今年のメニューと名前が同じ過去の商品。いちばん新しい年に出たものを優先する */
export const matchPastItem = (
  params: GeneratorParams,
  menuName: string,
): PastItem | null => {
  const name = normalize(menuName);
  const hits = params.items.filter((item) => normalize(item.name) === name);
  const newest = (item: PastItem) =>
    Object.keys(item.counts).sort().at(-1) ?? "";
  return hits.sort((a, b) => newest(b).localeCompare(newest(a)))[0] ?? null;
};

/** 割り当てが無いときの最初の形。名前が去年の商品と同じメニューだけ、その分類に入れる */
export const initialPlan = (
  params: GeneratorParams,
  menus: PlanMenu[],
): MenuPlan =>
  lastYearPlan(params, menus, {
    version: 1,
    roleShares: {},
    menus: Object.fromEntries(
      menus.map((menu) => [
        menu.id,
        { role: matchPastItem(params, menu.name)?.role ?? null, weight: 0 },
      ]),
    ),
  });

/**
 * 「去年と同じ割合」。分類ごとの割合を去年にそろえ、分類の中の割合も去年に寄せる。
 *
 * * 名前が去年の商品と同じメニューは、その商品の去年の割合
 * * 去年の商品に当たらないメニュー（新メニューやセット）は、今年メニューが無くなった去年の
 *   商品のぶんを等分する
 * * それで 0 になる分類は等分する
 *
 * どの分類に入れるかは `current` のまま変えない。
 */
export const lastYearPlan = (
  params: GeneratorParams,
  menus: PlanMenu[],
  current: MenuPlan,
): MenuPlan => {
  const year = latestYear(params);
  if (year === null) return current;

  const next: MenuPlan = {
    version: 1,
    roleShares: pastRoleShares(params, year),
    menus: { ...current.menus },
  };
  for (const role of PLAN_ROLES) {
    const assigned = menus.filter(
      (menu) => current.menus[menu.id]?.role === role,
    );
    if (assigned.length === 0) continue;

    const past = pastItemShares(params, year, role);
    const matched = new Map<string, number>();
    for (const menu of assigned) {
      const item = matchPastItem(params, menu.name);
      const row = past.find((p) => item !== null && p.item.id === item.id);
      if (row) matched.set(menu.id, row.share);
    }
    const usedIds = new Set(
      assigned
        .map((menu) => matchPastItem(params, menu.name)?.id)
        .filter(Boolean),
    );
    const leftover = past
      .filter((p) => !usedIds.has(p.item.id))
      .reduce((a, p) => a + p.share, 0);
    const unmatched = assigned.filter((menu) => !matched.has(menu.id));

    for (const menu of assigned) {
      const weight =
        matched.get(menu.id) ??
        (unmatched.length > 0 ? leftover / unmatched.length : 0);
      next.menus[menu.id] = { role, weight };
    }
    const total = assigned.reduce(
      (sum, menu) => sum + next.menus[menu.id].weight,
      0,
    );
    if (total === 0) {
      for (const menu of assigned)
        next.menus[menu.id] = { role, weight: 100 / assigned.length };
    }
  }
  return next;
};

/** 分類の中の割合を等分する */
export const evenPlan = (plan: MenuPlan): MenuPlan => {
  const counts: Record<string, number> = {};
  for (const a of Object.values(plan.menus)) {
    if (a.role) counts[a.role] = (counts[a.role] ?? 0) + 1;
  }
  return {
    ...plan,
    menus: Object.fromEntries(
      Object.entries(plan.menus).map(([id, a]) => [
        id,
        { ...a, weight: a.role ? 100 / counts[a.role] : 0 },
      ]),
    ),
  };
};

/** 割合が 0 より大きいのに、メニューが 1 つも割り当たっていないドリンクの分類 */
export const unassignedRoles = (plan: MenuPlan) =>
  DRINK_ROLES.filter(
    (role) =>
      (plan.roleShares[role] ?? 0) > 0 &&
      !Object.values(plan.menus).some((a) => a.role === role && a.weight > 0),
  );

const cupsOf = (basket: Basket) =>
  Object.values(basket.roles).reduce((a, b) => a + b, 0);

/** 重みの付いた注文の組から、ドリンクの分類ごとの杯数の割合（合計 1） */
export const roleSharesOf = (baskets: Basket[]) => {
  const cups: Record<string, number> = {};
  let total = 0;
  for (const basket of baskets) {
    for (const [role, n] of Object.entries(basket.roles)) {
      cups[role] = (cups[role] ?? 0) + n * basket.weight;
      total += n * basket.weight;
    }
  }
  return Object.fromEntries(
    Object.entries(cups).map(([role, n]) => [role, n / total]),
  );
};

/**
 * 注文の組の重みを付け直して、ドリンクの分類ごとの杯数の割合を `targetShares` に合わせる。
 *
 * 注文は丸ごと引くまま（「同じものを人数分」の組を壊さない）で、どの組がどれだけ出るかだけを
 * 変える。各組の重みに `Π (目標 / いまの割合)^(その分類の杯数 / 組の杯数)` を掛けるのを繰り返す。
 * 割合 0 の分類を含む組は出なくなる。物販だけの注文の重みは変えない。
 *
 * 過去の組に無い分類の割合を上げることはできない（その分類が出る組が無いため）。
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
  const target = (role: string) => Math.max(targetShares[role] ?? 0, 0) / total;

  const drinkTotal = baskets
    .filter((b) => cupsOf(b) > 0)
    .reduce((a, b) => a + b.weight, 0);
  let current = baskets.map((b) => ({ ...b }));
  for (let i = 0; i < iterations; i++) {
    const shares = roleSharesOf(current);
    current = current.map((basket) => {
      const cups = cupsOf(basket);
      if (cups === 0) return basket;
      let factor = 1;
      for (const [role, n] of Object.entries(basket.roles)) {
        const now = shares[role] ?? 0;
        factor *= now > 0 ? (target(role) / now) ** (n / cups) : 0;
      }
      return { ...basket, weight: basket.weight * factor };
    });
    // ドリンクのある注文の重みの合計は元のまま（物販だけの注文との比を変えない）
    const sum = current
      .filter((b) => cupsOf(b) > 0)
      .reduce((a, b) => a + b.weight, 0);
    if (sum === 0) return baskets;
    current = current.map((b) =>
      cupsOf(b) > 0 ? { ...b, weight: (b.weight * drinkTotal) / sum } : b,
    );
  }
  return current;
};

/** 画面に出す注文 1 件の中身。メニューが割り当たっていない分類は `menuId` が null */
export type PlannedLine = {
  menuId: string | null;
  role: string;
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
 * 生成した注文の杯・物販を、1 つずつ今年のメニューに置き換える。同じメニューはまとめる。
 * 分類の中のメニューは 1 杯ごとに独立に引く（「シングル × 2」が別の豆になることもある）。
 */
export const planOrder = (
  order: GeneratedOrder,
  plan: MenuPlan,
  rng: Rng,
): PlannedLine[] => {
  const byRole = new Map<string, { value: string; weight: number }[]>();
  for (const [id, a] of Object.entries(plan.menus)) {
    if (!a.role || a.weight <= 0) continue;
    byRole.set(a.role, [
      ...(byRole.get(a.role) ?? []),
      { value: id, weight: a.weight },
    ]);
  }

  const lines = new Map<string, PlannedLine>();
  const add = (role: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const menuId = pickWeighted(rng, byRole.get(role) ?? []);
      const key = menuId ?? `role:${role}`;
      const line = lines.get(key) ?? { menuId, role, count: 0 };
      line.count += 1;
      lines.set(key, line);
    }
  };
  for (const role of Object.keys(order.roles).sort())
    add(role, order.roles[role]);
  add(GOODS_ROLE, order.goods);
  return [...lines.values()];
};
