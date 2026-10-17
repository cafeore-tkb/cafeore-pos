import type { OrderEntity } from "@cafeore/common";
import oreLogoUrl from "~/assets/receipt/ore-logo.svg";
import type { PrintJob, RasterImage } from "./document";
import {
  type ClaimReceipt,
  type FormalReceipt,
  type OrderReceipt,
  RECEIPT_ISSUER,
  RECEIPT_ISSUER_READING,
  type ReceiptPayment,
  type ReceiptRow,
  type ReceiptSplit,
  claimReceipt,
  formalReceipt,
  orderReceipt,
} from "./receipt";

/**
 * レシートと領収書を画像に描く（ブラウザの canvas を使う）
 *
 * 太字や大きさの違う文字、ロゴと文字の横並びをデザインどおりに刷るため、
 * プリンターの文字ではなく、画面で描いた白黒の画像を刷る。
 *
 * 寸法は幅 576 の座標で決めてある（デザインのモックの紙の幅 229px の 1px を約 2.8 として写した）。
 * 描くときに刷るプリンターの印字幅（paper.ts の RECEIPT_WIDTHS。機種と用紙の幅で決まる）に合わせるので、
 * 幅が変わっても比率は変わらない（80mm の紙なら 576 ドットでそのまま、58mm の紙なら縮める）。
 */

/** 寸法を決めている座標の幅 */
const DESIGN_WIDTH = 576;

/** 座標を印字幅（width ドット）に直す倍率 */
const scaleFor = (width: number) => width / DESIGN_WIDTH;

/** 画面と同じフォント（tailwind.css で読み込んでいる） */
const FONT_FAMILY = '"Noto Sans JP Variable", sans-serif';

/** 文字の灰色をどこから黒にするか（明るさ 0〜255） */
const TEXT_THRESHOLD = 128;

/** ロゴは細い線が消えないよう、薄い灰色まで黒にする */
const LOGO_THRESHOLD = 220;

/** 左右の余白 */
const PADDING_X = 40;

type Ctx = CanvasRenderingContext2D;

export type TextStyle = {
  size: number;
  weight: number;
  align?: CanvasTextAlign;
  color?: string;
};

const BODY: TextStyle = { size: 34, weight: 600 };
const ISSUER: TextStyle = { size: 57, weight: 700 };
const ISSUER_READING: TextStyle = { size: 28, weight: 500 };

const font = ({ size, weight }: TextStyle) =>
  `${weight} ${size}px ${FONT_FAMILY}`;

/**
 * 明るさが threshold より暗いところを黒、ほかを白にする（画像を書き換える）
 *
 * 透明なところは白い紙の上にあるものとして扱う。
 */
export const binarize = <T extends RasterImage>(
  image: T,
  threshold: number,
) => {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const luminance =
      (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) * alpha +
      255 * (1 - alpha);
    const value = luminance < threshold ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return image;
};

/** maxWidth に収まるよう後ろを切り、切ったら「…」を付ける */
export const fitText = (
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
) => {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && measure(`${chars.join("")}…`) > maxWidth) {
    chars.pop();
  }
  return `${chars.join("")}…`;
};

/** width × height ドットの白い canvas */
export const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas の 2D コンテキストを作れませんでした");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
};

/** 座標で width × height の大きさを、scale を掛けて刷るドットに縮めて描ける canvas */
const createDesignCanvas = (width: number, height: number, scale: number) => {
  const created = createCanvas(
    Math.round(width * scale),
    Math.round(height * scale),
  );
  created.ctx.scale(scale, scale);
  return created;
};

/** y を文字の縦の中心にして書く */
export const drawText = (
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
) => {
  ctx.font = font(style);
  ctx.textAlign = style.align ?? "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = style.color ?? "#000";
  ctx.fillText(text, x, y);
};

export const textWidth = (ctx: Ctx, text: string, style: TextStyle) => {
  ctx.font = font(style);
  return ctx.measureText(text).width;
};

const DASH = { length: 10, gap: 5 };

