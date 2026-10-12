import type { CupEmergency } from "../models/cup";
import { dripperLabel } from "../models/dripper";
import type { components } from "../types/api";
import {
  CAOS_NEXT_COOLDOWN_SEC,
  type CaosCupState,
  type CaosCupsWrite,
  type CaosOrderInput,
  buildCaosCards,
  caosDayOrders,
  caosLane,
  caosStateJSON,
} from "./caos-board";
import { type CaosUndoEntry, caosUndoCups } from "./caos-undo";
import type { CaosLane, CaosLanes, LaneAssignment } from "./caosLanes";
import {
  type CaosPracticeOrder,
  type CaosPracticeResult,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  cancelCaosPracticeEmergency,
} from "./caosPractice";
import { jstDate } from "./jst";

// CaOS の盤面の操作を「画面を先に動かし、書き込みは後ろで送る」ための決まり。
//
// 画面は操作を押したら、その操作（CaosOutboxOp）を端末に残し（送れていない書き込み）、
// サーバーから届いた盤面（共有の WebSocket の注文と担当者）に残っている操作を古い順に重ねて出す（overlayCaosOrders・overlayCaosLanes）。
// 重ねるのは、サーバーの決まりをブラウザで行う実データテストの関数（applyCaosPracticeWrites など）。抽出の始めた時刻は押した時刻（端末の今）で、
// サーバーの値が届いたら差し替わる。重ねられなくなった操作（サーバーの盤面がもうその操作のあと・ほかの端末が先に変えた）は重ねない。
//
// 送るのは 1 つずつ、残した順（createCaosOutbox）。送る直前に、書く前の値（before）をサーバーの今の値に差し替える（rebase）。
// 順番の数・時刻はサーバーが決めるので、画面が先に重ねた値とずれても、カードの場所（ドリッパー・カード・抽出中か・終わりか）が同じなら送る。
//   - 通った（204）：サーバーから盤面が届くまで（ECHO_MS まで）は重ね続け、届いたら消して次を送る（一瞬前に戻って見えないように）
//   - つながらない・時間切れ・5xx・ログインが切れた・混んでいる（401・403・408・429）：間をあけて何度でも送り直す（後ろの操作は待つ）。送れたかもしれないので、次は「もうそうなっているか」も見る
//   - 409（ほかの端末が先に変えた）：少し待ってサーバーの今で確かめ直し、カードの場所が同じならその値でもう一度送る。もうそうなっていれば済み。
//     それでも合わなければ捨てる（盤面はサーバーの今に戻る）
//   - 400 など、ほかの 4xx（決まりに合わない）：送り直さずに捨てる
// 捨てたら onRejected で何が戻ったかを知らせる。

type UndoCupJSON = components["schemas"]["CaosUndoCup"];

/** 盤面を書き換える操作 1 つ（端末に残す。JSON にできる形） */
export type CaosOutboxOp =
  /** PUT /api/caos/cups（割当・移動・先頭へ・未割当に戻す・統合・外す・まとめて移す） */
  | { kind: "cups"; writes: CaosCupsWrite[] }
  /** 「次へ」。dripId は終えるカード、startId は始めるはずの待機の先頭（押したときの盤面） */
  | {
      kind: "next";
      dripper: number;
      dripId: string | null;
      startId: string | null;
    }
  /** 「1つ戻す」（POST /api/caos/undo）。送る直前にサーバーの今の値で作る */
  | { kind: "undo"; entry: CaosUndoEntry }
  /** 緊急（入れ直し）の取り消し */
  | { kind: "cancel-emergency"; id: string }
  /** 担当者の交代。before は押したときの担当者（前の版で残したものには無いので、確かめずに送る） */
  | {
      kind: "lane";
      dripper: number;
      name: string;
      senior: boolean;
      before?: string;
    }
  /** 担当者の入れ替え。names は押したときの first・second の担当者 */
  | { kind: "swap"; first: number; second: number; names: [string, string] }
  /** 今の担当者の上級生かだけを直す */
  | { kind: "seniors"; lanes: LaneAssignment[] };

