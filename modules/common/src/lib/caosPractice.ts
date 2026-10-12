import type { Cup, CupEmergency } from "../models/cup";
import {
  CAOS_MAX_CUPS,
  CAOS_NEXT_COOLDOWN_SEC,
  type CaosCard,
  type CaosCupState,
  type CaosCupsWrite,
  type CaosOrderInput,
  buildCaosCards,
  caosDripperError,
  caosLane,
  caosNextLocked,
  cupNeedsBrew,
} from "./caos-board";
import type { PracticeDataItemType } from "./caosPracticeData";

// CaOS の実データテスト（練習）の盤面。ブラウザの中だけで動かし、サーバー・本番の盤面・注文・在庫には触らない。
//
// 練習の盤面は、本番と同じ形の注文とカップ（CaosOrderInput。カップに dripper・dripperPosition・dripId・
// brewStartedAt・brewFinishedAt を持つ）で持つ。カードの組み立て（buildCaosCards）と、割当・移動・未割当に戻す・統合の
// 書き込み（assignWrites・unassignWrites・mergeWrites）は本番と同じ ./caos-board の関数を使い、
// 本番ならサーバーがする「書き込みを当てる」（番号を決める・後ろをずらす）と「次へ」だけをここで同じ決まりで行う
// （api/internal/handlers/caos.go の writeCups・placeCaosCups・advance と、同じ確かめ方・同じ理由の文。
// サーバーを使わずに練習するため、わざと 2 か所に持つ。決まりや文を変えるときは両方そろえること）。
// ドリッパーの列の分け方は、API の splitCaosLane と同じ結果になる本番の caosLane をそのまま使う。
//   - 抽出が要るかは本番と同じく種類の項目で決める（cupNeedsBrew）。練習には担当者がいないので、上級生のみのカードは（指名の無いカードも）どのドリッパーにも置ける
//   - 本番は今日（日本時間）の注文だけを見るが、練習の盤面は練習の時間帯の注文だけを持つので、日では絞らない
//   - 緊急（入れ直し）もカップの emergencies に持ち、カップと同じ決まりでカードに入る（足す・取り消すは api の cup_emergency.go と同じ決まり）
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
  /** 商品の種類の設定（注文したときの設定か、POS の今の種類から引いたもの）。無ければカップにしない */
  itemType?: PracticeDataItemType;
}

/** 練習に使う実データの注文（使う項目だけ） */
export interface CaosPracticeSourceOrder {
  orderId: number;
  /** 作成日時（ISO 8601） */
  createdAt: string;
  items: readonly CaosPracticeSourceItem[];
}

/**
 * 実データの注文を、練習の盤面の注文にする。カップを作る種類（itemType の makes_cup）の品物を 1 杯ずつカップにする（POS が注文を保存したときと同じ）。
 * 抽出の要らないカップ（ミルクなど）もカップにはなるが、本番と同じく buildCaosCards がカードにしない。
 * 指名は実データに無いので、どのカップも指名なし（明細の dripper・assignee は null）。ID は練習の中だけのもの
 */
