import type { Cup } from "../models/cup";
import type { ItemType } from "../models/item";
import {
  CAOS_DRIPPERS,
  CAOS_MAX_CUPS,
  type CaosCupsWrite,
  type CaosOrderInput,
  cupNeedsBrew,
} from "./caos-board";
import { type CaosLane, isSeniorLane } from "./caosLanes";
import type { PracticeDataItem, PracticeDataOrder } from "./caosPracticeData";

// CaOS の実データテスト（練習）の盤面。ブラウザの中だけで動かし、サーバー・本番の盤面・注文・在庫には触らない。
//
// 練習の盤面は、本番と同じ形の注文とカップ（CaosOrderInput。カップに dripper・dripperPosition・dripId・
// brewStartedAt・brewFinishedAt を持つ）で持つ。カードの組み立て（buildCaosCards）と、割当・移動・未割当に戻す・統合の
// 書き込み（assignWrites・unassignWrites・mergeWrites）は本番と同じ ./caos-board の関数を使い、
// 本番ならサーバーがする「書き込みを当てる」と「次へ」だけをここで同じ決まりで行う
// （api/internal/handlers/caos.go の writeCups・advance と caos_lanes.go の限定の確かめと、同じ確かめ方・同じ理由の文。
// サーバーを使わずに練習するため、わざと 2 か所に持つ。決まりや文を変えるときは両方そろえること）。
//   - 指名は明細のドリッパーの番号（menus の dripper）。番号のあるカップはその番号のドリッパーにしか置けない
//   - 限定（種類の senior_only）のカップは、担当者が上級生のドリッパーにしか置けない。担当者は練習を始めたときの
//     本番の担当者の写し（lanes）。指名のドリッパーの担当者が上級生でない限定のカップは、どこにも置けない
// 時刻はサーバーの今の代わりに、練習の時計の今（now）を使う。

/** 練習の盤面の注文（本番の注文と同じく、カップに CaOS の値を持つ） */
export interface CaosPracticeOrder extends CaosOrderInput {
  cups: Cup[];
}

/** 書き込み・「次へ」の結果。断ったときは理由（画面にそのまま出す）と、変わらない注文 */
export type CaosPracticeResult =
  | { orders: CaosPracticeOrder[]; error?: undefined }
  | { orders?: undefined; error: string };

// ---------------------------------------------------------------- 実データ → 練習の注文

/** 品物の種類をどこから決めたか（db：DB の今の種類、data：データに入っていた種類の設定、default：どちらも無い） */
export type PracticeItemTypeSource = "db" | "data" | "default";

/**
 * 実データの品物の種類（カップを作るか・抽出が要るか・限定か）を決める。種類の名前で決め打ちはしない。
 *   1. DB の今の商品の種類に同じ名前（item_type の name）があれば、その設定（今の決まりで練習する）
 *   2. 無ければ、データに入っていた注文したときの種類の設定（cafeore-pos の注文のデータ）
 *   3. どちらも無い（種類の無い昔のデータ・DB に無い種類）ときは、API の列の既定値と同じ（カップを作る・抽出が要る・限定でない）。
 *      サーバーも種類の分からない商品は抽出が要るものとして扱う（caos.go の COALESCE(..., true)）
 */
export const practiceItemType = (
  item: Pick<PracticeDataItem, "type" | "itemType">,
  dbTypes: readonly ItemType[],
): { itemType: ItemType; source: PracticeItemTypeSource } => {
  const db = item.type
    ? dbTypes.find((type) => type.name === item.type)
    : undefined;
  if (db) return { itemType: db, source: "db" };
  if (item.itemType)
    return {
      itemType: {
        name: item.type,
        display_name: item.itemType.display_name || item.type,
        makes_cup: item.itemType.makes_cup,
        needs_brew: item.itemType.needs_brew,
        senior_only: item.itemType.senior_only,
      },
      source: "data",
    };
  return {
    itemType: {
      name: item.type,
      display_name: item.type || "種類なし",
      makes_cup: true,
      needs_brew: true,
      senior_only: false,
    },
    source: "default",
  };
};