/** 端末に残した操作。label は「1つ戻す」と同じ操作の名前（捨てたときの知らせに出す） */
export interface CaosOutboxEntry {
  id: string;
  /** 押した時刻（エポックのミリ秒）。この順に送る。前の日に押したものは重ねも送りもしない */
  at: number;
  label: string;
  op: CaosOutboxOp;
  /** 送ったが返事が無かった（サーバーには届いたかもしれない） */
  attempted?: true;
  /** 送れて、サーバーの盤面が届くのを待っている */
  sent?: true;
}

/** 送るもの（undo はサーバーの今の値で作ったカップ） */
export type CaosOutboxRequest =
  | Exclude<CaosOutboxOp, { kind: "undo" }>
  | { kind: "undo"; cups: UndoCupJSON[] };

/** 送った結果（@cafeore/common の repositories/caos の結果。status は HTTP のステータス、つながらなければ無い） */
export type CaosOutboxResult = { error?: string; status?: number };

/** サーバーから届いた盤面。WebSocket がつながって注文が届いていなければ null（送らずに待つ） */
export interface CaosServerState {
  /** 今日の注文（caosDayOrders） */
  orders: readonly CaosOrderInput[];
  lanes: CaosLanes | null;
}

// 操作の形（kind ごとの欠かせない項目）。壊れたもの・形の違うものは読まない（重ねるときに落ちないように）
const SHAPES: Record<
  CaosOutboxOp["kind"],
  (op: Record<string, unknown>) => boolean
> = {
  cups: (op) => Array.isArray(op.writes),
  next: (op) =>
    typeof op.dripper === "number" && "dripId" in op && "startId" in op,
  undo: (op) => Array.isArray((op.entry as { cups?: unknown } | null)?.cups),
  "cancel-emergency": (op) => typeof op.id === "string",
  lane: (op) =>
    typeof op.dripper === "number" &&
    typeof op.name === "string" &&
    typeof op.senior === "boolean" &&
    (op.before === undefined || typeof op.before === "string"),
  swap: (op) =>
    typeof op.first === "number" &&
    typeof op.second === "number" &&
    Array.isArray(op.names),
  seniors: (op) => Array.isArray(op.lanes),
};

const date = (value: unknown) =>
  typeof value === "string" ? new Date(value) : null;

/** 端末に残した操作を読む（壊れたもの・ほかが書いたものは null）。「1つ戻す」の時刻を Date に戻す */
export const parseCaosOutboxEntry = (
  id: string,
  value: unknown,
): CaosOutboxEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const { at, label, op, attempted, sent } = value as Record<string, unknown>;
  if (typeof at !== "number" || typeof label !== "string") return null;
  if (typeof op !== "object" || op === null) return null;
  const kind = (op as { kind?: unknown }).kind;
  if (
    typeof kind !== "string" ||
    !Object.hasOwn(SHAPES, kind) ||
    !SHAPES[kind as CaosOutboxOp["kind"]](op as Record<string, unknown>)
  )
    return null;
  let parsed = op as CaosOutboxOp;
  if (parsed.kind === "undo") {
    parsed = {
      kind: "undo",
      entry: {
        cups: parsed.entry.cups.map((cup) => ({
          ...cup,
          restore: {
            ...cup.restore,
            brewStartedAt: date(cup.restore.brewStartedAt),
            brewFinishedAt: date(cup.restore.brewFinishedAt),
            readyAt: date(cup.restore.readyAt),
          },
        })),
      },
    };
  }
  return {
    id,
    at,
    label,
    op: parsed,
    ...(attempted === true && { attempted }),
    ...(sent === true && { sent }),
  };
};

// ---------------------------------------------------------------- 盤面に重ねる

const CHANGED = "ほかの端末で先に変わりました";
const CUP_GONE = "カップが消えました（注文が編集・削除されたかもしれません）";
const laneTaken = (dripper: number) =>
  `${dripperLabel(dripper)} の交代は、ほかの iPad が先に替えていたので取りやめました`;

type Row = Pick<CupEmergency, "id"> & CaosCupState;

// カップと入れ直しの行（CaOS の値を書く行）を ID で引く
const rowsOf = (orders: readonly CaosOrderInput[]) =>
  new Map<string, Row>(
    orders.flatMap((order) =>
      order.cups.flatMap((cup) => [
        [cup.id, cup] as const,
        ...cup.emergencies.map((row) => [row.id, row] as const),
      ]),
    ),
  );

