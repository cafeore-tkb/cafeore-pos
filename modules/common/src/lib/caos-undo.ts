import type { Cup } from "../models/cup";
import type { components } from "../types/api";
import type {
  CaosCard,
  CaosCupState,
  CaosCupsWrite,
  CaosOrderInput,
} from "./caos-board";

// CaOS の「1つ戻す」。DB や画面を使わない純粋な関数だけを置く（書き戻すのは POST /api/caos/undo）。
//
// 各画面（各 iPad の /master-sheet）が、自分が最後にした操作について、カップごとに
//   - restore：その操作の前の値（操作したときに画面が見ていた値）
//   - written：その操作で自分が書いた値（サーバーが付ける時刻は「サーバーの今」の印）
// を覚えておく（画面のメモリだけ。再読み込みで消えてよい）。
// 戻すときは、届いている注文から「サーバーの今」の時刻を埋めて current にし、restore と一緒に送る。
// サーバーは今の値が current のときだけ書き戻すので、ほかの画面（ほかの iPad・マスター・提供）があとで変えていたら断られる。
//
// 操作の種類ごとに、覚える値を作る関数（undoOf*）を足す。担当者の交代・緊急などカップを書かない操作は、
// 画面の側（caos/hooks/useCaosUndo）で、その操作を戻す処理をそのまま覚える。

/** 「1つ戻す」で比べる・書き戻すカップの値（CaOS の列と、準備完了・提供済み） */
export interface CaosUndoCupState extends CaosCupState {
  readyAt: Date | null;
  servedAt: Date | null;
}

/** サーバーが付けた時刻（操作のときのサーバーの今）の印。戻すときに、届いた注文の値で埋める */
export const CAOS_SERVER_NOW = "serverNow";
type Stamp = Date | null | typeof CAOS_SERVER_NOW;

/** その操作で自分が書いた値（時刻はサーバーの今の印のことがある。提供済みは書かない） */
export interface CaosWrittenCupState {
  dripper: number | null;
  dripperPosition: number | null;
  dripId: string | null;
  brewStartedAt: Stamp;
  brewFinishedAt: Stamp;
  readyAt: Stamp;
  servedAt: Date | null;
}

export interface CaosUndoCup {
  id: string;
  written: CaosWrittenCupState;
  restore: CaosUndoCupState;
}

/** 戻せる操作の種類。足すときは、ここと CAOS_UNDO_LABELS と、覚える値を作る関数を足す */
export type CaosUndoKind =
  | "assign"
  | "move"
  | "front"
  | "unassign"
  | "merge"
  | "next";

export const CAOS_UNDO_LABELS: Record<CaosUndoKind, string> = {
  assign: "割当",
  move: "移動",
  front: "先頭へ",
  unassign: "未割当に戻す",
  merge: "統合",
  next: "次へ",
};

/** 画面に出す操作の名前（「次へ（3番）」など） */
export const caosUndoLabel = (kind: CaosUndoKind, detail: string) =>
  `${CAOS_UNDO_LABELS[kind]}（${detail}）`;

/** 画面が覚える、最後の操作（カップを書いた操作） */
export interface CaosUndoEntry {
  kind: CaosUndoKind;
  /** 画面に出す名前（「2番の次へ」など） */
  label: string;
  cups: CaosUndoCup[];
}

export type CaosUndoCupJSON = components["schemas"]["CaosUndoCup"];

const boardCups = (cards: readonly CaosCard[]) =>
  new Map(cards.flatMap((card) => card.cups.map((cup) => [cup.id, cup])));

const undoStateOf = (cup: {
  state: CaosCupState;
  readyAt: Date | null;
  servedAt: Date | null;
}): CaosUndoCupState => ({
  ...cup.state,
  readyAt: cup.readyAt,
  servedAt: cup.servedAt,
});

/**
 * PUT /api/caos/cups の操作（割当・移動・先頭へ・未割当に戻す・統合）で覚える値。
 * cards は操作したときに画面が見ていたカード（書き込みの before と同じもの）。書いたカップが見つからなければ null
 */
export const undoOfWrites = (
  kind: CaosUndoKind,
  label: string,
  cards: readonly CaosCard[],
  writes: readonly CaosCupsWrite[],
): CaosUndoEntry | null => {
  if (writes.length === 0) return null;
  const byId = boardCups(cards);
  const cups: CaosUndoCup[] = [];
  for (const write of writes) {
    for (const id of write.cup_ids) {
      const cup = byId.get(id);
      if (!cup) return null;
      const restore = undoStateOf(cup);
      cups.push({
        id,
        restore,
        written: {
          dripper: write.after.dripper,
          dripperPosition: write.after.dripper_position,
          dripId: write.after.drip_id,
          brewStartedAt: write.after.start_brew ? CAOS_SERVER_NOW : null,
          brewFinishedAt: null,
          readyAt: restore.readyAt,
          servedAt: restore.servedAt,
        },
      });
    }
  }
  return { kind, label, cups };
};

