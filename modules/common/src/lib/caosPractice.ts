import type { Cup } from "../models/cup";
import {
  CAOS_DRIPPERS,
  CAOS_MAX_CUPS,
  type CaosCupsWrite,
  type CaosOrderInput,
  cupNeedsBrew,
} from "./caos-board";

// CaOS の実データテスト（練習）の盤面。ブラウザの中だけで動かし、サーバー・本番の盤面・注文・在庫には触らない。
//
// 練習の盤面は、本番と同じ形の注文とカップ（CaosOrderInput。カップに dripper・dripperPosition・dripId・
// brewStartedAt・brewFinishedAt を持つ）で持つ。カードの組み立て（buildCaosCards）と、割当・移動・未割当に戻す・統合の
// 書き込み（assignWrites・unassignWrites・mergeWrites）は本番と同じ ./caos-board の関数を使い、
// 本番ならサーバーがする「書き込みを当てる」（番号を決める・後ろをずらす）と「次へ」だけをここで同じ決まりで行う
// （api/internal/handlers/caos.go の writeCups・placeCaosCups・advance と、同じ確かめ方・同じ理由の文。
// サーバーを使わずに練習するため、わざと 2 か所に持つ。決まりや文を変えるときは両方そろえること）。
//   - 抽出が要るかは本番と同じく種類の名前で決める（cupNeedsBrew）。上級生のみのカードは本番と同じく、どのドリッパーにも置ける
//   - 本番は今日（日本時間）の注文だけを見るが、練習の盤面は練習の時間帯の注文だけを持つので、日では絞らない
// 時刻はサーバーの今の代わりに、練習の時計の今（now）を使う。

/** 練習の盤面の注文（本番の注文と同じく、カップに CaOS の値を持つ） */
export interface CaosPracticeOrder extends CaosOrderInput {
  cups: Cup[];
}

/** 書き込み・「次へ」の結果。断ったときは理由（画面にそのまま出す） */
export type CaosPracticeResult =
  | { orders: CaosPracticeOrder[]; error?: undefined }
  | { orders?: undefined; error: string };

// ---------------------------------------------------------------- 実データ → 練習の注文

/** 練習に使う実データの品物（使う項目だけ） */
export interface CaosPracticeSourceItem {
  /** 商品の ID（あれば。豆・色はこれで引く）。無ければ名前で見分ける */
  id?: string;
  name: string;
  abbr?: string;
  /** 商品の種類の名前（item_type の name） */
  type: string;
}

/** 練習に使う実データの注文（使う項目だけ） */
export interface CaosPracticeSourceOrder {
  orderId: number;
  /** 作成日時（ISO 8601） */
  createdAt: string;
  items: readonly CaosPracticeSourceItem[];
}

// グッズの種類の名前。POS が注文を保存するとき、この種類の品物はカップにしない（api/internal/handlers/order_cup.go の goodsItemTypeName）
const GOODS_TYPE_NAME = "others";

/**
 * 実データの注文を、練習の盤面の注文にする。グッズ以外の品物を 1 杯ずつカップにする（POS が注文を保存したときと同じ）。
 * 抽出の要らないカップ（ミルクなど）もカップにはなるが、本番と同じく buildCaosCards がカードにしない。
 * 指名は実データに無いので、どのカップも指名なし（明細の assignee は null）。ID は練習の中だけのもの
 */