// カードの場所（ドリッパー・カード・抽出中か・終わりか）が同じか。順番の数と時刻はサーバーが決めるので比べない
const samePlace = (row: CaosCupState, before: CaosCupsWrite["before"]) =>
  row.dripper === before.dripper &&
  row.dripId === before.drip_id &&
  (row.brewStartedAt !== null) === (before.brew_started_at !== null) &&
  (row.brewFinishedAt !== null) === (before.brew_finished_at !== null);

/** 書き込みの before を orders の今の値にする。カードの場所が変わっていれば（ほかの端末が先に変えた）理由を返す */
const rebaseWrites = (
  orders: readonly CaosOrderInput[],
  writes: readonly CaosCupsWrite[],
): { writes: CaosCupsWrite[] } | { error: string } => {
  const rows = rowsOf(orders);
  const rebased: CaosCupsWrite[] = [];
  for (const write of writes) {
    const row = rows.get(write.cup_ids[0]);
    if (!row) return { error: CUP_GONE };
    if (!samePlace(row, write.before)) return { error: CHANGED };
    rebased.push({ ...write, before: caosStateJSON(row) });
  }
  return { writes: rebased };
};

type UndoRestore = Partial<CaosUndoEntry["cups"][number]["restore"]>;

// サーバーの POST /api/caos/undo と同じく、カップを操作の前の値（CaOS の列と、カップの準備完了）に書き戻す
const applyUndo = (
  orders: readonly CaosPracticeOrder[],
  entry: CaosUndoEntry,
): CaosPracticeResult => {
  const restore = new Map(entry.cups.map((cup) => [cup.id, cup.restore]));
  const restoreOf = (id: string): UndoRestore => restore.get(id) ?? {};
  return {
    orders: orders.map((order) => ({
      ...order,
      cups: order.cups.map((cup) => ({
        ...cup,
        ...restoreOf(cup.id),
        emergencies: cup.emergencies.map((row) => {
          const { readyAt: _, ...state } = restoreOf(row.id);
          return { ...row, ...state };
        }),
      })),
    })),
  };
};

/**
 * 操作を盤面（orders）に当てる。押したとき（決まりに合うかを先に確かめる）と、届いた盤面に重ねるときに使う。
 * at は押した時刻（抽出の始めた・終えた時刻の代わり）。cooldown は「次へ」の秒を見るか（重ねるときは見ない）。担当者の操作は orders を変えない
 */
export const applyCaosOutboxOp = (
  orders: readonly CaosPracticeOrder[],
  op: CaosOutboxOp,
  at: Date,
  { cooldown = true }: { cooldown?: boolean } = {},
): CaosPracticeResult => {
  switch (op.kind) {
    case "cups": {
      const rebased = rebaseWrites(orders, op.writes);
      if ("error" in rebased) return rebased;
      return applyCaosPracticeWrites(orders, rebased.writes, at);
    }
    case "next":
      return advanceCaosPracticeDripper(orders, op.dripper, op.dripId, at, {
        cooldown,
      });
    case "undo": {
      const blocked = caosUndoCups(op.entry, buildCaosCards(orders));
      if ("error" in blocked) return { error: blocked.error };
      return applyUndo(orders, op.entry);
    }
    case "cancel-emergency":
      return cancelCaosPracticeEmergency(orders, op.id);
    default:
      return { orders: [...orders] };
  }
};

/** 盤面の注文の写し（OrderEntity は getter で持つので、当てる関数が写せる形にする） */
const plainCaosOrders = (
  orders: readonly CaosOrderInput[],
): CaosPracticeOrder[] =>
  orders.map(({ id, orderId, createdAt, menus, cups }) => ({
    id,
    orderId,
    createdAt,
    menus,
    cups: [...cups],
  }));

/**
 * 押した操作（ops。続けて当てる）を今の盤面（orders）に当ててみる（applyCaosOutboxOp）。1 つでも合わなければ、その理由。
 * at は押した時刻
 */
