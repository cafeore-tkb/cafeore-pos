import type { Cup, CupEmergency } from "../models/cup";
import {
  CAOS_MAX_CUPS,
  CAOS_NEXT_COOLDOWN_SEC,
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
//   - 指名は実データの指名（明細の dripper・assignee）を本番と同じ形で持ち、本番と同じく指名の番号のドリッパーにしか置けず、違う番号のカップは 1 枚のカードにしない
//   - 本番は今日（日本時間）の注文だけを見るが、練習の盤面は練習の時間帯の注文だけを持つので、日では絞らない
//   - 緊急（入れ直し）もカップの emergencies に持ち、カップと同じ決まりでカードに入る（足す・取り消すは api の cup_emergency.go と同じ決まり）
// 時刻はサーバーの押した時刻の代わりに、練習の時計の今（now）を使う（本番の盤面に重ねるときは押した時刻。lib/caos-outbox.ts）。
// 抽出を始める・終える時刻は、サーバーと同じく同じドリッパーで前の抽出を終えた時刻より前にしない（brewAt）。

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
  /** 指名のドリッパーの番号（明細の dripper） */
  dripper?: number;
  /** 番号の無い指名の自由記述（明細の assignee） */
  assignee?: string;
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
 * カップごとに明細を 1 つ作り、品物の指名（dripper・assignee）を明細に入れる。ID は練習の中だけのもの
 */
export const toCaosPracticeOrder = (
  order: CaosPracticeSourceOrder,
  index: number,
): CaosPracticeOrder => {
  const id = `practice-${index}`;
  const cups: Cup[] = [];
  const menus: CaosPracticeOrder["menus"][number][] = [];
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
    menus.push({
      orderMenuId: cupId,
      dripper: item.dripper ?? null,
      assignee: item.assignee ?? null,
    });
  });
  return {
    id,
    orderId: order.orderId,
    createdAt: new Date(order.createdAt),
    menus,
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
    return "列の先頭に入れて始めるときは、前に入れるカードは決められません";
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

/**
 * カードに入る 1 杯（サーバーの caosUnit）。row は CaOS の値を書く行（カップか入れ直し）、cup は入れ直したカップ（カップなら自分）、
 * nominated は明細の指名の番号（入れ直しは入れ直したカップのもの。サーバーの caosNominations）
 */
interface PracticeUnit {
  row: Cup | CupEmergency;
  cup: Cup;
  nominated: number | null;
}

const allUnits = (orders: CaosPracticeOrder[]): PracticeUnit[] =>
  orders.flatMap((order) =>
    order.cups.flatMap((cup) => {
      const nominated =
        order.menus.find((menu) => menu.orderMenuId === cup.orderMenuId)
          ?.dripper ?? null;
      return [
        { row: cup, cup, nominated },
        ...cup.emergencies.map((row) => ({ row, cup, nominated })),
      ];
    }),
  );

const isEmergency = (unit: PracticeUnit) => unit.row !== unit.cup;

/** ドリッパーで抽出を始める・終える時刻（サーバーの caosBrewAt）。now が、同じドリッパーでいちばん遅く終えた抽出より前なら、その終えた時刻 */
const brewAt = (orders: CaosPracticeOrder[], dripper: number, now: Date) =>
  new Date(
    Math.max(
      now.getTime(),
      ...allUnits(orders).flatMap(({ row }) =>
        row.dripper === dripper && row.brewFinishedAt
          ? [row.brewFinishedAt.getTime()]
          : [],
      ),
    ),
  );

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
 * 番号はサーバーと同じ決まりでここで決める。抽出を始める書き込みの開始の時刻は now（練習の時計の今。brewAt）
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

  // 抽出を始めるドリッパー。抽出中が無く待機のある列は、待機の先頭を飛ばさず「次へ」で始める（サーバーの requireCaosStartable）
  const starting = new Set(
    writes.flatMap(({ after }) =>
      after.start_brew && after.dripper !== null ? [after.dripper] : [],
    ),
  );
  for (const dripper of starting) {
    const lane = caosLane(buildCaosCards(orders), dripper);
    if (
      !lane.brewing &&
      lane.queued.some((card) => card.cups.some((cup) => !seen.has(cup.id)))
    )
      return {
        error: `${dripper} 番のドリッパーには待機のカードがあるので、抽出は「次へ」で待機の先頭から始めてください`,
      };
  }

  const next = cloneOrders(orders);
  const touched = new Set<string>();
  for (const write of writes) {
    const before = stateOf(write.before);
    const cups: (Cup | CupEmergency)[] = [];
    let ready = true;
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
      // 入れ直しは準備完了を持たない（サーバーの caosUnits）
      ready &&= !isEmergency(unit) && unit.cup.readyAt !== null;
      if (
        (write.after.dripper !== null || write.after.drip_id !== null) &&
        !cupNeedsBrew(unit.cup)
      )
        return {
          error: `抽出の要らないカップ（${unit.cup.item.name}）はドリッパーに置けません`,
        };
      if (
        write.after.dripper !== null &&
        unit.nominated !== null &&
        unit.nominated !== write.after.dripper
      )
        return {
          error: `指名のあるカップは ${unit.nominated} 番のドリッパーにしか置けません`,
        };
      cups.push(cup);
    }
    // 終わったカードは動かさない（終えるのは「次へ」）。抽出中のカードは動かせるが、ほかのカードには統合せず、分けない（サーバーの checkCaosStartedMove）
    if (before.brewStartedAt !== null) {
      if (before.brewFinishedAt !== null || ready)
        return { error: "終わったカードは動かせません" };
      if (write.after.drip_id !== null && write.after.drip_id !== before.dripId)
        return {
          error:
            "抽出中のカードの drip_id は変えられません（ほかのカードに統合もできません）",
        };
      if (
        allUnits(next).some(
          (unit) =>
            unit.row.dripId === before.dripId &&
            !write.cup_ids.includes(unit.row.id),
        )
      )
        return {
          error:
            "抽出中のカードは分けられません（カップを全部いっしょに動かしてください）",
        };
    }
    const dripper = write.after.dripper;
    let position: number | null = null;
    let startedAt =
      write.after.start_brew && dripper !== null
        ? brewAt(next, dripper, now)
        : null;
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

  // 書いたカードの全部のカップ（書かなかったカップも含む）が同じ値・同じ指名で、最大 2 杯か。入れ直しは入れ直しどうしだけ
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
    // 指名なしのカップは、どの番号のカップとも同じカードにできる（サーバーの checkCaosCardNomination は番号の種類を数える）
    const nominations = units.flatMap((unit) => unit.nominated ?? []);
    if (new Set(nominations).size > 1)
      return { error: "指名の違うカップは同じカードにできません" };
  }
  // 抽出を始めたドリッパーで、抽出中は 1 枚だけ（サーバーの caosBrewingTwice）
  const cards = buildCaosCards(next);
  for (const dripper of starting) {
    if (
      cards.filter(
        (card) => card.dripper === dripper && card.status === "brewing",
      ).length > 1
    )
      return { error: `${dripper} 番のドリッパーはもう抽出中です` };
  }
  return { orders: next };
};