/**
 * 実データの注文を、練習の盤面の注文にする。カップを作る品物（種類の makes_cup）を 1 杯ずつカップにする（POS が注文を保存したときと同じ）。
 * 指名は実データから落としてあるので、どのカップも指名なし（明細の dripper も assignee も null）。ID は練習の中だけのもの
 */
export const toCaosPracticeOrder = (
  order: PracticeDataOrder,
  index: number,
  dbTypes: readonly ItemType[],
): CaosPracticeOrder => {
  const id = `practice-${index}`;
  const cups: Cup[] = [];
  order.items.forEach((item, position) => {
    const { itemType } = practiceItemType(item, dbTypes);
    if (itemType.makes_cup === false) return;
    const cupId = `${id}-${position}`;
    cups.push({
      id: cupId,
      orderMenuId: cupId,
      item: {
        // 商品の ID（cafeore-pos のデータなら DB の商品の ID。豆・色はこれで引く）。無ければ名前で見分ける
        id: item.id || `name:${item.name}`,
        name: item.name,
        abbr: item.abbr || item.name,
        item_type: itemType,
      },
      readyAt: null,
      servedAt: null,
      dripper: null,
      dripperPosition: null,
      dripId: null,
      brewStartedAt: null,
      brewFinishedAt: null,
    });
  });
  return {
    id,
    orderId: order.orderId,
    createdAt: new Date(order.createdAt),
    menus: cups.map((cup) => ({
      orderMenuId: cup.orderMenuId,
      dripper: null,
      assignee: null,
    })),
    cups,
  };
};

// ---------------------------------------------------------------- 書き込みを当てる（PUT /api/caos/cups と同じ）

const sameMs = (a: Date | null, b: string | null) =>
  (a === null && b === null) ||
  (a !== null && b !== null && a.getTime() === Date.parse(b));

const sameBefore = (cup: Cup, before: CaosCupsWrite["before"]) =>
  cup.dripper === before.dripper &&
  cup.dripperPosition === before.dripper_position &&
  cup.dripId === before.drip_id &&
  sameMs(cup.brewStartedAt, before.brew_started_at) &&
  sameMs(cup.brewFinishedAt, before.brew_finished_at);

const sameState = (a: Cup, b: Cup) =>
  a.dripper === b.dripper &&
  a.dripperPosition === b.dripperPosition &&
  a.dripId === b.dripId &&
  (a.brewStartedAt?.getTime() ?? null) ===
    (b.brewStartedAt?.getTime() ?? null) &&
  (a.brewFinishedAt?.getTime() ?? null) ===
    (b.brewFinishedAt?.getTime() ?? null);

const validateAfter = (after: CaosCupsWrite["after"]) => {
  if (after.dripper === null) {
    if (after.dripper_position !== null || after.start_brew)
      return "ドリッパーの無いカップに順番は書けず、抽出も始められません";
    return null;
  }
  if (
    !Number.isInteger(after.dripper) ||
    after.dripper < 1 ||
    after.dripper > CAOS_DRIPPERS
  )
    return `ドリッパーは 1〜${CAOS_DRIPPERS} です`;
  if (after.drip_id === null || after.dripper_position === null)
    return "ドリッパーに置くカップには drip_id と dripper_position が要ります";
  return null;
};

const cloneOrders = (orders: readonly CaosPracticeOrder[]) =>
  orders.map((order) => ({
    ...order,
    cups: order.cups.map((cup) => ({ ...cup })),
  }));

const findCup = (orders: CaosPracticeOrder[], cupId: string) => {
  for (const order of orders) {
    const cup = order.cups.find((candidate) => candidate.id === cupId);
    if (cup) return { order, cup };
  }
  return null;
};

// カップを含む明細の指名のドリッパーの番号（無指名は null。サーバーの menuDripper）
const menuDripperOf = (order: CaosPracticeOrder, cup: Cup) =>
  order.menus.find((menu) => menu.orderMenuId === cup.orderMenuId)?.dripper ??
  null;

// 限定のカップか（抽出が要り、種類の senior_only。サーバーの models.ItemType.SeniorOnlyBrew と同じ）
const seniorOnlyCup = (cup: Cup) =>
  cupNeedsBrew(cup) && cup.item.item_type.senior_only === true;