/** x1〜x2 に点線を引く。両端が欠けた線にならないよう、収まる本数だけ中央に寄せて引く */
const drawDashedLine = (ctx: Ctx, x1: number, x2: number, y: number) => {
  const period = DASH.length + DASH.gap;
  const count = Math.floor((x2 - x1 + DASH.gap) / period);
  const start = x1 + (x2 - x1 - (count * period - DASH.gap)) / 2;
  ctx.fillStyle = "#000";
  for (let i = 0; i < count; i++) {
    ctx.fillRect(start + i * period, y - 1, DASH.length, 3);
  }
};

/**
 * ロゴを座標で size × size の大きさに置く。細い線が残るよう、ロゴだけ別に白黒にしてから重ねる
 *
 * 縮めながら重ねると画素がぼけて細い線が消えるので、刷るドットの大きさで白黒にし、
 * 縮めずに整数のドットの位置へ置く。
 */
const drawLogo = (
  ctx: Ctx,
  logo: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  scale: number,
) => {
  const dots = Math.round(size * scale);
  const { canvas, ctx: logoCtx } = createCanvas(dots, dots);
  logoCtx.drawImage(logo, 0, 0, dots, dots);
  logoCtx.putImageData(
    binarize(logoCtx.getImageData(0, 0, dots, dots), LOGO_THRESHOLD),
    0,
    0,
  );
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, Math.round(x * scale), Math.round(y * scale));
  ctx.restore();
};

/** ロゴ・名前・読み。ロゴが無ければ名前と読みだけ置く */
const drawIssuer = (
  ctx: Ctx,
  logo: HTMLImageElement | null,
  x: number,
  top: number,
  logoSize: number,
  scale: number,
) => {
  const centerY = top + logoSize / 2;
  let textX = x;
  if (logo) {
    drawLogo(ctx, logo, x, top, logoSize, scale);
    textX += logoSize + 36;
  }
  drawText(ctx, RECEIPT_ISSUER, textX, centerY - 21, ISSUER);
  drawText(ctx, RECEIPT_ISSUER_READING, textX, centerY + 48, ISSUER_READING);
};

const issuerWidth = (ctx: Ctx, logo: HTMLImageElement | null, size: number) =>
  (logo ? size + 36 : 0) +
  Math.max(
    textWidth(ctx, RECEIPT_ISSUER, ISSUER),
    textWidth(ctx, RECEIPT_ISSUER_READING, ISSUER_READING),
  );

/** 縦に積む部品。height の高さを取り、top から下に描く */
type Block = { height: number; draw?: (ctx: Ctx, top: number) => void };

const gap = (height: number): Block => ({ height });

/** 部品を上から積んだ高さの canvas に、scale を掛けて描く */
const stack = (width: number, blocks: Block[], scale: number) => {
  const height = blocks.reduce((sum, block) => sum + block.height, 0);
  const { canvas, ctx } = createDesignCanvas(width, height, scale);
  let top = 0;
  for (const block of blocks) {
    block.draw?.(ctx, top);
    top += block.height;
  }
  return { canvas, ctx };
};

/** canvas 全体を白黒にして取り出す */
export const toRasterImage = (ctx: Ctx): RasterImage => {
  const { width, height } = ctx.canvas;
  return binarize(ctx.getImageData(0, 0, width, height), TEXT_THRESHOLD);
};

/** 紙の中央に寄せて刷る 1 枚 */
const imageJob = (image: RasterImage): PrintJob => ({
  labels: [{ type: "image", image }],
});

/** 書く文字がすべて入ったフォントを読み込む（読み込めなければ代わりのフォントで描く） */
export const loadFonts = async (texts: string[]) => {
  try {
    await document.fonts.load(font(BODY), texts.join(""));
  } catch (error) {
    console.error("レシートのフォントを読み込めませんでした", error);
  }
};

let cachedLogo: HTMLImageElement | undefined;

/** ロゴを読み込む。読み込めなければ null（ロゴ無しで刷る） */
const loadLogo = async () => {
  if (cachedLogo) return cachedLogo;
  const image = new Image();
  image.src = oreLogoUrl;
  try {
    await image.decode();
    cachedLogo = image;
    return image;
  } catch (error) {
    console.error("レシートのロゴを読み込めませんでした", error);
    return null;
  }
};