export const applyCaosOutboxOps = (
  orders: readonly CaosOrderInput[],
  ops: readonly CaosOutboxOp[],
  at: Date,
): CaosPracticeResult => {
  let result: CaosPracticeResult = { orders: plainCaosOrders(orders) };
  for (const op of ops) {
    if (result.error !== undefined) break;
    result = applyCaosOutboxOp(result.orders, op, at);
  }
  return result;
};

/** サーバーから届いた注文のうちその日のもの（caosDayOrders）に、その日に押して残っている操作を古い順に重ねる。重ねられない操作は飛ばす */
export const overlayCaosOrders = (
  orders: readonly CaosOrderInput[],
  entries: readonly CaosOutboxEntry[],
  day: string,
): readonly CaosOrderInput[] => {
  const today = caosDayOrders(orders, day);
  const todays = entries.filter(({ at }) => jstDate(at) === day);
  if (todays.length === 0) return today;
  return todays.reduce(
    (current, { op, at }) =>
      applyCaosOutboxOp(current, op, new Date(at), { cooldown: false })
        .orders ?? current,
    plainCaosOrders(today),
  );
};

// 交代・入れ替えの、押したときの担当者（ドリッパーと名前）。サーバーはこの 2 つの書く前の値を確かめないので、当てる・送る前に画面が確かめる
const pressedLanes = (op: CaosOutboxOp): [number, string][] => {
  switch (op.kind) {
    case "lane":
      return op.before === undefined ? [] : [[op.dripper, op.before]];
    case "swap":
      return [
        [op.first, op.names[0]],
        [op.second, op.names[1]],
      ];
    default:
      return [];
  }
};

// 担当者（lanes）が押したときのままか。今日の担当者がまだ無ければ（サーバーは何も送らない）、どこも空き
const lanesKept = (lanes: readonly CaosLane[] | undefined, op: CaosOutboxOp) =>
  pressedLanes(op).every(
    ([dripper, name]) =>
      (lanes?.find((lane) => lane.dripper === dripper)?.name ?? "") === name,
  );

/** その日（day）の担当者（todaysCaosLanes）に、その日に押して残っている担当者の操作を古い順に重ねる */
export const overlayCaosLanes = (
  lanes: readonly CaosLane[],
  entries: readonly CaosOutboxEntry[],
  day: string,
): CaosLane[] =>
  entries.reduce<CaosLane[]>(
    (current, { op, at }) => {
      if (jstDate(at) !== day) return current;
      // 交代・入れ替えは、押したときの担当者のままのときだけ当てる（ほかの端末が先に替えた担当者を上書きしない・入れ替わった担当者を元に戻さない）
      if (!lanesKept(current, op)) return current;
      const laneOf = (dripper: number) =>
        current.find((lane) => lane.dripper === dripper);
      switch (op.kind) {
        case "lane":
          return current.map((lane) =>
            lane.dripper === op.dripper
              ? { ...lane, name: op.name, senior: op.senior }
              : lane,
          );
        case "swap": {
          const first = laneOf(op.first);
          const second = laneOf(op.second);
          const swapped = new Map([
            [op.first, second],
            [op.second, first],
          ]);
          return current.map((lane) => {
            const other = swapped.get(lane.dripper);
            return other
              ? { ...lane, name: other.name, senior: other.senior }
              : lane;
          });
        }
        case "seniors":
          return current.map((lane) => {
            const update = op.lanes.find(
              (u) => u.dripper === lane.dripper && u.name === lane.name,
            );
            return update ? { ...lane, senior: update.senior } : lane;
          });
        default:
          return current;
      }
    },
    [...lanes],
  );

// ---------------------------------------------------------------- 送る

type Prepared =
  | { request: CaosOutboxRequest }
  | { done: true }
  | { conflict: string }
  | { wait: number };

