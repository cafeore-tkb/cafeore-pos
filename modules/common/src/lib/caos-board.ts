import type { Cup } from "../models/cup";
import type { components } from "../types/api";
import { jstDate } from "./jst";

// CaOS（ドリップ管制）の盤面の決まり。DB や画面を使わない純粋な関数だけを置く。
//
// 盤面は注文のカップ（OrderResponse の cups）の列で持つ：
//   - dripper：ドリッパーの番号（1〜6）
//   - dripperPosition：ドリッパーの中の順番（小さいほど先）
//   - dripId：同じカードで淹れるカップの印（統合したら同じ値）
//   - brewStartedAt・brewFinishedAt：抽出の開始・終了の時刻。どちらもサーバーの時刻で、サーバーが付ける（画面からは送らない）
// カードの状態は時刻で決まる（終了あり＝終わり、開始あり＝抽出中、どちらも無くドリッパーあり＝待機、ドリッパーなし＝未割当）。
// カップが全部準備完了（マスターで準備完了にした）のカードも終わりとみなす。
//
// CaOS の画面は、注文の一覧（共有の WebSocket の orders）から buildCaosCards でカードを組み立て、
// 操作は *Writes で PUT /api/caos/cups に送る書き込みを作る（「次へ」だけは POST /api/caos/drippers/{dripper}/next）。
// 書き込みの before はカップの今の値（届いた値をそのまま送り返す）、after は時刻の代わりに「始める」の印（start_brew）を持つ。

/** ドリッパーの数（番号は 1〜6。画面では 1st〜6th） */
export const CAOS_DRIPPERS = 6;
/** ドリッパーの番号（1〜6） */
export const CAOS_DRIPPER_IDS: readonly number[] = Array.from(
  { length: CAOS_DRIPPERS },
  (_, i) => i + 1,
);
/** 1 枚のカード（1 回のドリップ）で淹れる最大の杯数 */
export const CAOS_MAX_CUPS = 2;

/** 1 枚のカードの抽出時間（秒）。全ドリッパー同じ（1 杯 135 秒・2 杯 195 秒） */
export const caosBrewSec = (cups: number) => (cups > 1 ? 195 : 135);
/** 秒を「2分15秒」に */
export const caosDurationLabel = (sec: number) =>
  `${Math.floor(sec / 60)}分${sec % 60}秒`;
/** 秒を「02:15」に（残り時間）。10 分以上は「12:05」 */
export const caosClockLabel = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
/** 盤面の秒（その日の 0 時（日本時間、jstDayStart）からの秒）を「10:05:09」に。24 時を越えたら 0 時に戻す */
export const caosTimeOfDayLabel = (sec: number) => {
  const day = ((Math.floor(sec) % 86400) + 86400) % 86400;
  return `${String(Math.floor(day / 3600)).padStart(2, "0")}:${caosClockLabel(day % 3600)}`;
};

/** 前の抽出が終わってから次の抽出を始めるまでの入れ替えの時間（秒） */
export const CAOS_CHANGEOVER_SEC = 15;
/** 抽出中のカードが無いドリッパーで、先頭の待機カードを始める見込み（今から何秒後か） */
export const CAOS_FIRST_START_DELAY_SEC = 10;
/** 抽出の残りがこの秒以下なら「まもなく」（画面で目立たせる） */
export const CAOS_SOON_SEC = 15;

/** 1 つのドリッパーの予定時刻（盤面の秒） */
export interface CaosLanePlan {
  /** 抽出中のカード：開始・終了の見込み・残り */
  brewing?: { startSec: number; endSec: number; remainingSec: number };
  /** 待機カード（並び順のまま）：開始・終了の見込み */
  queued: { startSec: number; endSec: number }[];
}

/**
 * 1 つのドリッパーの抽出中・待機カードの予定時刻を決める。
 *   - 抽出中のカードは、始めた時刻（分からなければ今）から抽出時間で終わる見込み。過ぎていたら今終わる見込みにする
 *   - 待機カードは、前のカードの終わりから入れ替えの時間（CAOS_CHANGEOVER_SEC）を挟んで順に始める
 *   - 抽出中のカードが無いときは、先頭の待機カードを今から CAOS_FIRST_START_DELAY_SEC 後に始める
 */
export const planCaosLane = (
  nowSec: number,
  brewing: { startSec?: number; durationSec: number } | undefined,
  queuedDurationsSec: readonly number[],
): CaosLanePlan => {
  let cursor = nowSec;
  let brewingPlan: CaosLanePlan["brewing"];
  if (brewing) {
    const startSec = brewing.startSec ?? nowSec;
    const plannedEndSec = startSec + brewing.durationSec;
    brewingPlan = {
      startSec,
      endSec: Math.max(nowSec, plannedEndSec),
      remainingSec: Math.max(0, plannedEndSec - nowSec),
    };
    cursor = brewingPlan.endSec;
  }
  const queued = queuedDurationsSec.map((durationSec, index) => {
    const startSec =
      !brewing && index === 0
        ? nowSec + CAOS_FIRST_START_DELAY_SEC
        : cursor + CAOS_CHANGEOVER_SEC;
    cursor = startSec + durationSec;
    return { startSec, endSec: cursor };
  });
  return { brewing: brewingPlan, queued };
};

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
  /** 限定（種類の senior_only）。上級生だけが淹れる */
  seniorOnly: boolean;
  /** 今のカップの値（書き込みの before に送る） */
  state: CaosCupState;
}

/** 抽出が要るカップか（種類の needs_brew。カップを作らない種類は API が false にして返す。種類の名前は見ない） */
export const cupNeedsBrew = (cup: Pick<Cup, "item">) =>
  cup.item.item_type.needs_brew;

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

