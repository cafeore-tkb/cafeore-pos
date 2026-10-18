/**
 * シールの印刷データ
 *
 * 「どのシールに何をどこへ刷るか」だけを持ち、プリンターの命令や送り方は持たない。
 * プリンターに合わせて送るのは infra/ の実装の役目。
 *
 * 座標と範囲の単位はドット（今使っているプリンターの 1 ドット）。
 * 文字の大きさは、標準の文字に対する横・縦の倍率。
 */

/** 文字の大きさ（横の倍率, 縦の倍率） */
export type TextSize = readonly [width: number, height: number];

/** 同じ大きさで続く文字 */
export type TextRun = {
  text: string;
  size: TextSize;
};

/** 1 行。左から順に並べ、最後で改行する */
export type TextLine = readonly TextRun[];

/**
 * 白黒の画像。ImageData と同じ並び（1 ドットにつき R・G・B・A の 4 バイト、左上から横へ）で、
 * 黒か白のどちらかの色だけを持つ
 */
export type RasterImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/** 座標を決めて置くもの */
export type PlacedElement =
  | { type: "text"; x: number; y: number; line: TextLine }
  | { type: "logo"; x: number; y: number };

/**
 * シール 1 枚
 *
 * - fixed: シールの先頭へ送ってから、範囲（area）の中に座標で置く
 * - flow: 先頭へは送らず、前のシールの続きから行を上から順に流す。
 *   align が center なら各行を紙の中央に寄せる（省略したら左寄せ）
 * - image: 前のシールの続きに画像を紙の中央に寄せて刷る。top なら、シールの先頭へ送ってから刷る
 */
export type Label =
  | {
      type: "fixed";
      area: { x: number; y: number; width: number; height: number };
      elements: readonly PlacedElement[];
    }
  | { type: "flow"; lines: readonly TextLine[]; align?: "left" | "center" }
  | { type: "image"; image: RasterImage; top?: boolean };

/** 1 回で刷るシール（1 件の注文の分）。レシート・領収書も 1 枚の image のシールとして同じ形で刷る */
export type PrintJob = {
  labels: readonly Label[];
};

/**
 * 端末の外から来た印刷データ（端末に残したもの・代理印刷で届いたもの）を読む。labels が配列でなければ null。
 * 中身（シールの形）は、作ったのも POS の画面なので確かめない
 */
export const toPrintJob = (value: unknown): PrintJob | null =>
  typeof value === "object" &&
  value !== null &&
  "labels" in value &&
  Array.isArray(value.labels)
    ? (value as PrintJob)
    : null;
