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

/**
 * 白黒の画像を 1 ドット 1 ビットに詰めたもの（端末に残し、代理印刷でサーバーへ送れる大きさにするため。
 * RasterImage のままでは 360 × 232 ドットで JSON が数 MB になる）
 *
 * 行ごとに左から 8 ドットずつ 1 バイト（上の桁が左、1 が黒）にして行の端は 8 ドットにそろえ、全部を base64 にする。
 */
export type PackedImage = {
  width: number;
  height: number;
  bits: string;
};

/** 1 行のバイト数 */
const rowBytes = (width: number) => Math.ceil(width / 8);

/** 画素が黒か（RasterImage は黒か白しか持たない） */
const isBlack = (data: Uint8ClampedArray, pixel: number) =>
  data[pixel * 4] < 128;

/**
 * 白黒の画像を 1 ビットに詰める。下の白い行は送らない（データを小さくし、紙を余計に送らない）。
 * 黒い所が無ければ 1 行だけにする（0 行の画像は刷れないので）
 */
export const packImage = (image: RasterImage): PackedImage => {
  const { width, height, data } = image;
  let lastInkRow = -1;
  for (let y = height - 1; y >= 0 && lastInkRow < 0; y--) {
    for (let x = 0; x < width; x++) {
      if (isBlack(data, y * width + x)) {
        lastInkRow = y;
        break;
      }
    }
  }
  const rows = Math.max(1, lastInkRow + 1);
  const bytes = rowBytes(width);
  const packed = new Uint8Array(bytes * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      if (isBlack(data, y * width + x)) {
        packed[y * bytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  let binary = "";
  for (const byte of packed) binary += String.fromCharCode(byte);
  return { width, height: rows, bits: btoa(binary) };
};

/** 詰めた画像を、プリンターに渡せる RasterImage に戻す */
export const unpackImage = (image: PackedImage): RasterImage => {
  const { width, height } = image;
  const binary = atob(image.bits);
  const bytes = rowBytes(width);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const black =
        (binary.charCodeAt(y * bytes + (x >> 3)) & (0x80 >> (x & 7))) !== 0;
      if (black) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return { width, height, data };
};

/** 座標を決めて置くもの */
export type PlacedElement =
  | { type: "text"; x: number; y: number; line: TextLine }
  | { type: "logo"; x: number; y: number };

/**
 * ダイカットラベル 1 枚分の画像（緊急・キャンセル・テスト印刷のシール）。シールの先頭へ送ってから、左端から刷る。
 * 画像はラベル用のシールの大きさ（paper.ts の labelGeometry）で描く（sticker.ts）
 */
export type StickerLabel = { type: "sticker"; image: PackedImage };

/**
 * シール 1 枚
 *
 * - fixed: シールの先頭へ送ってから、範囲（area）の中に座標で置く
 * - flow: 先頭へは送らず、前のシールの続きから行を上から順に流す。
 *   align が center なら各行を紙の中央に寄せる（省略したら左寄せ）
 * - image: 前のシールの続きに画像を紙の中央に寄せて刷る（レシート・領収書）
 * - sticker: StickerLabel
 */
export type Label =
  | {
      type: "fixed";
      area: { x: number; y: number; width: number; height: number };
      elements: readonly PlacedElement[];
    }
  | { type: "flow"; lines: readonly TextLine[]; align?: "left" | "center" }
  | { type: "image"; image: RasterImage }
  | StickerLabel;

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
