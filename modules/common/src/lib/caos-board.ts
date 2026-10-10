import type { Cup } from "../models/cup";
import type { components } from "../types/api";
import { jstDate } from "./jst";

// CaOS（ドリップ管制）の盤面の決まり。DB や画面を使わない純粋な関数だけを置く。
//
// 盤面は注文のカップ（OrderResponse の cups）の列で持つ：
//   - dripper：ドリッパーの番号（1〜6）
//   - dripperPosition：ドリッパーの中の順番（整数。小さいほど先。サーバーが決め、抜けた番号は詰めないので間が空く）
//   - dripId：同じカードで淹れるカップの印（統合したら同じ値）
//   - brewStartedAt・brewFinishedAt：抽出の開始・終了の時刻。どちらもサーバーの時刻で、サーバーが付ける（画面からは送らない）
// カードの状態は時刻で決まる（終了あり＝終わり、開始あり＝抽出中、どちらも無くドリッパーあり＝待機、ドリッパーなし＝未割当）。
// カップが全部準備完了（マスターで準備完了にした）のカードも終わりとみなす。
//
// CaOS の画面は、注文の一覧（共有の WebSocket の orders）から buildCaosCards でカードを組み立て、
// 操作は *Writes で PUT /api/caos/cups に送る書き込みを作る（「次へ」だけは POST /api/caos/drippers/{dripper}/next）。
// 書き込みの before はカップの今の値（届いた値をそのまま送り返す）、after は順番の数の代わりに「どのカードの前に入れるか」（insert_before）、
// 時刻の代わりに「始める」の印（start_brew）を持つ。

/** ドリッパーの数（番号は 1〜6。画面では 1st〜6th） */
const CAOS_DRIPPERS = 6;
/** ドリッパーの番号（1〜6） */
export const CAOS_DRIPPER_IDS: readonly number[] = Array.from(
  { length: CAOS_DRIPPERS },
  (_, i) => i + 1,
);
/** ドリッパーの番号が 1〜6 でなければ、その理由（画面にそのまま出す） */
export const caosDripperError = (dripper: number) =>
  CAOS_DRIPPER_IDS.includes(dripper)
    ? null
    : `ドリッパーは 1〜${CAOS_DRIPPERS} です`;

/** 1 枚のカード（1 回のドリップ）で淹れる最大の杯数 */
export const CAOS_MAX_CUPS = 2;

/** 1 枚のカードの抽出時間（秒）。全ドリッパー同じ（1 杯 135 秒・2 杯 195 秒） */
export const caosBrewSec = (cups: number) => (cups > 1 ? 195 : 135);

export type CaosCardStatus = "unassigned" | "queued" | "brewing" | "done";

/** カップの今の CaOS の値（Cup の列） */
export type CaosCupState = Pick<
  Cup,
  "dripper" | "dripperPosition" | "dripId" | "brewStartedAt" | "brewFinishedAt"
>;

/** PUT /api/caos/cups の書き込み 1 つ（カップの組を before から after にする） */
export type CaosCupsWrite = components["schemas"]["CaosCupsWrite"];
type CaosCupAfter = CaosCupsWrite["after"];

const UNASSIGNED_STATE: CaosCupState = {
  dripper: null,
  dripperPosition: null,
  dripId: null,
  brewStartedAt: null,
  brewFinishedAt: null,
};

/** 盤面が使う注文（OrderEntity をそのまま渡せる） */
export interface CaosOrderInput {
  id: string;
  /** 注文番号 */
  orderId: number;
  createdAt: Date;
  menus: readonly { orderMenuId?: string; assignee: string | null }[];
  cups: readonly Cup[];
}

/** カードの中の 1 杯 */
export interface CaosBoardCup {
  id: string;
  orderId: string;
  orderNo: number;
  /** 注文の中の並び（0 始まり） */
  position: number;
  item: Cup["item"];
  /** 指名（明細の assignee の前後の空白を落としたもの。自由記述のまま） */
  nominee: string | null;
  readyAt: Date | null;
  servedAt: Date | null;
  state: CaosCupState;
}

/** 盤面のカード（1 回のドリップ。最大 2 杯） */
export interface CaosCard {
  /** 画面の中でカードを指すキー。dripId、無ければ（未割当）カップの ID の組 */
  key: string;
  dripId: string | null;
  status: CaosCardStatus;
  dripper: number | null;
  dripperPosition: number | null;
  startedAt: Date | null;
  /** 終えた時刻。準備完了で終わりとみなしたカードは、カップの準備完了のいちばん遅い時刻 */
  finishedAt: Date | null;
  /** 並びは注文番号・注文の中の順 */
  cups: CaosBoardCup[];
  /** いちばん小さい注文番号 */
  orderNo: number;
  /** 上級生のみ（cupSeniorOnly）。上級生だけが淹れる */
  seniorOnly: boolean;
  /** 今のカップの値（書き込みの before に送る） */
  state: CaosCupState;
}