/**
 * 「次へ」で覚える値。サーバーは抽出中のカード（finishedDripId）を終えてカップを準備完了にし、待機の先頭（startedDripId）を始めた。
 * 戻すと、終えたカードは抽出中に戻って準備完了が外れ（この「次へ」で準備完了にしたカップだけ）、始めたカードは待機に戻る。
 * cards は押したときに画面が見ていたカード。サーバーが終えた・始めたカードが見つからなければ null
 */
export const undoOfNext = (
  label: string,
  cards: readonly CaosCard[],
  finishedDripId: string | null,
  startedDripId: string | null,
): CaosUndoEntry | null => {
  const cardOf = (dripId: string | null) =>
    dripId === null ? undefined : cards.find((card) => card.dripId === dripId);
  const finished = cardOf(finishedDripId);
  const started = cardOf(startedDripId);
  if ((finishedDripId && !finished) || (startedDripId && !started)) return null;
  const cups: CaosUndoCup[] = [];
  for (const cup of finished?.cups ?? []) {
    const restore = undoStateOf(cup);
    cups.push({
      id: cup.id,
      restore,
      written: {
        ...restore,
        brewFinishedAt: CAOS_SERVER_NOW,
        readyAt: restore.readyAt ?? CAOS_SERVER_NOW,
      },
    });
  }
  for (const cup of started?.cups ?? []) {
    const restore = undoStateOf(cup);
    cups.push({
      id: cup.id,
      restore,
      written: { ...restore, brewStartedAt: CAOS_SERVER_NOW },
    });
  }
  return cups.length > 0 ? { kind: "next", label, cups } : null;
};

/** 届いている注文の、カップの今の値（ID ごと） */
export const caosObservedCups = (
  orders: readonly Pick<CaosOrderInput, "cups">[],
): Map<string, CaosUndoCupState> =>
  new Map(
    orders.flatMap((order) =>
      order.cups.map((cup: Cup): [string, CaosUndoCupState] => [
        cup.id,
        {
          dripper: cup.dripper ?? null,
          dripperPosition: cup.dripperPosition ?? null,
          dripId: cup.dripId ?? null,
          brewStartedAt: cup.brewStartedAt ?? null,
          brewFinishedAt: cup.brewFinishedAt ?? null,
          readyAt: cup.readyAt,
          servedAt: cup.servedAt,
        },
      ]),
    ),
  );

const STAMPED = ["brewStartedAt", "brewFinishedAt", "readyAt"] as const;

const iso = (date: Date | null) => date?.toISOString() ?? null;

const stateJSON = (
  state: CaosUndoCupState,
): components["schemas"]["CaosUndoCupState"] => ({
  dripper: state.dripper,
  dripper_position: state.dripperPosition,
  drip_id: state.dripId,
  brew_started_at: iso(state.brewStartedAt),
  brew_finished_at: iso(state.brewFinishedAt),
  ready_at: iso(state.readyAt),
  served_at: iso(state.servedAt),
});

export type CaosUndoResolved = { cups: CaosUndoCupJSON[] } | { error: string };

/**
 * 覚えた値から POST /api/caos/undo に送る値を作る。「サーバーの今」の印は、届いている注文（observed）の時刻で埋める。
 * 書き戻すかどうかはサーバーが確かめる（今の値が current でなければ断る）。ここでは送れない場合だけ断る
 */
export const resolveUndo = (
  entry: CaosUndoEntry,
  observed: ReadonlyMap<string, CaosUndoCupState>,
): CaosUndoResolved => {
  // 1 回の操作でサーバーが付ける時刻は 1 つ（同じトランザクションの今）
  let serverNow: Date | null = null;
  for (const cup of entry.cups) {
    const now = observed.get(cup.id);
    if (!now)
      return {
        error:
          "カップが消えたので戻せません（注文が編集・削除されたかもしれません）",
      };
    for (const key of STAMPED) {
      if (cup.written[key] !== CAOS_SERVER_NOW) continue;
      const at = now[key];
      if (!at) return { error: "ほかの画面で先に変わったので戻せません" };
      serverNow ??= at;
    }
  }
  const fill = (stamp: Stamp) =>
    stamp === CAOS_SERVER_NOW ? serverNow : stamp;
  return {
    cups: entry.cups.map((cup) => ({
      cup_id: cup.id,
      current: stateJSON({
        ...cup.written,
        brewStartedAt: fill(cup.written.brewStartedAt),
        brewFinishedAt: fill(cup.written.brewFinishedAt),
        readyAt: fill(cup.written.readyAt),
      }),
      restore: stateJSON(cup.restore),
    })),
  };
};
