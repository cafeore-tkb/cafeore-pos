import type { components } from "../types/api";
import {
  type CaosBoardCup,
  type CaosCard,
  type CaosCupState,
  type CaosCupsWrite,
  caosLane,
  caosStateJSON,
} from "./caos-board";

// CaOS の「1つ戻す」。DB や画面を使わない純粋な関数だけを置く（書き戻すのは POST /api/caos/undo）。
//
// 画面は操作が通ったら、書いたカップごとに
//   - restore：操作の前の値（操作したときに画面が見ていた値。CaOS の列と準備完了）
//   - expect：その操作で変わるはずのところ（ドリッパー・カード・始めた・終えた・準備完了か）
// を覚える。順番の数と時刻はサーバーが決めるので覚えない。
// 戻すときは、今の盤面のカップの値が expect のとおりかを確かめ（違えばほかの画面が変えたので断る）、
// 今の値（current）と restore を送る。サーバーは今の値が current のときだけ書き戻す。
// 緊急（入れ直し）もカップと同じく扱う（id は入れ直しの id。入れ直しは準備完了を持たない）。

/** 「1つ戻す」で比べる・書き戻すカップの値 */
type UndoCupState = CaosCupState & Pick<CaosBoardCup, "readyAt">;

/** その操作のあとのカップ（届いた値がこのとおりなら、まだほかの画面は変えていない） */
interface UndoExpect {
  dripper: number | null;
  dripId: string | null;
  started: boolean;
  finished: boolean;
  ready: boolean;
}

/** 戻す操作（覚えておくもの） */
export interface CaosUndoEntry {
  cups: { id: string; restore: UndoCupState; expect: UndoExpect }[];
}

type UndoCupJSON = components["schemas"]["CaosUndoCup"];

// 盤面のカップ（入れ直しも）を ID で引く
const boardCups = (cards: readonly CaosCard[]) =>
  new Map(cards.flatMap((card) => card.cups.map((cup) => [cup.id, cup])));

const stateOf = (cup: CaosBoardCup): UndoCupState => ({
  ...cup.state,
  readyAt: cup.readyAt,
});

// そのまま残るはずのカップ（番号だけがずれうる）
const unchanged = (cup: CaosBoardCup) => ({
  id: cup.id,
  restore: stateOf(cup),
  expect: {
    dripper: cup.state.dripper,
    dripId: cup.state.dripId,
    started: cup.state.brewStartedAt !== null,
    finished: cup.state.brewFinishedAt !== null,
    ready: cup.readyAt !== null,
  },
});

/**
 * PUT /api/caos/cups の操作（割当・移動・順番の入れ替え・未割当に戻す・統合）を戻すもの。
 * cards は操作したときに画面が見ていたカード（書き込みの before と同じもの）。
 * カードの前に入れる書き込みは、サーバーがその列の後ろのカップの番号を +1 するので、列の待機のカップも前の番号に戻す
 */
export const undoOfWrites = (
  cards: readonly CaosCard[],
  writes: readonly CaosCupsWrite[],
): CaosUndoEntry => {
  const cups = boardCups(cards);
  const written = new Set(writes.flatMap((write) => write.cup_ids));
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
              restore: stateOf(cup),
              expect: {
                dripper: write.after.dripper,
                dripId: write.after.drip_id,
                started: write.after.start_brew,
                finished: false,
                ready: cup.readyAt !== null,
              },
            },
          ];
        }),
      ),
      ...shifted.map(unchanged),
    ],
  };
};

/**
 * 「次へ」を戻すもの。サーバーと同じ決まり（caosLane）で、抽出中のカードを終えて準備完了にし、待機の先頭を始めたとみる。
 * 戻すと、終えたカードは抽出中に戻って準備完了が外れ（この「次へ」で準備完了にしたカップだけ）、始めたカードは待機に戻る
 */
export const undoOfNext = (
  cards: readonly CaosCard[],
  dripper: number,
): CaosUndoEntry => {
  const { brewing, queued } = caosLane(cards, dripper);
  const entry = (card: CaosCard | undefined, finished: boolean) =>
    (card?.cups ?? []).map((cup) => ({
      id: cup.id,
      restore: stateOf(cup),
      expect: {
        dripper,
        dripId: card?.dripId ?? null,
        started: true,
        finished,
        // 入れ直しは準備完了を持たない（「次へ」は入れ直したカップを準備完了にする）
        ready: (finished && !cup.emergency) || cup.readyAt !== null,
      },
    }));
  return { cups: [...entry(brewing, true), ...entry(queued[0], false)] };
};

const sameAsExpected = (cup: CaosBoardCup, expect: UndoExpect) =>
  cup.state.dripper === expect.dripper &&
  cup.state.dripId === expect.dripId &&
  (cup.state.brewStartedAt !== null) === expect.started &&
  (cup.state.brewFinishedAt !== null) === expect.finished &&
  (cup.readyAt !== null) === expect.ready;

const undoStateJSON = (state: UndoCupState) => ({
  state: caosStateJSON(state),
  ready_at: state.readyAt?.toISOString() ?? null,
});

const sameUndoState = (a: UndoCupState, b: UndoCupState) =>
  JSON.stringify(undoStateJSON(a)) === JSON.stringify(undoStateJSON(b));

/**
 * 覚えた操作から POST /api/caos/undo に送るカップを作る。cards は今の盤面のカード。
 * 消えた・提供済み・ほかの画面で変わったカップがあれば、送らずに理由を返す
 */
export const caosUndoCups = (
  entry: CaosUndoEntry,
  cards: readonly CaosCard[],
): { cups: UndoCupJSON[] } | { error: string; arriving?: true } => {
  const byId = boardCups(cards);
  // 操作の結果がまだ盤面に届いていない（全部のカップが前の値のまま）。少し待てば戻せる
  const arriving = entry.cups.every(({ id, restore }) => {
    const now = byId.get(id);
    return now !== undefined && sameUndoState(stateOf(now), restore);
  });
  if (arriving)
    return {
      error: "操作の結果がまだ届いていません。もう一度押してください",
      arriving: true,
    };
  const out: UndoCupJSON[] = [];
  for (const { id, restore, expect } of entry.cups) {
    const now = byId.get(id);
    if (!now)
      return {
        error:
          "カップが消えたので戻せません（注文が編集・削除されたかもしれません）",
      };
    if (now.servedAt !== null)
      return { error: "提供済みになったカップがあるので戻せません" };
    if (!sameAsExpected(now, expect))
      return { error: "ほかの画面で先に変わったので戻せません" };
    out.push({
      cup_id: id,
      current: undoStateJSON(stateOf(now)),
      restore: undoStateJSON(restore),
    });
  }
  if (out.length === 0) return { error: "戻せる操作がありません" };
  return { cups: out };
};