// ---------------------------------------------------------------- 「次へ」（POST /api/caos/drippers/{dripper}/next と同じ）

/**
 * 「次へ」。抽出中のカードを終え（終了の時刻を付ける。カップの準備完了は付けない）、待機の先頭を始める（startNext が false なら終えるだけ）。
 * seenDripId は画面が抽出中と見ているカード（無いと見ているなら null）。今と違えば断る。始めてから CAOS_NEXT_COOLDOWN_SEC 秒は断る。
 * 時刻は now（練習の時計の今。終える・始める時刻は brewAt）。cooldown が false なら秒は見ない（押したときに確かめ済みの「次へ」を、あとから届いた盤面に重ねるとき）
 */
export const advanceCaosPracticeDripper = (
  orders: readonly CaosPracticeOrder[],
  dripper: number,
  seenDripId: string | null,
  now: Date,
  {
    cooldown = true,
    startNext = true,
  }: { cooldown?: boolean; startNext?: boolean } = {},
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
  if (cooldown && caosNextLocked(cur, now.getTime()))
    return {
      error: `始めてから ${CAOS_NEXT_COOLDOWN_SEC} 秒は「次へ」を押せません`,
    };
  const head = startNext ? queued[0] : undefined;
  if (!cur && !startNext)
    return { error: "このドリッパーには抽出中のカードがありません" };
  if (!cur && !head)
    return { error: "このドリッパーには抽出中・待機のカードがありません" };

  const at = brewAt(next, dripper, now);
  for (const { row } of allUnits(next)) {
    if (cur && row.dripId === cur.dripId) row.brewFinishedAt = new Date(at);
    if (head && row.dripId === head.dripId) row.brewStartedAt = new Date(at);
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