// ---- レシート ----

const RECEIPT_LOGO_SIZE = 184;
const LINE = 58;
const TOTAL_LINE = 74;
/** 点線の部品の高さと、その中で線を引く位置（線の上を下より広く空ける） */
const RULE = { height: 62, y: 35 };
const CLAIM_BOX = { width: 246, height: 75 };
const NUMBER_LINE = 140;

const TOTAL_AMOUNT: TextStyle = { size: 42, weight: 700, align: "right" };
const CLAIM_LABEL: TextStyle = {
  size: 34,
  weight: 600,
  align: "center",
  color: "#fff",
};
const CLAIM_NOTE: TextStyle = { size: 28, weight: 600 };
const CLAIM_NUMBER: TextStyle = { size: 140, weight: 800, align: "center" };

const CLAIM_NOTE_LINES = ["この番号で", "お呼びいたします"];

const contentRight = DESIGN_WIDTH - PADDING_X;

/** 左に名前と個数、右に金額。名前が長ければ金額にかからないよう名前だけ切る */
const drawRow = (
  ctx: Ctx,
  { label, quantity, amount }: ReceiptRow,
  y: number,
  amountStyle: TextStyle = BODY,
) => {
  const right = { ...amountStyle, align: "right" as const };
  drawText(ctx, amount, contentRight, y, right);
  const suffix = quantity ? ` ${quantity}` : "";
  const room =
    contentRight -
    PADDING_X -
    textWidth(ctx, amount, right) -
    textWidth(ctx, suffix, BODY) -
    24;
  ctx.font = font(BODY);
  const fitted = fitText(label, room, (text) => ctx.measureText(text).width);
  drawText(ctx, `${fitted}${suffix}`, PADDING_X, y, BODY);
};

const row = (data: ReceiptRow, height = LINE, amountStyle?: TextStyle) => ({
  height,
  draw: (ctx: Ctx, top: number) =>
    drawRow(ctx, data, top + height / 2, amountStyle),
});

const rule: Block = {
  height: RULE.height,
  draw: (ctx, top) =>
    drawDashedLine(ctx, PADDING_X, contentRight, top + RULE.y),
};

const issuerBlock = (logo: HTMLImageElement | null, scale: number): Block => ({
  height: RECEIPT_LOGO_SIZE,
  draw: (ctx, top) => {
    const x = (DESIGN_WIDTH - issuerWidth(ctx, logo, RECEIPT_LOGO_SIZE)) / 2;
    drawIssuer(ctx, logo, x, top, RECEIPT_LOGO_SIZE, scale);
  },
});

/** 白抜きの「引換券番号」と、その右の 2 行の案内 */
const claimLabelBlock: Block = {
  height: CLAIM_BOX.height,
  draw: (ctx, top) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(PADDING_X, top, CLAIM_BOX.width, CLAIM_BOX.height);
    const centerY = top + CLAIM_BOX.height / 2;
    drawText(
      ctx,
      "引換券番号",
      PADDING_X + CLAIM_BOX.width / 2,
      centerY,
      CLAIM_LABEL,
    );
    const noteX = PADDING_X + CLAIM_BOX.width + 18;
    drawText(ctx, CLAIM_NOTE_LINES[0], noteX, centerY - 17, CLAIM_NOTE);
    drawText(ctx, CLAIM_NOTE_LINES[1], noteX, centerY + 17, CLAIM_NOTE);
  },
};

const claimNumberBlock = (claimNumber: string): Block => ({
  height: NUMBER_LINE,
  draw: (ctx, top) =>
    drawText(
      ctx,
      claimNumber,
      DESIGN_WIDTH / 2,
      top + NUMBER_LINE / 2,
      CLAIM_NUMBER,
    ),
});

/** レシートの頭。ロゴ・名前・読みと、日時・注文番号の行、その下の点線 */
const headerBlocks = (
  receipt: { dateTime: string; orderNo: string },
  logo: HTMLImageElement | null,
  scale: number,
): Block[] => [
  gap(16),
  issuerBlock(logo, scale),
  gap(35),
  row({ label: receipt.dateTime, amount: receipt.orderNo }),
  gap(15),
  rule,
];