const nomineeKey = (nominee: string | null) =>
  nominee === null ? "" : `\u0001${nominee}`;

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
    seniorOnly: sorted.some((cup) => cup.item.item_type.senior_only === true),
    state,
  };
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
 * 注文の一覧から、その日（day。日本時間の YYYY-MM-DD、jstDate）のカードを組み立てる。
 *   - ドリッパーに置いたカード：同じ dripId のカップ。状態は時刻で決まり、カップが全部準備完了なら終わり
 *     （API の「次へ」の splitCaosLane と同じ決まり）
 *   - 統合した未割当：dripId はあるがドリッパーの無いカップ。準備完了のカップは除く
 *   - 未割当：まだカードに入っていない、抽出が要り準備完了でないカップを、注文ごと・商品ごと・指名（自由記述）ごとに分け、1 枚は最大 2 杯
 * 並びは、未割当（注文番号の順）のあとに、ドリッパーの順に 終わり・抽出中・待機（順番の順）。
 * 抽出が要らないカップ（needs_brew が false）は、列の値があっても出さない。
 */
export const buildCaosCards = (
  orders: readonly CaosOrderInput[],
  day: string,
): CaosCard[] => {
  const byDrip = new Map<string, CaosBoardCup[]>();
  const loose = new Map<string, CaosBoardCup[]>();
  for (const order of orders) {
    if (jstDate(order.createdAt.getTime()) !== day) continue;
    order.cups.forEach((cup, position) => {
      if (!cupNeedsBrew(cup)) return;
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
      const ready = cup.readyAt !== null || cup.servedAt !== null;
      const { dripId, dripper } = boardCup.state;
      if (dripId && (dripper !== null || !ready)) {
        byDrip.set(dripId, [...(byDrip.get(dripId) ?? []), boardCup]);
        return;
      }
      if (dripId || ready) return;
      const key = [order.id, cup.item.id ?? cup.item.name, nominee ?? ""].join(
        "\u0000",
      );
      loose.set(key, [...(loose.get(key) ?? []), boardCup]);
    });
  }

  const cards: CaosCard[] = [];
  for (const cups of byDrip.values()) {
    const state = cups[0].state;
    const allReady = cups.every(
      (cup) => cup.readyAt !== null || cup.servedAt !== null,
    );
    const status: CaosCardStatus =
      state.dripper === null
        ? "unassigned"
        : state.brewFinishedAt || allReady
          ? "done"
          : state.brewStartedAt
            ? "brewing"
            : "queued";
    cards.push(makeCard(cups, status, state));
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

const UNASSIGNED_AFTER: CaosCupAfter = {
  dripper: null,
  dripper_position: null,
  drip_id: null,
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

export interface CaosAssignOptions {
  /** ドリッパーの待機の中の位置（0 始まり）。無ければ注文番号の順 */
  index?: number;
  /** 新しいカードの dripId を作る */
  newId: () => string;
}

/**
 * 割当・ドリッパーの移動・順番の入れ替え。未割当・待機のカードを dripper の待機に入れる。
 * ドリッパーに抽出中も待機も無ければ、そのまま抽出を始める（「始める」の印を送り、開始の時刻はサーバーが付ける）。
 */
export const assignWrites = (
  cards: readonly CaosCard[],
  card: CaosCard,
  dripper: number,
  { index, newId }: CaosAssignOptions,
): CaosWritesResult => {
  if (!CAOS_DRIPPER_IDS.includes(dripper))
    return { error: `ドリッパーは 1〜${CAOS_DRIPPERS} です` };
  if (card.status !== "unassigned" && card.status !== "queued")
    return { error: "抽出中・終了のカードは動かせません" };
  if (
    card.status === "queued" &&
    card.dripper === dripper &&
    index === undefined
  )
    return { writes: [] };
  const lane = caosLane(cards, dripper);
  const others = lane.queued.filter((other) => other.key !== card.key);
  const positions = others.map((other) => other.dripperPosition ?? 0);
  let position = card.orderNo;
  if (index !== undefined && positions.length > 0) {
    const i = Math.max(0, Math.min(index, positions.length));
    position =
      i === 0
        ? positions[0] - 1
        : i === positions.length
          ? positions[positions.length - 1] + 1
          : (positions[i - 1] + positions[i]) / 2;
  }
  return {
    writes: [
      writeOf(card, {
        dripper,
        dripper_position: position,
        drip_id: card.dripId ?? newId(),
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

/** 統合の相手を決めるキー（商品と指名）。1 杯のカードどうしで、このキーが同じなら統合できる */
export const caosMergeKey = (card: CaosCard) =>
  `${card.cups[0].item.id ?? card.cups[0].item.name}\u0000${card.cups[0].nominee ?? ""}`;

/** 統合できるか：1 杯どうしで、未割当どうし・待機どうし、同じ商品・同じ指名（caosMergeKey） */
export const canMergeCards = (a: CaosCard, b: CaosCard) =>
  a.key !== b.key &&
  a.status === b.status &&
  (a.status === "unassigned" || a.status === "queued") &&
  a.cups.length === 1 &&
  b.cups.length === 1 &&
  caosMergeKey(a) === caosMergeKey(b);

/**
 * 1 杯のカードどうしを 2 杯の同時抽出にまとめる。
 *   - 未割当どうし：両方のカップに新しい同じ dripId を入れる（ドリッパーにはまだ置かない）
 *   - 待機どうし：with のカップを card と同じ値にする（card のドリッパー・順番のまま）。card も変わっていないかを確かめる
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
    dripper_position: card.state.dripperPosition,
    drip_id: card.state.dripId,
    start_brew: false,
  };
  return { writes: [writeOf(card, after), writeOf(withCard, after)] };
};
