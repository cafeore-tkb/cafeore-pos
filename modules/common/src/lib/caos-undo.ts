import type { components } from "../types/api";
import {
  type CaosBoardCup,
  type CaosCard,
  type CaosCupState,
  type CaosCupsWrite,
  type CaosOrderInput,
  caosLane,
  caosStateJSON,
  caosUnitRows,
} from "./caos-board";
import type { LaneAssignment } from "./caosLanes";

// CaOS の「1つ戻す」。DB や画面を使わない純粋な関数だけを置く（書き戻すのは POST /api/caos/undo）。
//
// 画面は操作が通ったら、書いたカップごとに
//   - restore：操作の前の値（操作したときに画面が見ていた値。CaOS の列）
//   - expect：その操作で変わるはずのところ（ドリッパー・カード・始めた・終えた）
// を覚える。順番の数と時刻はサーバーが決めるので覚えない。
// 戻すときは、今の盤面のカップの値が expect のとおりかを確かめ（違えばほかの画面が変えたので断る）、
// 今の値（current）と restore を送る。サーバーは今の値が current のときだけ書き戻す。
// 準備完了・提供は CaOS の操作では変わらず、盤面の決まりにも使わないので、比べも書き戻しもしない（提供の画面で変わっても戻せる）。
// 緊急（入れ直し）もカップと同じく扱う（id は入れ直しの id）。
// 担当者の交代（見出しの「交代」ですぐ替えたもの）も、今の担当者が交代のあとのままのときだけ前の人に戻す（caosLaneUndoBlock）。

/** その操作のあとのカップ（届いた値がこのとおりなら、まだほかの画面は変えていない） */
interface UndoExpect {
  dripper: number | null;
  dripId: string | null;
  started: boolean;
  finished: boolean;
}

/** 戻す操作（覚えておくもの） */
export interface CaosUndoEntry {
  cups: { id: string; restore: CaosCupState; expect: UndoExpect }[];
}

type UndoCupJSON = components["schemas"]["CaosUndoCup"];

// 盤面のカップ（入れ直しも）を ID で引く
const boardCups = (cards: readonly CaosCard[]) =>
  new Map(cards.flatMap((card) => card.cups.map((cup) => [cup.id, cup])));

// そのまま残るはずのカップ（番号だけがずれうる）
const unchanged = (cup: CaosBoardCup) => ({
  id: cup.id,
  restore: cup.state,
  expect: {
    dripper: cup.state.dripper,
    dripId: cup.state.dripId,
    started: cup.state.brewStartedAt !== null,
    finished: cup.state.brewFinishedAt !== null,
  },
});

/**
 * PUT /api/caos/cups の操作（割当・移動・順番の入れ替え・未割当に戻す・統合・統合の解除・まとめて移す）を戻すもの。
 * 抽出中のカードを動かした操作（始めた時刻を消した・今から始めた）も、前の始めた時刻に戻す。
 * cards は操作したときに画面が見ていたカード（書き込みの before と同じもの）。
 * カードの前に入れる書き込みは、サーバーがその列の後ろのカップの番号を +1 するので、列の待機のカップも前の番号に戻す
 */
export const undoOfWrites = (
  cards: readonly CaosCard[],
  writes: readonly CaosCupsWrite[],
): CaosUndoEntry => {
  const cups = boardCups(cards);
  const written = new Set(writes.flatMap((write) => write.cup_ids));
  // 統合で入った抽出中のカード（書き込みには入らない。動かした抽出中のカードは入らない）。入れたカップは、サーバーがそのカードの開始の時刻を写す（始めたとみる）。
  // そのカードのカップもそのまま送る（サーバーは、戻すカップのカードにほかのカップがあれば断るので）
  const joinedBrewing = cards.filter(
    (card) =>
      card.status === "brewing" &&
      !written.has(card.cups[0].id) &&
      writes.some((write) => write.after.drip_id === card.dripId),
  );
  const shifted = writes.flatMap(({ after }) => {
    if (after.insert_before === null || after.dripper === null) return [];
    return caosLane(cards, after.dripper)
      .queued.flatMap((card) => card.cups)
      .filter((cup) => !written.has(cup.id));
  });
  return {
    cups: [
      ...writes.flatMap((write) =>
        write.cup_ids.flatMap((id) => {
          const cup = cups.get(id);
          if (!cup) return [];
          return [
            {
              id,
              restore: cup.state,
              expect: {
                dripper: write.after.dripper,
                dripId: write.after.drip_id,
                started:
                  write.after.start_brew ||
                  joinedBrewing.some(
                    (card) => card.dripId === write.after.drip_id,
                  ),
                finished: false,
              },
            },
          ];
        }),
      ),
      ...shifted.map(unchanged),
      ...joinedBrewing.flatMap((card) => card.cups).map(unchanged),
    ],
  };
};

