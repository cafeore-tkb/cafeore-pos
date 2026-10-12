import type { Cup } from "../models/cup";
import {
  DRIPPER_NUMBERS,
  assignmentDisplay,
  dripperLabel,
} from "../models/dripper";
import type { components } from "../types/api";
import { jstDate } from "./jst";

// CaOS（ドリップ管制）の盤面の決まり。DB や画面を使わない純粋な関数だけを置く。
//
// 盤面は注文のカップ（OrderResponse の cups）の列で持つ：
//   - dripper：ドリッパーの番号（1〜6）。指名の番号（明細の dripper）と同じもの
//   - dripperPosition：ドリッパーの中の順番（整数。小さいほど先。サーバーが決め、抜けた番号は詰めないので間が空く）
//   - dripId：同じカードで淹れるカップの印（統合したら同じ値）
//   - brewStartedAt・brewFinishedAt：抽出の開始・終了の時刻。どちらもサーバーの時刻で、サーバーが付ける（画面からは送らない）
// カードの状態は時刻で決まる（終了あり＝終わり、開始あり＝抽出中、どちらも無くドリッパーあり＝待機、ドリッパーなし＝未割当）。
// カップが全部準備完了（マスターで準備完了にした）のカードも終わりとみなす。
// 緊急（入れ直し。カップの emergencies）も同じ列を持ち、カップと同じ決まりでカードに入る（書き込みの cup_ids には入れ直しの id を入れる）。
// 入れ直しは準備完了の時刻を持たない（準備完了のカップも入れ直すので、準備完了で終わりにしない）。未割当の入れ直しは未割当のいちばん上に出す。
// 指名はレジで選んだドリッパーの番号（注文の明細の dripper）。番号のあるカップはその番号のドリッパーにしか置けない。
// 1 枚のカードに違う番号のカップは入れない（指名なしのカップは、どの番号のカップとも同じカードにできる。カードの指名はその番号）。
// 番号の無い自由記述（assignee）だけの古い明細は指名なし。
//
// CaOS の画面は、注文の一覧（共有の WebSocket の orders）から buildCaosCards でカードを組み立て、
// 操作は *Writes で PUT /api/caos/cups に送る書き込みを作る（「次へ」だけは POST /api/caos/drippers/{dripper}/next）。
// 書き込みの before はカップの今の値（届いた値をそのまま送り返す）、after は順番の数の代わりに「どのカードの前に入れるか」（insert_before）、
// 時刻の代わりに「始める」の印（start_brew）を持つ。

/** ドリッパーの番号が 1〜6（models/dripper の DRIPPER_NUMBERS）でなければ、その理由（画面にそのまま出す） */
export const caosDripperError = (dripper: number) =>
  DRIPPER_NUMBERS.includes(dripper)
    ? null
    : `ドリッパーは 1〜${DRIPPER_NUMBERS.length} です`;

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
  /** 明細の指名（dripper：ドリッパーの番号、assignee：自由記述） */
  menus: readonly {
    orderMenuId?: string;
    dripper: number | null;
    assignee: string | null;
  }[];
  cups: readonly Cup[];
}

/** カードの中の 1 杯（カップか、その入れ直し） */
export interface CaosBoardCup {
  /** 書き込みの cup_ids に入れる ID（カップの ID か、入れ直しの ID） */
  id: string;
  /** カップの ID（入れ直しなら、入れ直したカップ） */
  cupId: string;
  /** 緊急（入れ直し） */
  emergency: boolean;
  /** 入れ直す理由（カップと、理由の無い入れ直しは空） */
  emergencyReason: string;
  orderId: string;
  orderNo: number;
  /** 注文の中の並び（0 始まり） */
  position: number;
  item: Cup["item"];
  /** 指名のドリッパーの番号（明細の dripper。1〜6）。指名なし・自由記述だけの古い明細は null */
  nominatedDripper: number | null;
  /** 指名の表示（マスターと同じ assignmentDisplay。番号は「2nd」、番号の無い古い明細は自由記述）。指名なしは null */
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
  /** カードの指名のドリッパーの番号（カップのどれかに指名があればその番号）。無ければ null */
  nominatedDripper: number | null;
  /** 上級生のみ（cupSeniorOnly）。上級生だけが淹れる */
  seniorOnly: boolean;
  /** 緊急（入れ直し）が入っている */
  emergency: boolean;
  /** 今のカップの値（書き込みの before に送る） */
  state: CaosCupState;
}