/** サーバーの盤面がもうその操作のあとか（送ったものが届いた・送れたが返事が届かなかった・ほかの端末が同じことをした） */
const reflected = (op: CaosOutboxOp, server: CaosServerState): boolean => {
  const laneOf = (dripper: number) =>
    server.lanes?.lanes.find((lane) => lane.dripper === dripper);
  switch (op.kind) {
    case "cups": {
      const rows = rowsOf(server.orders);
      return op.writes.every(({ cup_ids, after }) =>
        cup_ids.every((id) => {
          const row = rows.get(id);
          return (
            row !== undefined &&
            row.dripper === after.dripper &&
            row.dripId === after.drip_id &&
            (!after.start_brew || row.brewStartedAt !== null)
          );
        }),
      );
    }
    case "next": {
      const status = (id: string) =>
        buildCaosCards(server.orders).find((card) => card.dripId === id)
          ?.status;
      // 終えるカードがあれば、それが終わったか（待機の先頭はほかの端末が入れ替えたかもしれないので見ない）。無ければ始めるカードが始まったか
      if (op.dripId !== null) return status(op.dripId) === "done";
      return (
        op.startId === null ||
        status(op.startId) === "brewing" ||
        status(op.startId) === "done"
      );
    }
    case "undo": {
      // カップが全部操作の前の値
      const request = caosUndoCups(op.entry, buildCaosCards(server.orders));
      return "arriving" in request;
    }
    case "cancel-emergency":
      return !rowsOf(server.orders).has(op.id);
    case "lane": {
      const lane = laneOf(op.dripper);
      return lane?.name === op.name && lane.senior === op.senior;
    }
    case "swap":
      return (
        laneOf(op.first)?.name === op.names[1] &&
        laneOf(op.second)?.name === op.names[0]
      );
    case "seniors":
      return op.lanes.every(
        ({ dripper, name, senior }) =>
          laneOf(dripper)?.name !== name || laneOf(dripper)?.senior === senior,
      );
  }
};

/**
 * 送る直前に、サーバーの今の盤面（server）で送るものを作る。もうそうなっていれば done、合わなければ conflict（理由）、まだ送れなければ wait（待つミリ秒）。
 * attempted は前に送って返事が無かった（サーバーには届いたかもしれない）。nowMs は今（エポックのミリ秒）
 */
const prepareCaosOutboxOp = (
  op: CaosOutboxOp,
  server: CaosServerState,
  attempted: boolean,
  nowMs: number,
): Prepared => {
  switch (op.kind) {
    case "cups": {
      const rebased = rebaseWrites(server.orders, op.writes);
      if ("writes" in rebased) return { request: { kind: "cups", ...rebased } };
      return reflected(op, server)
        ? { done: true }
        : { conflict: rebased.error };
    }
    case "undo": {
      const request = caosUndoCups(op.entry, buildCaosCards(server.orders));
      if ("cups" in request) return { request: { kind: "undo", ...request } };
      // カップが前の値のまま：送ったなら戻せている。まだなら、戻す操作の結果が届くのを待つ
      if (request.arriving && attempted) return { done: true };
      return { conflict: request.error };
    }
    case "next": {
      if (reflected(op, server)) return { done: true };
      // サーバーの始めた時刻（送れずに遅れて始めたなら、押したときより後）から CAOS_NEXT_COOLDOWN_SEC 秒は断られるので、
      // それまで待つ（端末とサーバーの時計の差に 1 秒みておく）
      const { brewing } = caosLane(buildCaosCards(server.orders), op.dripper);
      const waitMs =
        brewing?.dripId === op.dripId && brewing.startedAt
          ? brewing.startedAt.getTime() +
            (CAOS_NEXT_COOLDOWN_SEC + 1) * 1000 -
            nowMs
          : 0;
      return waitMs > 0 ? { wait: waitMs } : { request: op };
    }
    case "lane":
    case "swap": {
      // 押したときの担当者のままのときだけ送る（ほかの端末が先に替えていれば捨てて、盤面はサーバーの今に戻る）
      if (reflected(op, server)) return { done: true };
      if (lanesKept(server.lanes?.lanes, op)) return { request: op };
      return { conflict: op.kind === "lane" ? laneTaken(op.dripper) : CHANGED };
    }
    default:
      return reflected(op, server) ? { done: true } : { request: op };
  }
};

// 送ったものの結果が届いたかを見るため、送る前のサーバーの値。WebSocket で変わった注文・担当者は新しいものに置き換わるので、置き換わったら届いた
type Snapshot =
  | { orders: (readonly [string, CaosOrderInput])[] }
  | { lanes: CaosLanes | null };