/**
 * 「次へ」を戻すもの。サーバーと同じ決まり（caosLane）で、抽出中のカードを終え、待機の先頭を始めたとみる。
 * 戻すと、終えたカードは抽出中に、始めたカードは待機に戻る
 */
export const undoOfNext = (
  cards: readonly CaosCard[],
  dripper: number,
): CaosUndoEntry => {
  const { brewing, queued } = caosLane(cards, dripper);
  const entry = (card: CaosCard | undefined, finished: boolean) =>
    (card?.cups ?? []).map((cup) => ({
      id: cup.id,
      restore: cup.state,
      expect: {
        dripper,
        dripId: card?.dripId ?? null,
        started: true,
        finished,
      },
    }));
  return { cups: [...entry(brewing, true), ...entry(queued[0], false)] };
};

// 戻せないとき・まだ戻せないときの理由（カップも担当者も同じ）
const ARRIVING = "操作の結果がまだ届いていません。もう一度押してください";
const CHANGED = "ほかの画面で先に変わったので戻せません";

const sameAsExpected = (row: CaosCupState, expect: UndoExpect) =>
  row.dripper === expect.dripper &&
  row.dripId === expect.dripId &&
  (row.brewStartedAt !== null) === expect.started &&
  (row.brewFinishedAt !== null) === expect.finished;

const undoStateJSON = (state: CaosCupState) => ({
  state: caosStateJSON(state),
});

const sameUndoState = (a: CaosCupState, b: CaosCupState) =>
  JSON.stringify(undoStateJSON(a)) === JSON.stringify(undoStateJSON(b));

/**
 * 覚えた操作から POST /api/caos/undo に送るカップを作る。orders は今の盤面の注文（カードに出ていないカップも引く。
 * 準備完了・提供済みのカードを未割当に戻すと盤面から消えるが、それも戻せる）。
 * 消えた・ほかの画面で変わったカップがあれば、送らずに理由を返す
 */
export const caosUndoCups = (
  entry: CaosUndoEntry,
  orders: readonly CaosOrderInput[],
): { cups: UndoCupJSON[] } | { error: string; arriving?: true } => {
  if (entry.cups.length === 0) return { error: "戻せる操作がありません" };
  const byId = caosUnitRows(orders);
  // 操作の結果がまだ盤面に届いていない（全部のカップが前の値のまま）。少し待てば戻せる
  const arriving = entry.cups.every(({ id, restore }) => {
    const now = byId.get(id);
    return now !== undefined && sameUndoState(now, restore);
  });
  if (arriving) return { error: ARRIVING, arriving: true };
  const out: UndoCupJSON[] = [];
  for (const { id, restore, expect } of entry.cups) {
    const now = byId.get(id);
    if (!now)
      return {
        error:
          "カップが消えたので戻せません（注文が編集・削除されたかもしれません）",
      };
    if (!sameAsExpected(now, expect)) return { error: CHANGED };
    out.push({
      cup_id: id,
      current: undoStateJSON(now),
      restore: undoStateJSON(restore),
    });
  }
  return { cups: out };
};

const sameLane = (a: LaneAssignment, b: LaneAssignment) =>
  a.name === b.name && a.senior === b.senior;

/**
 * 担当者の交代（before → after）を戻せない理由。now は今のそのドリッパーの担当者（todaysCaosLanes）。
 * 交代のあとのままなら null（before に書き戻す）。まだ前のままなら arriving（少し待てば戻せる）、ほかの画面が替えていれば断る
 */
export const caosLaneUndoBlock = (
  before: LaneAssignment,
  after: LaneAssignment,
  now: LaneAssignment,
): { error: string; arriving?: true } | null => {
  if (sameLane(now, after)) return null;
  if (sameLane(now, before)) return { error: ARRIVING, arriving: true };
  return { error: CHANGED };
};