export const toCaosPracticeOrder = (
  order: CaosPracticeSourceOrder,
  index: number,
): CaosPracticeOrder => {
  const id = `practice-${index}`;
  const cups: Cup[] = [];
  order.items.forEach((item, position) => {
    if (item.type === GOODS_TYPE_NAME) return;
    const cupId = `${id}-${position}`;
    cups.push({
      id: cupId,
      orderMenuId: cupId,
      item: {
        id: item.id || `name:${item.name}`,
        name: item.name,
        abbr: item.abbr || item.name,
        item_type: { name: item.type, display_name: item.type },
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
      assignee: null,
    })),
    cups,
  };
};

// ---------------------------------------------------------------- カップの値

// 時刻はミリ秒までで比べる（サーバーの sameCaosState と同じ）
const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

const parseTime = (value: string | null) =>
  value === null ? null : new Date(value);

const sameBefore = (cup: Cup, before: CaosCupsWrite["before"]) =>
  cup.dripper === before.dripper &&
  cup.dripperPosition === before.dripper_position &&
  cup.dripId === before.drip_id &&
  sameTime(cup.brewStartedAt, parseTime(before.brew_started_at)) &&
  sameTime(cup.brewFinishedAt, parseTime(before.brew_finished_at));

const sameState = (a: Cup, b: Cup) =>
  a.dripper === b.dripper &&
  a.dripperPosition === b.dripperPosition &&
  a.dripId === b.dripId &&
  sameTime(a.brewStartedAt, b.brewStartedAt) &&
  sameTime(a.brewFinishedAt, b.brewFinishedAt);

// 書く値の形を確かめる（サーバーの validateCaosAfter）
const validateAfter = (after: CaosCupsWrite["after"]) => {
  if (after.dripper === null) {
    if (after.insert_before !== null || after.start_brew)
      return "ドリッパーの無いカップは、前に入れるカードを決められず、抽出も始められません";
    return null;
  }
  if (
    !Number.isInteger(after.dripper) ||
    after.dripper < 1 ||
    after.dripper > CAOS_DRIPPERS
  )
    return `ドリッパーは 1〜${CAOS_DRIPPERS} です`;
  if (after.drip_id === null)
    return "ドリッパーに置くカップには drip_id が要ります";
  if (after.insert_before !== null && after.insert_before === after.drip_id)
    return "自分のカードの前には入れられません";
  if (after.insert_before !== null && after.start_brew)
    return "抽出を始めるのは空いているドリッパーだけなので、前に入れるカードは決められません";
  return null;
};

const cloneOrders = (orders: readonly CaosPracticeOrder[]) =>
  orders.map((order) => ({
    ...order,
    cups: order.cups.map((cup) => ({ ...cup })),
  }));

const allCups = (orders: CaosPracticeOrder[]) =>
  orders.flatMap((order) => order.cups);

const findCup = (orders: CaosPracticeOrder[], cupId: string) => {
  for (const order of orders) {
    const cup = order.cups.find((candidate) => candidate.id === cupId);
    if (cup) return cup;
  }
  return null;
};

// ---------------------------------------------------------------- ドリッパーの列（サーバーの splitCaosLane と同じ）

interface LaneCard {
  dripId: string;
  cups: Cup[];
  orderNo: number;
}

const compareStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * ドリッパーの終わっていないカップを、抽出中のカードと待機のカード（先頭から順に）に分ける。
 * 終了の時刻があるか、カップが全部準備完了のカードは終わり（どちらにも入れない）。開始の時刻があれば抽出中、無ければ待機。
 * 待機の並びは dripper_position・いちばん小さい注文番号・drip_id の順
 */
const splitLane = (orders: CaosPracticeOrder[], dripper: number) => {
  const cards: LaneCard[] = [];
  const byId = new Map<string, LaneCard>();
  for (const order of orders) {
    for (const cup of order.cups) {
      if (
        cup.dripper !== dripper ||
        cup.brewFinishedAt !== null ||
        cup.dripId === null
      )
        continue;
      let card = byId.get(cup.dripId);
      if (!card) {
        card = { dripId: cup.dripId, cups: [], orderNo: order.orderId };
        byId.set(cup.dripId, card);
        cards.push(card);
      }
      card.cups.push(cup);
      card.orderNo = Math.min(card.orderNo, order.orderId);
    }
  }
  const brewing: LaneCard[] = [];
  const queued: LaneCard[] = [];
  for (const card of cards) {
    const first = card.cups[0];
    const allReady = card.cups.every((cup) => cup.readyAt !== null);
    if (first.brewFinishedAt !== null || allReady) continue;
    if (first.brewStartedAt !== null) brewing.push(card);
    else queued.push(card);
  }
  const position = (card: LaneCard) => card.cups[0].dripperPosition ?? 0;
  queued.sort(
    (a, b) =>
      position(a) - position(b) ||
      a.orderNo - b.orderNo ||
      compareStr(a.dripId, b.dripId),
  );
  return { brewing, queued };
};

// ---------------------------------------------------------------- 書き込みを当てる（PUT /api/caos/cups と同じ）

/**
 * 書くカップを置く番号を決める（サーバーの placeCaosCups）。番号をずらすときは、ここで後ろのカップを +1 する。
 *   - drip_id がほかのカップ（この書き込みに入っていないもの）と同じなら、そのカードに入る（統合）。番号はそのカードと同じ。ずらさない
 *   - insert_before が無ければ最後：そのドリッパーの終わっていないカップの最大＋1（無ければ 1）。ずらさない
 *   - insert_before があれば、そのカード（そのドリッパーの待機）の番号 p に入れる。番号が p 以上の終わっていないカップを全部 +1 する
 */
const placeCups = (
  orders: CaosPracticeOrder[],
  write: CaosCupsWrite,
): { position: number; error?: undefined } | { error: string } => {
  const dripper = write.after.dripper as number;
  const writing = new Set(write.cup_ids);
  const cups = allCups(orders).filter((cup) => !writing.has(cup.id));
  const joined = cups.find((cup) => cup.dripId === write.after.drip_id);
  if (joined) {
    if (write.after.insert_before !== null)
      return {
        error: "ほかのカードに入れるときは、前に入れるカードは決められません",
      };
    if (joined.dripperPosition === null)
      return { error: "同じカードのカップは全部いっしょに動かしてください" };
    return { position: joined.dripperPosition };
  }

  const lane = cups.filter(
    (cup) => cup.dripper === dripper && cup.brewFinishedAt === null,
  );
  if (write.after.insert_before === null)
    return {
      position: Math.max(0, ...lane.map((cup) => cup.dripperPosition ?? 0)) + 1,
    };

  const target = lane.find(
    (cup) =>
      cup.dripId === write.after.insert_before &&
      cup.brewStartedAt === null &&
      cup.dripperPosition !== null,
  );
  if (!target || target.dripperPosition === null)
    return {
      error:
        "前に入れるカードが、そのドリッパーの待機にありません（ほかの端末で動いたかもしれません）",
    };
  const p = target.dripperPosition;
  for (const cup of lane) {
    if (cup.dripperPosition !== null && cup.dripperPosition >= p)
      cup.dripperPosition += 1;
  }
  return { position: p };
};

/**
 * 書き込み（assignWrites・unassignWrites・mergeWrites が作ったもの）を練習の盤面に当てる。全部当てるか、何も変えないか。
 * 番号はサーバーと同じ決まりでここで決める。抽出を始める書き込みの開始の時刻は now（練習の時計の今）
 */
export const applyCaosPracticeWrites = (
  orders: readonly CaosPracticeOrder[],
  writes: readonly CaosCupsWrite[],
  now: Date,
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
    const cups: Cup[] = [];
    for (const id of write.cup_ids) {
      const cup = findCup(next, id);
      if (!cup)
        return {
          error: "カップが消えました（注文が編集・削除されたかもしれません）",
        };
      if (!sameBefore(cup, write.before))
        return {
          error: "ほかの端末で先に変わりました。もう一度操作してください",
        };
      // 抽出中・終わりのカードは動かさない（終えるのは「次へ」）
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
      cups.push(cup);
    }
    let position: number | null = null;
    if (write.after.dripper !== null) {
      const placed = placeCups(next, write);
      if (placed.error !== undefined) return { error: placed.error };
      position = placed.position;
    }
    for (const cup of cups) {
      cup.dripper = write.after.dripper;
      cup.dripperPosition = position;
      cup.dripId = write.after.drip_id;
      cup.brewStartedAt = write.after.start_brew ? new Date(now) : null;
      cup.brewFinishedAt = null;
    }
    if (write.after.drip_id !== null) touched.add(write.after.drip_id);
    if (write.after.start_brew && write.after.dripper !== null)
      brewing.add(write.after.dripper);
  }

  // 書いたカードの全部のカップ（書かなかったカップも含む）が同じ値で、最大 2 杯か
  for (const dripId of touched) {
    const cups = allCups(next).filter((cup) => cup.dripId === dripId);
    if (cups.length > CAOS_MAX_CUPS)
      return { error: `1 枚のカードは ${CAOS_MAX_CUPS} 杯までです` };
    if (cups.some((cup) => !sameState(cup, cups[0])))
      return { error: "同じカードのカップは全部いっしょに動かしてください" };
  }
  // 1 つのドリッパーで抽出中は 1 枚（「次へ」と同じ決まりで数える）
  for (const dripper of brewing) {
    if (splitLane(next, dripper).brewing.length > 1)
      return { error: `${dripper} 番のドリッパーはもう抽出中です` };
  }
  return { orders: next };
};

// ---------------------------------------------------------------- 「次へ」（POST /api/caos/drippers/{dripper}/next と同じ）

/**
 * 「次へ」。抽出中のカードを終え（終了の時刻を付け、そのカップを準備完了にする）、待機の先頭を始める。
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
  const { brewing, queued } = splitLane(next, dripper);
  const cur = brewing[0];
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

  for (const cup of allCups(next)) {
    if (cur && cup.dripId === cur.dripId) {
      cup.readyAt = cup.readyAt ?? new Date(now);
      cup.brewFinishedAt = new Date(now);
    }
    if (head && cup.dripId === head.dripId) cup.brewStartedAt = new Date(now);
  }
  return { orders: next };
};