// カップを作るか・抽出が要るか・上級生のみかは、いったん商品の種類の名前（item_type.name）で決める。
// CaOS で種類の名前を見るのはこの 3 つ（itemMakesCup・cupNeedsBrew・cupSeniorOnly）だけにする。
// TODO: C1（#855・#859 の makes_cup・needs_brew・senior_only・iced_brew）と CaOS3 のうち後から main に入る方で、
// 名前で決めるのをやめ、種類の項目（makes_cup・needs_brew・senior_only）を読む形に戻す。

/** その種類の品物がカップを作るか。種類の名前に others（グッズ）を含まなければ作る */
export const itemMakesCup = (typeName: string) => !typeName.includes("others");

/** 抽出が要るカップか。カップを作る種類で、種類の名前に milk（ミルク）を含まなければ要る */
export const cupNeedsBrew = (cup: Pick<Cup, "item">) => {
  const name = cup.item.item_type.name;
  return itemMakesCup(name) && !name.includes("milk");
};

/** 上級生のみのカップか。抽出が要り、種類の名前に limited を含めば上級生のみ */
export const cupSeniorOnly = (cup: Pick<Cup, "item">) =>
  cupNeedsBrew(cup) && cup.item.item_type.name.includes("limited");

const cupState = (cup: Cup): CaosCupState => ({
  dripper: cup.dripper,
  dripperPosition: cup.dripperPosition,
  dripId: cup.dripId,
  brewStartedAt: cup.brewStartedAt,
  brewFinishedAt: cup.brewFinishedAt,
});

const compareStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const compareCups = (a: CaosBoardCup, b: CaosBoardCup) =>
  a.orderNo - b.orderNo ||
  compareStr(a.orderId, b.orderId) ||
  a.position - b.position;

// 同じカードにまとめてよいカップの印（商品と指名）
const itemNomineeKey = (cup: Pick<CaosBoardCup, "item" | "nominee">) =>
  `${cup.item.id ?? cup.item.name}\u0000${cup.nominee ?? ""}`;

const nomineeKey = (nominee: string | null) =>
  nominee === null ? "" : `\u0001${nominee}`;

// 準備完了（提供済みも）のカップ
const isReady = (cup: Pick<Cup, "readyAt" | "servedAt">) =>
  cup.readyAt !== null || cup.servedAt !== null;

const latest = (dates: (Date | null)[]) =>
  dates.reduce<Date | null>(
    (out, d) => (d && (!out || d > out) ? d : out),
    null,
  );

const makeCard = (
  cups: CaosBoardCup[],
  status: CaosCardStatus,
  state: CaosCupState,
): CaosCard => {
  const sorted = [...cups].sort(compareCups);
  return {
    key: state.dripId ?? `cups:${sorted.map((cup) => cup.id).join(",")}`,
    dripId: state.dripId,
    status,
    dripper: state.dripper,
    dripperPosition: state.dripperPosition,
    startedAt: state.brewStartedAt,
    finishedAt:
      status === "done"
        ? (state.brewFinishedAt ?? latest(sorted.map((cup) => cup.readyAt)))
        : null,
    cups: sorted,
    orderNo: sorted[0].orderNo,
    seniorOnly: sorted.some(cupSeniorOnly),
    state,
  };
};

// dripId のあるカードの状態（終了あり・全部準備完了＝終わり、開始あり＝抽出中、ドリッパーあり＝待機、無し＝統合した未割当）
const placedStatus = (
  state: CaosCupState,
  allReady: boolean,
): CaosCardStatus => {
  if (state.dripper === null) return "unassigned";
  if (state.brewFinishedAt || allReady) return "done";
  if (state.brewStartedAt) return "brewing";
  return "queued";
};

const statusRank: Record<CaosCardStatus, number> = {
  unassigned: 0,
  done: 1,
  brewing: 2,
  queued: 3,
};

// ドリッパーの待機の並び：順番・いちばん小さい注文番号・dripId の順。
// API の「次へ」（api/internal/handlers/caos.go の splitCaosLane）と同じ決まり。caos-lane-cases.json で両方を確かめる
const compareQueued = (a: CaosCard, b: CaosCard) =>
  (a.dripperPosition ?? 0) - (b.dripperPosition ?? 0) ||
  a.orderNo - b.orderNo ||
  compareStr(a.key, b.key);