// 抽出が要るか・上級生のみかは、商品の種類の項目（makes_cup・needs_brew・senior_only）で決める。
// 種類の名前では決めない（API の ItemType.BrewRequired() と同じ決まり）。

/** 抽出が要るカップか。カップを作り（makes_cup）、抽出が要る（needs_brew）種類 */
export const cupNeedsBrew = (cup: Pick<Cup, "item">) =>
  cup.item.item_type.makes_cup && cup.item.item_type.needs_brew;

/** 上級生のみのカップか。抽出が要り、上級生だけが淹れる（senior_only）種類 */
export const cupSeniorOnly = (cup: Pick<Cup, "item">) =>
  cupNeedsBrew(cup) && cup.item.item_type.senior_only;

const cupState = (cup: CaosCupState): CaosCupState => ({
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

// 未割当で同じカードにまとめるカップの印（商品と指名の番号。自由記述は表示だけ）
const itemNomineeKey = (cup: Pick<CaosBoardCup, "item" | "nominatedDripper">) =>
  `${cup.item.id ?? cup.item.name}\u0000${cup.nominatedDripper ?? ""}`;

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
    nominatedDripper:
      sorted.find((cup) => cup.nominatedDripper !== null)?.nominatedDripper ??
      null,
    seniorOnly: sorted.some(cupSeniorOnly),
    emergency: sorted.some((cup) => cup.emergency),
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
      Number(b.emergency) - Number(a.emergency) ||
      x.orderNo - y.orderNo ||
      compareStr(x.orderId, y.orderId) ||
      compareStr(x.item.item_type.name, y.item.item_type.name) ||
      compareStr(x.item.name, y.item.name) ||
      (x.nominatedDripper ?? 0) - (y.nominatedDripper ?? 0) ||
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
 *   - 未割当：まだカードに入っていない、抽出が要り準備完了でないカップを、注文ごと・商品ごと・指名の番号ごと・入れ直しかで分け、1 枚は最大 2 杯
 * 並びは、未割当（入れ直し、注文番号の順）のあとに、ドリッパーの順に 終わり・抽出中・待機（順番の順）。
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
      const menu = order.menus.find(
        (menu) => menu.orderMenuId === cup.orderMenuId,
      );
      const nominatedDripper = menu?.dripper ?? null;
      const base = {
        cupId: cup.id,
        orderId: order.id,
        orderNo: order.orderId,
        position,
        item: cup.item,
        nominatedDripper,
        nominee: assignmentDisplay({
          dripper: nominatedDripper,
          assignee: menu?.assignee?.trim() || null,
        }),
      };
      const boardCups: CaosBoardCup[] = [
        {
          ...base,
          id: cup.id,
          emergency: false,
          emergencyReason: "",
          readyAt: cup.readyAt,
          servedAt: cup.servedAt,
          state: cupState(cup),
        },
        ...cup.emergencies.map((emergency) => ({
          ...base,
          id: emergency.id,
          emergency: true,
          emergencyReason: emergency.reason,
          readyAt: null,
          servedAt: null,
          state: cupState(emergency),
        })),
      ];
      for (const boardCup of boardCups) {
        const ready = isReady(boardCup);
        const { dripId, dripper } = boardCup.state;
        if (dripId && (dripper !== null || !ready)) {
          byDrip.set(dripId, [...(byDrip.get(dripId) ?? []), boardCup]);
          continue;
        }
        if (dripId || ready) continue;
        const key = `${order.id}\u0000${boardCup.emergency}\u0000${itemNomineeKey(boardCup)}`;
        loose.set(key, [...(loose.get(key) ?? []), boardCup]);
      }
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

/** カップの CaOS の値を API の形（書き込みの before・「1つ戻す」の値）にする */
export const caosStateJSON = (
  state: CaosCupState,
): CaosCupsWrite["before"] => ({
  dripper: state.dripper,
  dripper_position: state.dripperPosition,
  drip_id: state.dripId,
  brew_started_at: state.brewStartedAt?.toISOString() ?? null,
  brew_finished_at: state.brewFinishedAt?.toISOString() ?? null,
});

const writeOf = (card: CaosCard, after: CaosCupAfter): CaosCupsWrite => ({
  cup_ids: card.cups.map((cup) => cup.id),
  before: caosStateJSON(card.state),
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

/** 注文の入れ直しの理由を、よく使う順に limit 個（緊急の理由の候補。理由の無いものは数えない） */
export const frequentEmergencyReasons = (
  orders: readonly { cups: readonly Pick<Cup, "emergencies">[] }[],
  limit = 5,
): string[] => {
  const counts = new Map<string, number>();
  for (const order of orders)
    for (const cup of order.cups)
      for (const { reason } of cup.emergencies)
        if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || compareStr(a[0], b[0]))
    .slice(0, limit)
    .map(([reason]) => reason);
};

/** カードを置けるドリッパーか。指名の番号のあるカードは、その番号のドリッパーだけ（サーバーも同じ決まりで断る） */
export const caosDripperAllowed = (
  card: Pick<CaosCard, "nominatedDripper">,
  dripper: number,
) => card.nominatedDripper === null || card.nominatedDripper === dripper;

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
  if (!caosDripperAllowed(card, dripper))
    return {
      error: `指名のあるカードは ${dripperLabel(card.nominatedDripper ?? dripper)} のドリッパーにしか置けません`,
    };
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

// 同じ商品のカップか（統合できるのは同じ商品の 1 杯どうしだけ）
const sameItem = (a: CaosBoardCup, b: CaosBoardCup) =>
  (a.item.id ?? a.item.name) === (b.item.id ?? b.item.name);

/**
 * card を into のカードに統合できるか（1 杯 + 1 杯 = 2 杯の同時抽出）。同じ商品の 1 杯どうしで、指名の番号がぶつからない
 * （どちらかが指名なし、または同じ番号）。緊急（入れ直し）は入れ直しどうしだけ（緊急でないカップと同じカードにしない。サーバーも断る）。
 *   - card（動かすほう）は未割当か待機。into（入るほう）は未割当・待機・抽出中（抽出を始めたカードにも足せる。終わったカードには入れない）
 *   - into がドリッパーにあれば、card もそのドリッパーに置ける（指名）
 */
export const canMergeCards = (card: CaosCard, into: CaosCard) =>
  card.key !== into.key &&
  (card.status === "unassigned" || card.status === "queued") &&
  into.status !== "done" &&
  card.cups.length === 1 &&
  into.cups.length === 1 &&
  card.emergency === into.emergency &&
  sameItem(card.cups[0], into.cups[0]) &&
  (into.nominatedDripper === null ||
    caosDripperAllowed(card, into.nominatedDripper)) &&
  (into.dripper === null || caosDripperAllowed(card, into.dripper));

/** 抽出を始めてからこの秒を過ぎたカードへ統合するときは、画面で確かめる（止めはしない） */
export const CAOS_LATE_MERGE_SEC = 30;

/**
 * 統合の前に確かめるか：入るカード（into）が抽出中で、始めてから CAOS_LATE_MERGE_SEC 秒を過ぎている。
 * そのときは始めてからの秒を返す（画面で確かめてから統合する）。ほかは null。nowMs はエポックのミリ秒
 */
export const caosLateMerge = (
  into: Pick<CaosCard, "status" | "startedAt">,
  nowMs: number,
) => {
  if (into.status !== "brewing" || !into.startedAt) return null;
  const elapsedMs = nowMs - into.startedAt.getTime();
  return elapsedMs > CAOS_LATE_MERGE_SEC * 1000
    ? Math.floor(elapsedMs / 1000)
    : null;
};

/**
 * card のカップを into のカードに入れる（2 杯の同時抽出にまとめる）。into の場所（未割当・ドリッパーの順番）のまま。
 *   - into がまだカードの印（dripId）の無い未割当なら、両方に新しい同じ dripId を入れる（ドリッパーにはまだ置かない）
 *   - 待機・未割当の into：card を先に書き、into も同じ値で書いて into が変わっていないかを確かめる（番号はサーバーが into と同じにする）
 *   - 抽出中の into：card だけを書く（抽出中のカードは書き直さない）。開始の時刻はサーバーが into から写す
 */
export const mergeWrites = (
  card: CaosCard,
  into: CaosCard,
  newId: () => string,
): CaosWritesResult => {
  if (!canMergeCards(card, into))
    return { error: "このカード同士は統合できません" };
  const after: CaosCupAfter = {
    dripper: into.dripper,
    drip_id: into.dripId ?? newId(),
    insert_before: null,
    start_brew: false,
  };
  const writes = [writeOf(card, after)];
  if (into.status !== "brewing") writes.push(writeOf(into, after));
  return { writes };
};

/**
 * 1 杯を外せる（統合を解除できる）カードか。ほかの注文と統合した、未割当・待機のカード（抽出中・終わりのカードは分けない）。
 * 同じ注文の同じ商品の 2 杯は、はじめから 1 枚のカードで淹れるので分けない
 */
export const canSplitCard = (card: CaosCard) =>
  new Set(card.cups.map((cup) => cup.orderId)).size > 1 &&
  (card.status === "unassigned" || card.status === "queued");

/**
 * 統合の解除。統合したカードから cupId の 1 杯を外して未割当に戻す（残りの 1 杯はそのままの場所。どちらを外すかで、残すほうを選べる）。
 * 外したカップは、注文のほかの未割当のカップと同じカードにまとまることがある（未割当に戻すのと同じ）
 */
export const splitWrites = (
  card: CaosCard,
  cupId: string,
): CaosWritesResult => {
  if (!canSplitCard(card) || !card.cups.some((cup) => cup.id === cupId))
    return { error: "このカードは分けられません" };
  return {
    writes: [
      {
        cup_ids: [cupId],
        before: caosStateJSON(card.state),
        after: UNASSIGNED_AFTER,
      },
    ],
  };
};

/**
 * ドリッパー from の待機を全部、to の待機の最後へ移す（並びはそのまま）。to に置けないカード（指名の番号の違うカード、
 * blocked が理由を返すカード）は残し、その枚数を kept で返す。to に抽出中も待機も無ければ、先頭のカードはそのまま抽出を始める
 * （assignWrites と同じ）
 */
export const moveQueueWrites = (
  cards: readonly CaosCard[],
  from: number,
  to: number,
  blocked: (card: CaosCard) => string | null = () => null,
): { writes: CaosCupsWrite[]; kept: number } | { error: string } => {
  const invalid = caosDripperError(to);
  if (invalid) return { error: invalid };
  if (from === to) return { error: "同じドリッパーには移せません" };
  const queued = caosLane(cards, from).queued;
  const moving = queued.filter(
    (card) => caosDripperAllowed(card, to) && !blocked(card),
  );
  const target = caosLane(cards, to);
  const free = !target.brewing && target.queued.length === 0;
  return {
    writes: moving.map((card, index) =>
      writeOf(card, {
        dripper: to,
        drip_id: card.dripId,
        insert_before: null,
        start_brew: free && index === 0,
      }),
    ),
    kept: queued.length - moving.length,
  };
};

// ---------------------------------------------------------------- 「次へ」

/** 抽出を始めてから「次へ」を押せるようになるまでの秒（二度押しや、続けて押すのを防ぐ。サーバーも同じ秒で断る） */
export const CAOS_NEXT_COOLDOWN_SEC = 10;

/** 抽出中のカードの「次へ」をまだ押せないか（始めてから CAOS_NEXT_COOLDOWN_SEC 秒たっていない）。nowMs はエポックのミリ秒 */
export const caosNextLocked = (
  card: Pick<CaosCard, "startedAt"> | undefined,
  nowMs: number,
) =>
  card?.startedAt != null &&
  nowMs - card.startedAt.getTime() < CAOS_NEXT_COOLDOWN_SEC * 1000;