// カップをほかのドリッパーへ置く（未割当から置く・ドリッパーを移す）書き込みか（サーバーの caosMovesTo）。
// 同じドリッパーの中の順番の入れ替えは含めない
const movesTo = (write: CaosCupsWrite) =>
  write.after.dripper !== null && write.before.dripper !== write.after.dripper;

const isReady = (cup: Cup) => cup.readyAt !== null || cup.servedAt !== null;

// そのドリッパーで抽出中のカードの数（始めていてまだ終えておらず、準備完了でないカップが残っているもの。サーバーの countBrewing）
const countBrewing = (orders: CaosPracticeOrder[], dripper: number) => {
  const brewing = new Map<string, boolean>();
  for (const order of orders) {
    for (const cup of order.cups) {
      if (
        cup.dripper !== dripper ||
        cup.dripId === null ||
        cup.brewStartedAt === null ||
        cup.brewFinishedAt !== null
      )
        continue;
      brewing.set(
        cup.dripId,
        (brewing.get(cup.dripId) ?? false) || !isReady(cup),
      );
    }
  }
  return Array.from(brewing.values()).filter(Boolean).length;
};

/**
 * 書き込み（assignWrites・unassignWrites・mergeWrites が作ったもの）を練習の盤面に当てる。全部当てるか、何も変えないか。
 * 抽出を始める書き込みの開始の時刻は now（練習の時計の今）。lanes は練習の担当者（限定のカップを置けるドリッパーを決める）
 */
export const applyCaosPracticeWrites = (
  orders: readonly CaosPracticeOrder[],
  writes: readonly CaosCupsWrite[],
  now: Date,
  lanes: readonly CaosLane[],
): CaosPracticeResult => {
  if (writes.length === 0) return { orders: [...orders] };
  const seen = new Set<string>();
  for (const write of writes) {
    if (write.cup_ids.length === 0) return { error: "cup_ids が空です" };
    const invalid = validateAfter(write.after);
    if (invalid) return { error: invalid };
    for (const id of write.cup_ids) {
      if (seen.has(id)) return { error: "同じカップを 2 回書いています" };
      seen.add(id);
    }
  }

  const next = cloneOrders(orders);
  const touched = new Set<string>();
  const brewing = new Set<number>();
  for (const write of writes) {
    const found = write.cup_ids.map((id) => findCup(next, id));
    for (const hit of found) {
      if (!hit)
        return {
          error: "カップが消えました（注文が編集・削除されたかもしれません）",
        };
      const { order, cup } = hit;
      if (!sameBefore(cup, write.before))
        return {
          error: "ほかの端末で先に変わりました。もう一度操作してください",
        };
      if (
        write.before.brew_started_at !== null ||
        write.before.brew_finished_at !== null
      )
        return { error: "抽出中・終わりのカードは動かせません" };
      if (
        (write.after.dripper !== null || write.after.drip_id !== null) &&
        !cupNeedsBrew(cup)
      )
        return {
          error: `抽出の要らないカップ（${cup.item.name}）はドリッパーに置けません`,
        };
      if (write.after.dripper !== null) {
        // 指名は明細のドリッパーの番号（dripper）。自由記述（assignee）だけの古い明細は指名なし
        const n = menuDripperOf(order, cup);
        if (n !== null && n !== write.after.dripper)
          return {
            error: `指名のあるカップは ${n} 番のドリッパーにしか置けません`,
          };
      }
      if (
        write.after.dripper !== null &&
        movesTo(write) &&
        seniorOnlyCup(cup) &&
        !isSeniorLane(lanes, write.after.dripper)
      )
        return {
          error: `限定のカップ（${cup.item.name}）は上級生のドリッパーにしか置けません（${write.after.dripper} 番のドリッパーの担当者は上級生ではありません）`,
        };
    }
    for (const hit of found) {
      if (!hit) continue;
      hit.cup.dripper = write.after.dripper;
      hit.cup.dripperPosition = write.after.dripper_position;
      hit.cup.dripId = write.after.drip_id;
      hit.cup.brewStartedAt = write.after.start_brew ? new Date(now) : null;
      hit.cup.brewFinishedAt = null;
    }
    if (write.after.drip_id !== null) touched.add(write.after.drip_id);
    if (write.after.start_brew && write.after.dripper !== null)
      brewing.add(write.after.dripper);
  }

  // 書いたカードの全部のカップ（書かなかったカップも含む）が同じ値で、最大 2 杯で、指名がそろっているか
  for (const dripId of touched) {
    const members = next.flatMap((order) =>
      order.cups
        .filter((cup) => cup.dripId === dripId)
        .map((cup) => ({ cup, nominated: menuDripperOf(order, cup) })),
    );
    const cups = members.map((member) => member.cup);
    if (cups.length > CAOS_MAX_CUPS)
      return { error: `1 枚のカードは ${CAOS_MAX_CUPS} 杯までです` };
    if (cups.some((cup) => !sameState(cup, cups[0])))
      return { error: "同じカードのカップは全部いっしょに動かしてください" };
    // 指名の違うカップ（無指名も 1 つの値）を同じカードにすると、どのドリッパーにも置けないカードになる（サーバーの checkCaosCardNomination）
    if (new Set(members.map((member) => member.nominated ?? 0)).size > 1)
      return { error: "指名の違うカップは同じカードにできません" };
  }
  for (const dripper of brewing) {
    if (countBrewing(next, dripper) > 1)
      return { error: `${dripper} 番のドリッパーはもう抽出中です` };
  }
  return { orders: next };
};