const compareCards = (a: CaosCard, b: CaosCard) => {
  if (a.status === "unassigned" || b.status === "unassigned") {
    if (a.status !== b.status)
      return statusRank[a.status] - statusRank[b.status];
    const x = a.cups[0];
    const y = b.cups[0];
    return (
      x.orderNo - y.orderNo ||
      compareStr(x.orderId, y.orderId) ||
      compareStr(x.item.item_type.name, y.item.item_type.name) ||
      compareStr(x.item.name, y.item.name) ||
      compareStr(nomineeKey(x.nominee), nomineeKey(y.nominee)) ||
      x.position - y.position
    );
  }
  const byLane =
    (a.dripper ?? 0) - (b.dripper ?? 0) ||
    statusRank[a.status] - statusRank[b.status];
  if (byLane) return byLane;
  if (a.status === "done")
    return (
      (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0) ||
      compareStr(a.key, b.key)
    );
  if (a.status === "brewing")
    return (
      (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0) ||
      compareStr(a.key, b.key)
    );
  return compareQueued(a, b);
};

/**
 * 注文の一覧から、その日（day。日本時間の YYYY-MM-DD、jstDate）のカードを組み立てる。day を省くと日では絞らない（練習の盤面）。
 *   - ドリッパーに置いたカード：同じ dripId のカップ。状態は時刻で決まり、カップが全部準備完了なら終わり
 *     （API の「次へ」の splitCaosLane と同じ決まり）
 *   - 統合した未割当：dripId はあるがドリッパーの無いカップ。準備完了のカップは除く
 *   - 未割当：まだカードに入っていない、抽出が要り準備完了でないカップを、注文ごと・商品ごと・指名（自由記述）ごとに分け、1 枚は最大 2 杯
 * 並びは、未割当（注文番号の順）のあとに、ドリッパーの順に 終わり・抽出中・待機（順番の順）。
 * 抽出が要らないカップ（cupNeedsBrew が false）は、列の値があっても出さない。
 */
export const buildCaosCards = (
  orders: readonly CaosOrderInput[],
  day?: string,
): CaosCard[] => {
  const byDrip = new Map<string, CaosBoardCup[]>();
  const loose = new Map<string, CaosBoardCup[]>();
  for (const order of orders) {
    if (day !== undefined && jstDate(order.createdAt.getTime()) !== day)
      continue;
    for (const [position, cup] of order.cups.entries()) {
      if (!cupNeedsBrew(cup)) continue;
      const nominee =
        order.menus
          .find((menu) => menu.orderMenuId === cup.orderMenuId)
          ?.assignee?.trim() || null;
      const boardCup: CaosBoardCup = {
        id: cup.id,
        orderId: order.id,
        orderNo: order.orderId,
        position,
        item: cup.item,
        nominee,
        readyAt: cup.readyAt,
        servedAt: cup.servedAt,
        state: cupState(cup),
      };
      const ready = isReady(cup);
      const { dripId, dripper } = boardCup.state;
      if (dripId && (dripper !== null || !ready)) {
        byDrip.set(dripId, [...(byDrip.get(dripId) ?? []), boardCup]);
        continue;
      }
      if (dripId || ready) continue;
      const key = `${order.id}\u0000${itemNomineeKey(boardCup)}`;
      loose.set(key, [...(loose.get(key) ?? []), boardCup]);
    }
  }

  const cards: CaosCard[] = [];
  for (const cups of byDrip.values()) {
    const state = cups[0].state;
    cards.push(makeCard(cups, placedStatus(state, cups.every(isReady)), state));
  }
  for (const cups of loose.values()) {
    const sorted = [...cups].sort(compareCups);
    for (let i = 0; i < sorted.length; i += CAOS_MAX_CUPS) {
      cards.push(
        makeCard(
          sorted.slice(i, i + CAOS_MAX_CUPS),
          "unassigned",
          UNASSIGNED_STATE,
        ),
      );
    }
  }
  return cards.sort(compareCards);
};

/** ドリッパーの列（終わり・抽出中・待機）。抽出中と待機の並びは API の「次へ」と同じ決まり */
export const caosLane = (cards: readonly CaosCard[], dripper: number) => {
  const mine = cards.filter((card) => card.dripper === dripper);
  return {
    done: mine.filter((card) => card.status === "done"),
    brewing: mine.find((card) => card.status === "brewing"),
    queued: mine.filter((card) => card.status === "queued").sort(compareQueued),
  };
};

// ---------------------------------------------------------------- 書き込み
//
// 順番の数（dripper_position）は画面では決めない。送るのは「どのドリッパーの、どのカードの前に入れるか」（after の insert_before）だけで、
// 番号はサーバーが決める（前に入るカードの番号にし、それより後ろを +1 する。insert_before が null なら最後）。

const UNASSIGNED_AFTER: CaosCupAfter = {
  dripper: null,
  drip_id: null,
  insert_before: null,
  start_brew: false,
};