// 書くカップ（入れ直しも）の ID
const cupIdsOf = (request: CaosOutboxRequest, server: CaosServerState) => {
  switch (request.kind) {
    case "cups":
      return request.writes.flatMap((write) => write.cup_ids);
    case "undo":
      return request.cups.map((cup) => cup.cup_id);
    case "cancel-emergency":
      return [request.id];
    case "next": {
      const lane = caosLane(buildCaosCards(server.orders), request.dripper);
      return [lane.brewing, lane.queued[0]].flatMap(
        (card) => card?.cups.map((cup) => cup.id) ?? [],
      );
    }
    default:
      return null;
  }
};

const snapshotOf = (
  request: CaosOutboxRequest,
  server: CaosServerState,
): Snapshot => {
  const ids = cupIdsOf(request, server);
  if (!ids) return { lanes: server.lanes };
  const rows = new Set(ids);
  return {
    orders: server.orders
      .filter((order) =>
        order.cups.some(
          (cup) =>
            rows.has(cup.id) || cup.emergencies.some((e) => rows.has(e.id)),
        ),
      )
      .map((order) => [order.id, order] as const),
  };
};

const arrived = (snapshot: Snapshot, server: CaosServerState) =>
  "lanes" in snapshot
    ? snapshot.lanes !== server.lanes
    : snapshot.orders.every(
        ([id, order]) => server.orders.find((o) => o.id === id) !== order,
      );

// 返事を CAOS_OUTBOX_TIMEOUT_MS まで待つ
const withTimeout = (sending: Promise<CaosOutboxResult>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CaosOutboxResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ error: "返事がありません" }),
      CAOS_OUTBOX_TIMEOUT_MS,
    );
  });
  return Promise.race([sending, timeout]).finally(() => clearTimeout(timer));
};

/** 送れたあと、サーバーの盤面が届くのを待つ長さ（届かなくても、これを過ぎたら次を送る） */
const CAOS_OUTBOX_ECHO_MS = 5_000;
/** 返事を待つ長さ。過ぎたら送れなかったとみて送り直す */
const CAOS_OUTBOX_TIMEOUT_MS = 10_000;
/** 409 のあと、サーバーの今で確かめ直すまで待つ長さと、確かめる回数 */
const CONFLICT_WAIT_MS = 1_000;
const CONFLICT_TRIES = 2;
/** 送り直す間隔（1 秒から倍にし、15 秒まで） */
const retryDelay = (failures: number) =>
  Math.min(15_000, 1_000 * 2 ** (failures - 1));

// 送り直す 4xx（ログインが切れた・時間切れ・混んでいる。直れば通る）
const RETRY_4XX = [401, 403, 408, 429];

/** 断られた（409 は確かめ直す、ほかの 4xx は捨てる）か、送れなかった（つながらない・時間切れ・5xx・RETRY_4XX。送り直す）か */
const outcomeOf = ({ error, status }: CaosOutboxResult) => {
  if (error === undefined) return "ok";
  if (status === 409) return "conflict";
  if (status !== undefined && status < 500 && !RETRY_4XX.includes(status))
    return "reject";
  return "retry";
};

/** 送る操作を置く所（端末の localStorage。読むと古い順） */
export interface CaosOutboxStore {
  read: () => readonly CaosOutboxEntry[];
  put: (entry: CaosOutboxEntry) => void;
  remove: (id: string) => void;
}

/**
 * 端末に残した操作を、古い順に 1 つずつ送る。kick で送り始める（残りが変わった・サーバーの盤面が届いた・つながった、のたびに呼ぶ）。
 * 待つあいだ（送り直しの間隔・盤面が届くのを待つ）は自分で kick し直す。retryNow は送り直しの間隔を待たずに送る。
 * send は送る関数（repositories/caos の sendCaosOutboxRequest）。onSent は通ったとき、onRejected は捨てたとき（reason は理由）
 */