/** 引換券番号の見出しと案内、その下の大きな番号 */
const claimBlocks = (claimNumber: string): Block[] => [
  claimLabelBlock,
  gap(53),
  claimNumberBlock(claimNumber),
];

/** 会計のたびに刷るレシートを、印字幅（width ドット）で描く */
export const drawOrderReceipt = async (
  receipt: OrderReceipt,
  width: number,
): Promise<RasterImage> => {
  const scale = scaleFor(width);
  const rows = [...receipt.items, ...receipt.adjustments, ...receipt.payments];
  await loadFonts([
    RECEIPT_ISSUER,
    RECEIPT_ISSUER_READING,
    receipt.dateTime,
    receipt.orderNo,
    receipt.total,
    receipt.claimNumber ?? "",
    "合計引換券番号…",
    ...CLAIM_NOTE_LINES,
    ...rows.flatMap(({ label, quantity = "", amount }) => [
      label,
      quantity,
      amount,
    ]),
  ]);
  const logo = await loadLogo();

  const blocks: Block[] = [
    ...headerBlocks(receipt, logo, scale),
    ...receipt.items.map((item) => row(item)),
    rule,
  ];
  if (receipt.adjustments.length > 0) {
    blocks.push(...receipt.adjustments.map((item) => row(item)), rule);
  }
  blocks.push(
    row({ label: "合計", amount: receipt.total }, TOTAL_LINE, TOTAL_AMOUNT),
    gap(21),
    ...receipt.payments.map((item) => row(item)),
  );
  // 注文を何回かに分けて払うときは、引換券番号を載せない（払い終えたら別のレシートで刷る）
  if (receipt.claimNumber !== undefined) {
    blocks.push(gap(42), ...claimBlocks(receipt.claimNumber));
  }
  blocks.push(gap(40));

  const { ctx } = stack(DESIGN_WIDTH, blocks, scale);
  return toRasterImage(ctx);
};

/** 注文を何回かに分けて払ったとき、払い終えたら別に刷る引換券番号のレシートを、印字幅（width ドット）で描く */
export const drawClaimReceipt = async (
  receipt: ClaimReceipt,
  width: number,
): Promise<RasterImage> => {
  const scale = scaleFor(width);
  await loadFonts([
    RECEIPT_ISSUER,
    RECEIPT_ISSUER_READING,
    receipt.dateTime,
    receipt.orderNo,
    receipt.claimNumber,
    "引換券番号",
    ...CLAIM_NOTE_LINES,
  ]);
  const logo = await loadLogo();

  const { ctx } = stack(
    DESIGN_WIDTH,
    [
      ...headerBlocks(receipt, logo, scale),
      gap(21),
      ...claimBlocks(receipt.claimNumber),
      gap(40),
    ],
    scale,
  );
  return toRasterImage(ctx);
};

// ---- 領収書 ----

/**
 * 領収書は横長に描いて 90 度回し、紙の送る向きを横にして刷る
 *
 * 横長の高さが紙の印字幅になる。回すと左端（「領収書」の側）が先に出る。
 */
const FORMAL_WIDTH = 1346;
const FORMAL_HEIGHT = DESIGN_WIDTH;
const FORMAL_LOGO_SIZE = 185;

const FORMAL_TITLE: TextStyle = { size: 56, weight: 700 };
const FORMAL_BODY: TextStyle = { size: 33, weight: 600 };
const FORMAL_AMOUNT: TextStyle = { size: 51, weight: 700 };
const COPY_MARK: TextStyle = {
  size: 36,
  weight: 700,
  align: "center",
  color: "#fff",
};

const FORMAL_TITLE_TEXT = "領収書";
const FORMAL_ACKNOWLEDGEMENT = "上記 正に領収いたしました";

/** 店舗控の印の白抜きの箱。「領収書」の右に置く */
const COPY_MARK_BOX = { height: 60, paddingX: 18, marginLeft: 28 };

