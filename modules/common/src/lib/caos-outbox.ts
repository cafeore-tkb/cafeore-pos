import type { CupEmergency } from "../models/cup";
import type { components } from "../types/api";
import {
  type CaosCupState,
  type CaosCupsWrite,
  type CaosOrderInput,
  buildCaosCards,
  caosLane,
  caosStateFromJSON,
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
//   - つながらない・時間切れ・5xx：間をあけて何度でも送り直す（後ろの操作は待つ）。送れたかもしれないので、次は「もうそうなっているか」も見る
//   - 409（ほかの端末が先に変えた）：少し待ってサーバーの今で確かめ直し、カードの場所が同じならその値でもう一度送る。もうそうなっていれば済み。
//     それでも合わなければ捨てる（盤面はサーバーの今に戻る）
//   - 400 など（決まりに合わない）：送り直さずに捨てる
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
  /** 担当者の交代 */
  | { kind: "lane"; dripper: number; name: string; senior: boolean }
  /** 担当者の入れ替え。names は押したときの first・second の担当者 */
  | { kind: "swap"; first: number; second: number; names: [string, string] }
  /** 今の担当者の上級生かだけを直す */
  | { kind: "seniors"; lanes: LaneAssignment[] };

/** 端末に残した操作。label は「1つ戻す」と同じ操作の名前（捨てたときの知らせに出す）。sent は送れて、サーバーの盤面が届くのを待っている */
export interface CaosOutboxEntry {
  id: string;
  /** 押した時刻（エポックのミリ秒）。この順に送る */
  at: number;
  label: string;
  op: CaosOutboxOp;
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

const KINDS = new Set<CaosOutboxOp["kind"]>([
  "cups",
  "next",
  "undo",
  "cancel-emergency",
  "lane",
  "swap",
  "seniors",
]);

const date = (value: unknown) =>
  typeof value === "string" ? new Date(value) : null;

/** 端末に残した操作を読む（壊れたもの・ほかが書いたものは null）。「1つ戻す」の時刻を Date に戻す */
export const parseCaosOutboxEntry = (
  id: string,
  value: unknown,
): CaosOutboxEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const { at, label, op, sent } = value as Record<string, unknown>;
  if (typeof at !== "number" || typeof label !== "string") return null;
  if (typeof op !== "object" || op === null) return null;
  const kind = (op as { kind?: unknown }).kind;
  if (!KINDS.has(kind as CaosOutboxOp["kind"])) return null;
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
  return { id, at, label, op: parsed, ...(sent === true && { sent }) };
};

// ---------------------------------------------------------------- 盤面に重ねる

const CHANGED = "ほかの端末で先に変わりました";
const CUP_GONE = "カップが消えました（注文が編集・削除されたかもしれません）";

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

// サーバーの POST /api/caos/undo と同じく、カップを restore の値（CaOS の列と準備完了）に書き戻す
const applyUndoCups = (
  orders: readonly CaosPracticeOrder[],
  cups: readonly UndoCupJSON[],
): CaosPracticeResult => {
  const restore = new Map(cups.map((cup) => [cup.cup_id, cup.restore]));
  const restored = <R extends Row>(row: R) => {
    const json = restore.get(row.id);
    return json ? { ...row, ...caosStateFromJSON(json.state) } : row;
  };
  return {
    orders: orders.map((order) => ({
      ...order,
      cups: order.cups.map((cup) => {
        const json = restore.get(cup.id);
        return {
          ...restored(cup),
          readyAt: json ? date(json.ready_at) : cup.readyAt,
          emergencies: cup.emergencies.map(restored),
        };
      }),
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
      const request = caosUndoCups(op.entry, buildCaosCards(orders));
      if ("error" in request) return { error: request.error };
      return applyUndoCups(orders, request.cups);
    }
    case "cancel-emergency":
      return cancelCaosPracticeEmergency(orders, op.id);
    default:
      return { orders: [...orders] };
  }
};

/** 盤面の注文の写し（OrderEntity は getter で持つので、当てる関数が写せる形にする） */
export const plainCaosOrders = (
  orders: readonly CaosOrderInput[],
): CaosPracticeOrder[] =>
  orders.map(({ id, orderId, createdAt, menus, cups }) => ({
    id,
    orderId,
    createdAt,
    menus,
    cups: [...cups],
  }));

/** その日（day。日本時間の YYYY-MM-DD）の注文。サーバーは今日の注文のカップで番号・抽出中を決めるので、重ねるのも送るのもその日の注文で見る */
export const caosDayOrders = <O extends CaosOrderInput>(
  orders: readonly O[],
  day: string,
) => orders.filter((order) => jstDate(order.createdAt.getTime()) === day);

/** サーバーから届いた注文のうちその日のもの（caosDayOrders）に、残っている操作を古い順に重ねる。重ねられない操作は飛ばす */
export const overlayCaosOrders = (
  orders: readonly CaosOrderInput[],
  entries: readonly CaosOutboxEntry[],
  day: string,
): readonly CaosOrderInput[] =>
  entries.reduce<readonly CaosOrderInput[]>(
    (current, { op, at }) =>
      applyCaosOutboxOp(plainCaosOrders(current), op, new Date(at), {
        cooldown: false,
      }).orders ?? current,
    caosDayOrders(orders, day),
  );

/** 今日の担当者（todaysCaosLanes）に、残っている担当者の操作を古い順に重ねる */
export const overlayCaosLanes = (
  lanes: readonly CaosLane[],
  entries: readonly CaosOutboxEntry[],
): CaosLane[] =>
  entries.reduce<CaosLane[]>(
    (current, { op }) => {
      const set = (dripper: number, name: string, senior: boolean) =>
        current.map((lane) =>
          lane.dripper === dripper
            ? { ...lane, name, senior: senior && name !== "" }
            : lane,
        );
      switch (op.kind) {
        case "lane":
          return set(op.dripper, op.name, op.senior);
        case "swap": {
          const first = current.find((lane) => lane.dripper === op.first);
          const second = current.find((lane) => lane.dripper === op.second);
          if (!first || !second) return current;
          return set(op.first, second.name, second.senior).map((lane) =>
            lane.dripper === op.second
              ? { ...lane, name: first.name, senior: first.senior }
              : lane,
          );
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
  | { conflict: string };

// サーバーの盤面がもうその書き込みのあとか（送れたが返事が届かなかった・ほかの端末が同じことをした）
const writesReflected = (
  orders: readonly CaosOrderInput[],
  writes: readonly CaosCupsWrite[],
) => {
  const rows = rowsOf(orders);
  return writes.every(({ cup_ids, after }) =>
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
};

/**
 * 送る直前に、サーバーの今の盤面（server）で送るものを作る。もうそうなっていれば done、合わなければ conflict（理由）。
 * attempted は前に送って返事が無かった（サーバーには届いたかもしれない）
 */
export const prepareCaosOutboxOp = (
  op: CaosOutboxOp,
  server: CaosServerState,
  attempted: boolean,
): Prepared => {
  switch (op.kind) {
    case "cups": {
      const rebased = rebaseWrites(server.orders, op.writes);
      if ("writes" in rebased) return { request: { kind: "cups", ...rebased } };
      if (writesReflected(server.orders, op.writes)) return { done: true };
      return { conflict: rebased.error };
    }
    case "next": {
      const cards = buildCaosCards(server.orders);
      const status = (id: string | null) =>
        cards.find((card) => card.dripId === id)?.status;
      const finished = op.dripId === null || status(op.dripId) === "done";
      const started =
        op.startId === null ||
        status(op.startId) === "brewing" ||
        status(op.startId) === "done";
      if (finished && started) return { done: true };
      return { request: op };
    }
    case "undo": {
      const request = caosUndoCups(op.entry, buildCaosCards(server.orders));
      if ("cups" in request) return { request: { kind: "undo", ...request } };
      // カップが前の値のまま：送ったなら戻せている。まだなら、戻す操作の結果が届くのを待つ
      if (request.arriving && attempted) return { done: true };
      return { conflict: request.error };
    }
    case "cancel-emergency":
      return rowsOf(server.orders).has(op.id)
        ? { request: op }
        : { done: true };
    case "swap": {
      const name = (dripper: number) =>
        server.lanes?.lanes.find((lane) => lane.dripper === dripper)?.name;
      const [first, second] = op.names;
      return name(op.first) === second && name(op.second) === first
        ? { done: true }
        : { request: op };
    }
    default:
      return { request: op };
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
  // stop のあとは、送っている途中のものの結果を受けたら止まる（次に kick するまで）
  const stopped = false;
  const timeout = new Promise<CaosOutboxResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ error: "返事がありません" }),
      CAOS_OUTBOX_TIMEOUT_MS,
    );
  });
  return Promise.race([sending, timeout]).finally(() => clearTimeout(timer));
};

/** 送れたあと、サーバーの盤面が届くのを待つ長さ（届かなくても、これを過ぎたら次を送る） */
export const CAOS_OUTBOX_ECHO_MS = 5_000;
/** 返事を待つ長さ。過ぎたら送れなかったとみて送り直す */
export const CAOS_OUTBOX_TIMEOUT_MS = 10_000;
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
  read: () => CaosOutboxEntry[];
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
      attempted: boolean;
      retryAt: number;
      sentAt?: number;
      snapshot?: Snapshot;
    }
  >();
  const memoOf = (id: string) => {
    let m = memo.get(id);
    if (!m) {
      m = { failures: 0, conflicts: 0, attempted: false, retryAt: 0 };
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
        // 送れたもの。サーバーの盤面が届くまで（ECHO_MS まで）は重ねたままにし、次を送らない
        const waitMs = (m.sentAt ?? 0) + CAOS_OUTBOX_ECHO_MS - now();
        if (m.snapshot && waitMs > 0 && !arrived(m.snapshot, state))
          return later(waitMs);
        finish(head);
        continue;
      }
      if (m.retryAt > now()) return later(m.retryAt - now());
      const prepared = prepareCaosOutboxOp(head.op, state, m.attempted);
      if ("done" in prepared) {
        finish(head);
        continue;
      }
      if ("conflict" in prepared) {
        conflicted(head, prepared.conflict);
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
          m.attempted = true;
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