export const createCaosOutbox = ({
  store,
  server,
  send,
  onSent,
  onRejected,
  now = Date.now,
}: {
  store: CaosOutboxStore;
  server: () => CaosServerState | null;
  send: (request: CaosOutboxRequest) => Promise<CaosOutboxResult>;
  onSent?: (entry: CaosOutboxEntry) => void;
  onRejected: (entry: CaosOutboxEntry, reason: string) => void;
  now?: () => number;
}) => {
  // 操作ごとの送り方（このタブのメモリ。再読み込みしたら、送れて待っていたものは消し、ほかは初めから）
  const memo = new Map<
    string,
    {
      failures: number;
      conflicts: number;
      retryAt: number;
      sentAt?: number;
      snapshot?: Snapshot;
    }
  >();
  const memoOf = (id: string) => {
    let m = memo.get(id);
    if (!m) {
      m = { failures: 0, conflicts: 0, retryAt: 0 };
      memo.set(id, m);
    }
    return m;
  };
  const finish = (entry: CaosOutboxEntry) => {
    memo.delete(entry.id);
    store.remove(entry.id);
  };
  const reject = (entry: CaosOutboxEntry, reason: string) => {
    finish(entry);
    onRejected(entry, reason);
  };
  // 409・合わなかったとき。まだ確かめ直せるなら少し待ち、もう確かめたなら捨てる
  const conflicted = (entry: CaosOutboxEntry, reason: string) => {
    const m = memoOf(entry.id);
    m.conflicts += 1;
    if (m.conflicts < CONFLICT_TRIES) m.retryAt = now() + CONFLICT_WAIT_MS;
    else reject(entry, reason);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  // stop のあとは、送っている途中のものの結果を受けたら止まる（次に kick するまで）
  let stopped = false;
  const later = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void kick(), Math.max(0, ms));
  };

  const drain = async () => {
    for (;;) {
      const head = store.read()[0];
      const state = server();
      if (stopped || !head || !state) return;
      const m = memoOf(head.id);
      if (head.sent) {
        // 送れたもの。その結果のサーバーの盤面が届くまで（ECHO_MS まで）は重ねたままにし、次を送らない。
        // 届いたかは、書いた注文・担当者が新しくなり（並べ替えは場所が変わらないので）、中身もそのとおりか（つなぎ直して全部届き直しただけでないか）で見る
        const waitMs = (m.sentAt ?? 0) + CAOS_OUTBOX_ECHO_MS - now();
        if (
          m.snapshot &&
          waitMs > 0 &&
          !(arrived(m.snapshot, state) && reflected(head.op, state))
        )
          return later(waitMs);
        finish(head);
        continue;
      }
      if (jstDate(head.at) !== jstDate(now())) {
        reject(head, "前の日に押した操作なので送りません");
        continue;
      }
      if (m.retryAt > now()) return later(m.retryAt - now());
      const prepared = prepareCaosOutboxOp(
        head.op,
        state,
        head.attempted === true,
        now(),
      );
      if ("done" in prepared) {
        finish(head);
        continue;
      }
      if ("conflict" in prepared) {
        conflicted(head, prepared.conflict);
        continue;
      }
      if ("wait" in prepared) {
        m.retryAt = now() + prepared.wait;
        continue;
      }
      const snapshot = snapshotOf(prepared.request, state);
      const result = await withTimeout(send(prepared.request));
      // 送っているあいだに消えた（ほかのタブが片付けた）
      if (!store.read().some((entry) => entry.id === head.id)) continue;
      switch (outcomeOf(result)) {
        case "ok":
          m.sentAt = now();
          m.snapshot = snapshot;
          store.put({ ...head, sent: true });
          onSent?.(head);
          break;
        case "retry":
          store.put({ ...head, attempted: true });
          m.failures += 1;
          m.retryAt = now() + retryDelay(m.failures);
          break;
        case "conflict":
          conflicted(head, result.error ?? CHANGED);
          break;
        default:
          reject(head, result.error ?? CHANGED);
      }
    }
  };

  let running: Promise<void> | null = null;
  let again = false;
  const kick = (): Promise<void> => {
    stopped = false;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await drain();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  return {
    kick,
    /** 送り直しの間隔を待たずに、今すぐ送る */
    retryNow: () => {
      for (const m of memo.values()) m.retryAt = 0;
      return kick();
    },
    /** 送るのをやめる（画面を閉じた・ほかのタブが送るようになったとき） */
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
};
