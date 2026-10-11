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
 */
export type Label =
  | {
      type: "fixed";
      area: { x: number; y: number; width: number; height: number };
      elements: readonly PlacedElement[];
    }
  | { type: "flow"; lines: readonly TextLine[]; align?: "left" | "center" };

/** 1 回で刷るシール（1 件の注文の分）。レシート・領収書も 1 枚の flow のシールとして同じ形で刷る */
export type PrintJob = {
  labels: readonly Label[];
};