// ---------------------------------------------------------------- 「次へ」（POST /api/caos/drippers/{dripper}/next と同じ）

interface LaneCard {
  dripId: string;
  cups: Cup[];
  orderNo: number;
  started: boolean;
}

const compareStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 「次へ」。抽出中のカードを終え（終了の時刻を付け、そのカップだけを準備完了にする）、待機の先頭を始める。
 * seenDripId は画面が抽出中と見ているカード（無いと見ているなら null）。今と違えば断る。時刻は now（練習の時計の今）
 */
export const advanceCaosPracticeDripper = (
  orders: readonly CaosPracticeOrder[],
  dripper: number,
  seenDripId: string | null,
  now: Date,
): CaosPracticeResult => {
  if (!Number.isInteger(dripper) || dripper < 1 || dripper > CAOS_DRIPPERS)
    return { error: `ドリッパーは 1〜${CAOS_DRIPPERS} です` };
  const next = cloneOrders(orders);
  const byId = new Map<string, LaneCard>();
  for (const order of next) {
    for (const cup of order.cups) {
      if (
        cup.dripper !== dripper ||
        cup.brewFinishedAt !== null ||
        cup.dripId === null
      )
        continue;
      const card = byId.get(cup.dripId) ?? {
        dripId: cup.dripId,
        cups: [],
        orderNo: order.orderId,
        started: cup.brewStartedAt !== null,
      };
      card.cups.push(cup);
      card.orderNo = Math.min(card.orderNo, order.orderId);
      byId.set(cup.dripId, card);
    }
  }
  // 準備完了になったカード（マスターで準備完了にした）は終わりとみなす
  const open = Array.from(byId.values()).filter(
    (card) => !card.cups.every((cup) => cup.readyAt !== null),
  );
  const position = (card: LaneCard) => card.cups[0].dripperPosition ?? 0;
  const queued = open
    .filter((card) => !card.started)
    .sort(
      (a, b) =>
        position(a) - position(b) ||
        a.orderNo - b.orderNo ||
        compareStr(a.dripId, b.dripId),
    );
  const cur = open.find((card) => card.started);
  if (seenDripId !== null && (!cur || cur.dripId !== seenDripId))
    return {
      error:
        "このカードはもう終わっています（ほかの端末で「次へ」を押したかもしれません）",
    };
  if (seenDripId === null && cur)
    return { error: "抽出中のカードがあります（画面が古いかもしれません）" };
  const head = queued[0];
  if (!cur && !head)
    return { error: "このドリッパーには抽出中・待機のカードがありません" };

  for (const order of next) {
    for (const cup of order.cups) {
      if (cur && cup.dripId === cur.dripId) {
        cup.readyAt = cup.readyAt ?? new Date(now);
        cup.brewFinishedAt = new Date(now);
      }
      if (head && cup.dripId === head.dripId) cup.brewStartedAt = new Date(now);
    }
  }
  return { orders: next };
};