const beforeJSON = (state: CaosCupState): CaosCupsWrite["before"] => ({
  dripper: state.dripper,
  dripper_position: state.dripperPosition,
  drip_id: state.dripId,
  brew_started_at: state.brewStartedAt?.toISOString() ?? null,
  brew_finished_at: state.brewFinishedAt?.toISOString() ?? null,
});

const writeOf = (card: CaosCard, after: CaosCupAfter): CaosCupsWrite => ({
  cup_ids: card.cups.map((cup) => cup.id),
  before: beforeJSON(card.state),
  after,
});

/** 書き込みを作れなかった理由（画面にそのまま出す） */
export type CaosWritesResult = { writes: CaosCupsWrite[] } | { error: string };

/** 待機のどこに入れるか。"front" は待機の先頭（先頭のカードの前）、beforeKey はそのカード（key）の前。無ければ待機の最後 */
export type CaosPlace = "front" | { beforeKey: string };

export interface CaosAssignOptions {
  place?: CaosPlace;
  /** 新しいカードの dripId を作る */
  newId: () => string;
}

/**
 * 割当・ドリッパーの移動・順番の入れ替え。未割当・待機のカードを dripper の待機の place（無ければ最後）に入れる。
 * ドリッパーに抽出中も待機も無ければ、そのまま抽出を始める（「始める」の印を送り、開始の時刻はサーバーが付ける）。
 * 今と同じ場所（同じドリッパーで、すぐ後ろのカードが同じ）なら何も書かない。
 */
export const assignWrites = (
  cards: readonly CaosCard[],
  card: CaosCard,
  dripper: number,
  { place, newId }: CaosAssignOptions,
): CaosWritesResult => {
  const invalid = caosDripperError(dripper);
  if (invalid) return { error: invalid };
  if (card.status !== "unassigned" && card.status !== "queued")
    return { error: "抽出中・終了のカードは動かせません" };
  const lane = caosLane(cards, dripper);
  const others = lane.queued.filter((other) => other.key !== card.key);
  let beforeCard: CaosCard | undefined;
  if (place === "front") beforeCard = others[0];
  else if (place) {
    beforeCard = others.find((other) => other.key === place.beforeKey);
    if (!beforeCard)
      return { error: "前に入れるカードが、そのドリッパーの待機にありません" };
  }
  if (card.status === "queued" && card.dripper === dripper) {
    const index = lane.queued.findIndex((other) => other.key === card.key);
    if ((lane.queued[index + 1]?.key ?? null) === (beforeCard?.key ?? null))
      return { writes: [] };
  }
  return {
    writes: [
      writeOf(card, {
        dripper,
        drip_id: card.dripId ?? newId(),
        insert_before: beforeCard?.dripId ?? null,
        start_brew: !lane.brewing && others.length === 0,
      }),
    ],
  };
};

/** 待機のカードを未割当に戻す（統合していたカードは分かれる） */
export const unassignWrites = (card: CaosCard): CaosWritesResult => {
  if (card.status !== "queued")
    return { error: "待機のカードだけ未割当に戻せます" };
  return { writes: [writeOf(card, UNASSIGNED_AFTER)] };
};

/** 統合できるか：1 杯どうしで、未割当どうし・待機どうし、同じ商品・同じ指名 */
export const canMergeCards = (a: CaosCard, b: CaosCard) =>
  a.key !== b.key &&
  a.status === b.status &&
  (a.status === "unassigned" || a.status === "queued") &&
  a.cups.length === 1 &&
  b.cups.length === 1 &&
  itemNomineeKey(a.cups[0]) === itemNomineeKey(b.cups[0]);

/**
 * 1 杯のカードどうしを 2 杯の同時抽出にまとめる。
 *   - 未割当どうし：両方のカップに新しい同じ dripId を入れる（ドリッパーにはまだ置かない）
 *   - 待機どうし：with のカップを card のカード（dripId）に入れる。番号はサーバーが card と同じにする（ほかはずらさない）。
 *     with を先に書き、card も同じ値で書いて card が変わっていないかを確かめる
 */
export const mergeWrites = (
  card: CaosCard,
  withCard: CaosCard,
  newId: () => string,
): CaosWritesResult => {
  if (!canMergeCards(card, withCard))
    return { error: "このカード同士は統合できません" };
  if (card.status === "unassigned") {
    const after = { ...UNASSIGNED_AFTER, drip_id: newId() };
    return { writes: [writeOf(card, after), writeOf(withCard, after)] };
  }
  // 待機どうし（まだ始めていない）なので、始めない
  const after: CaosCupAfter = {
    dripper: card.state.dripper,
    drip_id: card.state.dripId,
    insert_before: null,
    start_brew: false,
  };
  return { writes: [writeOf(withCard, after), writeOf(card, after)] };
};