export const toCaosPracticeOrder = (
  order: CaosPracticeSourceOrder,
  index: number,
): CaosPracticeOrder => {
  const id = `practice-${index}`;
  const cups: Cup[] = [];
  order.items.forEach((item, position) => {
    // 種類の設定が分からない品物は、ミルクやグッズを抽出の要るカップにしないよう、カップにしない
    const type = item.itemType;
    if (!type?.makes_cup) return;
    const cupId = `${id}-${position}`;
    cups.push({
      id: cupId,
      orderMenuId: cupId,
      item: {
        id: item.id || `name:${item.name}`,
        name: item.name,
        abbr: item.abbr || item.name,
        item_type: {
          name: item.type,
          display_name: type.display_name || item.type,
          makes_cup: type.makes_cup,
          needs_brew: type.needs_brew,
          senior_only: type.senior_only,
          iced_brew: false,
        },
      },
      readyAt: null,
      servedAt: null,
      dripper: null,
      dripperPosition: null,
      dripId: null,
      brewStartedAt: null,
      brewFinishedAt: null,
      emergencies: [],
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

// ---------------------------------------------------------------- カップの値

// 時刻はミリ秒までで比べる（サーバーの sameCaosState と同じ）
const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

const parseTime = (value: string | null) =>
  value === null ? null : new Date(value);

const stateOf = (before: CaosCupsWrite["before"]): CaosCupState => ({
  dripper: before.dripper,
  dripperPosition: before.dripper_position,
  dripId: before.drip_id,
  brewStartedAt: parseTime(before.brew_started_at),
  brewFinishedAt: parseTime(before.brew_finished_at),
});

const sameState = (a: CaosCupState, b: CaosCupState) =>
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
  const invalid = caosDripperError(after.dripper);
  if (invalid) return invalid;
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
    cups: order.cups.map((cup) => ({
      ...cup,
      emergencies: cup.emergencies.map((emergency) => ({ ...emergency })),
    })),
  }));

/** カードに入る 1 杯（サーバーの caosUnit）。row は CaOS の値を書く行（カップか入れ直し）、cup は入れ直したカップ（カップなら自分） */
interface PracticeUnit {
  row: Cup | CupEmergency;
  cup: Cup;
}

const allUnits = (orders: CaosPracticeOrder[]): PracticeUnit[] =>
  orders.flatMap((order) =>
    order.cups.flatMap((cup) => [
      { row: cup, cup },
      ...cup.emergencies.map((row) => ({ row, cup })),
    ]),
  );

const isEmergency = (unit: PracticeUnit) => unit.row !== unit.cup;

// ---------------------------------------------------------------- 書き込みを当てる（PUT /api/caos/cups と同じ）

/**
 * 書くカップを置く番号を決める（サーバーの placeCaosCups）。番号をずらすときは、ここで後ろのカップを +1 する。
 *   - drip_id がほかのカップ（この書き込みに入っていないもの）と同じなら、そのカードに入る（統合）。番号と抽出の開始の時刻はそのカードと同じ。ずらさない。
 *     終わったカードには入れない
 *   - insert_before が無ければ最後：そのドリッパーの終わっていないカップの最大＋1（無ければ 1）。ずらさない
 *   - insert_before があれば、そのカード（そのドリッパーの待機）の番号 p に入れる。番号が p 以上の終わっていないカップを全部 +1 する
 */
const placeCups = (
  orders: CaosPracticeOrder[],
  write: CaosCupsWrite,
  dripper: number,
):
  | { position: number; startedAt: Date | null; error?: undefined }
  | { error: string } => {
  const writing = new Set(write.cup_ids);
  const cups = allUnits(orders)
    .map((unit) => unit.row)
    .filter((cup) => !writing.has(cup.id));
  const joined = cups.find((cup) => cup.dripId === write.after.drip_id);
  if (joined) {
    if (write.after.insert_before !== null)
      return {
        error: "ほかのカードに入れるときは、前に入れるカードは決められません",
      };
    if (joined.brewFinishedAt !== null)
      return { error: "終わったカードには入れられません" };
    if (joined.dripperPosition === null)
      return { error: "同じカードのカップは全部いっしょに動かしてください" };
    return {
      position: joined.dripperPosition,
      startedAt: joined.brewStartedAt,
    };
  }

  const lane = cups.filter(
    (cup) => cup.dripper === dripper && cup.brewFinishedAt === null,
  );
  if (write.after.insert_before === null)
    return {
      position: Math.max(0, ...lane.map((cup) => cup.dripperPosition ?? 0)) + 1,
      startedAt: null,
    };

  const p = lane.find(
    (cup) =>
      cup.dripId === write.after.insert_before &&
      cup.brewStartedAt === null &&
      cup.dripperPosition !== null,
  )?.dripperPosition;
  if (p == null)
    return {
      error:
        "前に入れるカードが、そのドリッパーの待機にありません（ほかの端末で動いたかもしれません）",
    };
  for (const cup of lane) {
    if (cup.dripperPosition !== null && cup.dripperPosition >= p)
      cup.dripperPosition += 1;
  }
  return { position: p, startedAt: null };
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
  for (const write of writes) {
    const before = stateOf(write.before);
    const cups: (Cup | CupEmergency)[] = [];
    for (const id of write.cup_ids) {
      const unit = allUnits(next).find((unit) => unit.row.id === id);
      if (!unit)
        return {
          error: "カップが消えました（注文が編集・削除されたかもしれません）",
        };
      const cup = unit.row;
      if (!sameState(cup, before))
        return {
          error: "ほかの端末で先に変わりました。もう一度操作してください",
        };
      // 抽出中・終わりのカードは動かさない（終えるのは「次へ」）
      if (before.brewStartedAt !== null || before.brewFinishedAt !== null)
        return { error: "抽出中・終わりのカードは動かせません" };
      if (
        (write.after.dripper !== null || write.after.drip_id !== null) &&
        !cupNeedsBrew(unit.cup)
      )
        return {
          error: `抽出の要らないカップ（${unit.cup.item.name}）はドリッパーに置けません`,
        };
      cups.push(cup);
    }
    const dripper = write.after.dripper;
    // 抽出を始められるのは、空いている（このカードのほかに抽出中・待機のカードが無い）ドリッパーに置くときだけ（API の requireCaosDripperFree と同じ）
    if (write.after.start_brew && dripper !== null) {
      const lane = caosLane(buildCaosCards(next), dripper);
      const written = (card: CaosCard) =>
        card.cups.every((cup) => write.cup_ids.includes(cup.id));
      if (lane.brewing && !written(lane.brewing))
        return { error: `${dripper} 番のドリッパーはもう抽出中です` };
      if (lane.queued.some((card) => !written(card)))
        return {
          error: `${dripper} 番のドリッパーには待機のカードがあるので、抽出は「次へ」で待機の先頭から始めてください`,
        };
    }
    let position: number | null = null;
    let startedAt = write.after.start_brew ? new Date(now) : null;
    if (dripper !== null) {
      const placed = placeCups(next, write, dripper);
      if (placed.error !== undefined) return { error: placed.error };
      position = placed.position;
      startedAt = startedAt ?? placed.startedAt;
    }
    for (const cup of cups) {
      cup.dripper = dripper;
      cup.dripperPosition = position;
      cup.dripId = write.after.drip_id;
      cup.brewStartedAt = startedAt;
      cup.brewFinishedAt = null;
    }
    if (write.after.drip_id !== null) touched.add(write.after.drip_id);
  }

  // 書いたカードの全部のカップ（書かなかったカップも含む）が同じ値で、最大 2 杯か。入れ直しは入れ直しどうしだけ
  for (const dripId of touched) {
    const units = allUnits(next).filter((unit) => unit.row.dripId === dripId);
    if (units.length > CAOS_MAX_CUPS)
      return { error: `1 枚のカードは ${CAOS_MAX_CUPS} 杯までです` };
    if (units.some((unit) => !sameState(unit.row, units[0].row)))
      return { error: "同じカードのカップは全部いっしょに動かしてください" };
    if (units.some((unit) => isEmergency(unit) !== isEmergency(units[0])))
      return {
        error: "緊急（入れ直し）と緊急でないカップは同じカードにできません",
      };
  }
  return { orders: next };
};

// ---------------------------------------------------------------- 「次へ」（POST /api/caos/drippers/{dripper}/next と同じ）

/**
 * 「次へ」。抽出中のカードを終え（終了の時刻を付け、そのカップを準備完了にする）、待機の先頭を始める。
 * seenDripId は画面が抽出中と見ているカード（無いと見ているなら null）。今と違えば断る。始めてから CAOS_NEXT_COOLDOWN_SEC 秒は断る。
 * 時刻は now（練習の時計の今）
 */
export const advanceCaosPracticeDripper = (
  orders: readonly CaosPracticeOrder[],
  dripper: number,
  seenDripId: string | null,
  now: Date,
): CaosPracticeResult => {
  const invalid = caosDripperError(dripper);
  if (invalid) return { error: invalid };
  const next = cloneOrders(orders);
  const { brewing: cur, queued } = caosLane(buildCaosCards(next), dripper);
  if (seenDripId !== null && (!cur || cur.dripId !== seenDripId))
    return {
      error:
        "このカードはもう終わっています（ほかの端末で「次へ」を押したかもしれません）",
    };
  if (seenDripId === null && cur)
    return { error: "抽出中のカードがあります（画面が古いかもしれません）" };
  if (caosNextLocked(cur, now.getTime()))
    return {
      error: `始めてから ${CAOS_NEXT_COOLDOWN_SEC} 秒は「次へ」を押せません`,
    };
  const head = queued[0];
  if (!cur && !head)
    return { error: "このドリッパーには抽出中・待機のカードがありません" };

  // 終えるカードのカップ（入れ直しは入れ直したカップ）を準備完了にする
  for (const { row, cup } of allUnits(next)) {
    if (cur && row.dripId === cur.dripId) {
      cup.readyAt = cup.readyAt ?? new Date(now);
      row.brewFinishedAt = new Date(now);
    }
    if (head && row.dripId === head.dripId) row.brewStartedAt = new Date(now);
  }
  return { orders: next };
};

// ---------------------------------------------------------------- 緊急（POST・DELETE /api/cup-emergencies と同じ）

/** 入れ直す理由の長さ（文字。API と同じ） */
const EMERGENCY_REASON_MAX = 100;

/**
 * 緊急（入れ直し）を足す。1 杯につき入れ直しを 1 つ（同じカップに何度でも）、理由は前後の空白を除いて付ける。足した時刻は now（練習の時計の今）。
 * ids は足した入れ直しの id（cupIds と同じ順。newId で作る）
 */
export const addCaosPracticeEmergencies = (
  orders: readonly CaosPracticeOrder[],
  cupIds: readonly string[],
  reason: string,
  now: Date,
  newId: () => string,
): { orders: CaosPracticeOrder[]; ids: string[] } | { error: string } => {
  if (cupIds.length === 0 || new Set(cupIds).size !== cupIds.length)
    return {
      error: "order_cup_ids は空にせず、同じカップを 2 回入れないでください",
    };
  const trimmed = reason.trim();
  if ([...trimmed].length > EMERGENCY_REASON_MAX)
    return { error: `理由は ${EMERGENCY_REASON_MAX} 文字までです` };
  const next = cloneOrders(orders);
  const ids: string[] = [];
  for (const id of cupIds) {
    const cup = next.flatMap((order) => order.cups).find((c) => c.id === id);
    if (!cup)
      return {
        error: "カップが消えました（注文が編集・削除されたかもしれません）",
      };
    if (!cupNeedsBrew(cup))
      return {
        error: `抽出の要らないカップ（${cup.item.name}）は入れ直せません`,
      };
    const emergency: CupEmergency = {
      id: newId(),
      createdAt: new Date(now),
      reason: trimmed,
      dripper: null,
      dripperPosition: null,
      dripId: null,
      brewStartedAt: null,
      brewFinishedAt: null,
    };
    cup.emergencies.push(emergency);
    ids.push(emergency.id);
  }
  return { orders: next, ids };
};

/** 緊急（入れ直し）を取り消す。まだ抽出を始めていない（未割当か待機の）入れ直しだけ */
export const cancelCaosPracticeEmergency = (
  orders: readonly CaosPracticeOrder[],
  id: string,
): CaosPracticeResult => {
  const next = cloneOrders(orders);
  const cup = next
    .flatMap((order) => order.cups)
    .find((c) => c.emergencies.some((e) => e.id === id));
  const emergency = cup?.emergencies.find((e) => e.id === id);
  if (!cup || !emergency)
    return {
      error:
        "入れ直しが見つかりません（ほかの端末で取り消したか、注文が編集・削除されたかもしれません）",
    };
  if (emergency.brewStartedAt !== null)
    return { error: "抽出を始めた入れ直しは取り消せません" };
  cup.emergencies = cup.emergencies.filter((e) => e !== emergency);
  return { orders: next };
};