/** 時計回りに 90 度回す */
const rotateClockwise = (source: HTMLCanvasElement) => {
  const { canvas, ctx } = createCanvas(source.height, source.width);
  ctx.translate(source.height, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return { canvas, ctx };
};

/** 求められたときだけ刷る領収書を、印字幅（width ドット）で描く */
export const drawFormalReceipt = async (
  receipt: FormalReceipt,
  width: number,
): Promise<RasterImage> => {
  const scale = scaleFor(width);
  await loadFonts([
    `${FORMAL_TITLE_TEXT}様`,
    receipt.orderNo,
    receipt.amount,
    receipt.note,
    FORMAL_ACKNOWLEDGEMENT,
    receipt.date,
    RECEIPT_ISSUER,
    RECEIPT_ISSUER_READING,
    receipt.copyMark ?? "",
  ]);
  const logo = await loadLogo();

  const { canvas, ctx } = createDesignCanvas(
    FORMAL_WIDTH,
    FORMAL_HEIGHT,
    scale,
  );
  const right = FORMAL_WIDTH - PADDING_X;

  drawText(ctx, FORMAL_TITLE_TEXT, PADDING_X, 67, FORMAL_TITLE);
  drawText(ctx, receipt.orderNo, right, 67, {
    ...FORMAL_BODY,
    align: "right",
  });

  if (receipt.copyMark) {
    const left =
      PADDING_X +
      textWidth(ctx, FORMAL_TITLE_TEXT, FORMAL_TITLE) +
      COPY_MARK_BOX.marginLeft;
    const width =
      textWidth(ctx, receipt.copyMark, COPY_MARK) + COPY_MARK_BOX.paddingX * 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(
      left,
      67 - COPY_MARK_BOX.height / 2,
      width,
      COPY_MARK_BOX.height,
    );
    drawText(ctx, receipt.copyMark, left + width / 2, 67, COPY_MARK);
  }

  // 宛名は手で書けるよう、下線と「様」だけ置く
  ctx.fillStyle = "#000";
  ctx.fillRect(PADDING_X, 201, 613, 3);
  drawText(ctx, "様", 664, 188, FORMAL_BODY);

  drawText(ctx, receipt.amount, 44, 291, FORMAL_AMOUNT);
  drawText(ctx, receipt.note, PADDING_X, 364, FORMAL_BODY);
  drawText(ctx, FORMAL_ACKNOWLEDGEMENT, PADDING_X, 420, FORMAL_BODY);
  drawText(ctx, receipt.date, 762, 515, { ...FORMAL_BODY, align: "right" });

  drawIssuer(ctx, logo, 820, 353, FORMAL_LOGO_SIZE, scale);

  return toRasterImage(rotateClockwise(canvas).ctx);
};

/**
 * 会計のたびに刷るレシートの印刷データ。width は刷るプリンターの印字幅（ドット）
 *
 * 注文の中身は呼んだときに読む（描くのを待つ間に注文が変わっても、そのときの中身で刷る）。
 */
export const orderReceiptJob = async (
  width: number,
  order: OrderEntity,
  payment: ReceiptPayment,
  split?: ReceiptSplit,
): Promise<PrintJob> =>
  imageJob(await drawOrderReceipt(orderReceipt(order, payment, split), width));

/**
 * 注文を何回かに分けて払ったとき、払い終えたら別に刷る引換券番号のレシートの印刷データ。
 * width は刷るプリンターの印字幅（ドット）（注文の中身は呼んだときに読む）
 */
export const claimReceiptJob = async (
  width: number,
  order: OrderEntity,
): Promise<PrintJob> =>
  imageJob(await drawClaimReceipt(claimReceipt(order), width));

/**
 * 求められたときだけ刷る領収書の印刷データ。width は刷るプリンターの印字幅（ドット）、storeCopy なら店舗控
 * （注文の中身は呼んだときに読む）
 */
export const formalReceiptJob = async (
  width: number,
  order: OrderEntity,
  options?: { storeCopy?: boolean },
): Promise<PrintJob> =>
  imageJob(await drawFormalReceipt(formalReceipt(order, options), width));
