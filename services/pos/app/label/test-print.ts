import {
  type ItemType,
  MenuEntity,
  OrderEntity,
  PRINTER_DOTS_PER_MM,
  type PrinterPaperWidth,
  jstClock,
  jstDate,
} from "@cafeore/common";
import type { PrintJob, RasterImage, StickerLabel } from "./document";
import type { CreateLabelPrinter } from "./infra/printer";
import { orderLabelJob } from "./order-label";
import type { LabelGeometry } from "./paper";
import {
  type TextStyle,
  createCanvas,
  drawText,
  fitText,
  loadFonts,
  orderReceiptJob,
  textWidth,
  toRasterImage,
} from "./receipt-canvas";
import { emergencyStickers, toStickerLabel } from "./sticker";

/**
 * テスト印刷（管理画面のプリンター設定から刷る）
 *
 * 確認用のページの後に、いつも刷るものの見本（ラベル用は緊急のシールで挟んだカップのシール、レシート用はレシート）を続けて刷る。
 * ラベル用の見本は、設定の向き（180° 回すか）で刷る。確認用のページは目盛りを最初に刷られる点から測るので、回さない。
 *
 * - ラベル用：確認用のページはシール 1 枚分の画像で、余白の内側を枠で囲み、上と左に最初に刷られる点からの目盛り
 *   （1mm ごとの線と 10mm ごとの数字）を入れる。シールの端がどの数字の所にあるかを読み、印字幅（mm × 8 ドット）と
 *   長さを合わせる。右と下の辺の三角は、刷る範囲の真ん中
 * - レシート用：確認用のページ（どのプリンター・IP アドレス・用紙の幅か）を印字幅いっぱいの枠で囲む。
 *   枠の左右が欠けたら紙より広い幅を、枠の外の余白が広ければ紙より狭い幅を選んでいる
 */

/** テスト印刷するレシート用のプリンター */
export type TestPrintTarget = {
  /** 確認用のページに載せる、どのプリンターか（「ラベル用」など） */
  name: string;
  address: string;
  paperWidth: PrinterPaperWidth;
  /** 用紙の種類の名前（「ダイカットラベル」など） */
  paperType: string;
  /** 印字幅（ドット） */
  width: number;
  /** 機種の名前（機種を選ぶレシート用だけ） */
  model?: string;
};

/** テスト印刷するラベル用のプリンター */
export type LabelTestPrintTarget = {
  address: string;
  geometry: LabelGeometry;
};

// ---- 確認用のページ（レシート用） ----

const TITLE: TextStyle = { size: 34, weight: 800 };
const TARGET_NAME: TextStyle = { size: 26, weight: 700, align: "right" };
const BODY: TextStyle = { size: 24, weight: 600 };
const PRINTED_AT: TextStyle = { size: 20, weight: 500 };

const TITLE_TEXT = "テスト印刷";

/** 枠の線の太さと、枠の内側の余白（ドット） */
const BORDER = 4;
const PADDING = 12;

const TITLE_LINE = 48;
const LINE = 32;

/** 2026/10/17 12:34:56（日本時間） */
const dateTime = (ms: number) =>
  `${jstDate(ms).replaceAll("-", "/")} ${jstClock(ms)}`;

/**
 * 確認用のページを、印字幅（target.width ドット）いっぱいの枠で囲んで描く
 *
 * 文字は印字幅に縮めず、刷るドットの大きさで描く（58mm の紙にも収まる大きさ）。
 */
const drawTestPage = async (
  target: TestPrintTarget,
  printedAt: number,
): Promise<RasterImage> => {
  const lines = [
    `IP ${target.address}`,
    `用紙 ${target.paperWidth}・${target.paperType}`,
    `印字幅 ${target.width} ドット`,
    ...(target.model ? [`機種 ${target.model}`] : []),
  ];
  const printedAtText = dateTime(printedAt);
  await loadFonts([TITLE_TEXT, target.name, ...lines, printedAtText]);

  const { width } = target;
  const height =
    (BORDER + PADDING) * 2 + TITLE_LINE + (lines.length + 1) * LINE;
  const { ctx } = createCanvas(width, height);

  // 印字幅いっぱいの枠
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, BORDER);
  ctx.fillRect(0, height - BORDER, width, BORDER);
  ctx.fillRect(0, 0, BORDER, height);
  ctx.fillRect(width - BORDER, 0, BORDER, height);

  const left = BORDER + PADDING;
  const right = width - BORDER - PADDING;
  const fit = (text: string, style: TextStyle) =>
    fitText(text, right - left, (t) => textWidth(ctx, t, style));

  let top = BORDER + PADDING;
  drawText(ctx, TITLE_TEXT, left, top + TITLE_LINE / 2, TITLE);
  drawText(ctx, target.name, right, top + TITLE_LINE / 2, TARGET_NAME);
  top += TITLE_LINE;
  for (const line of lines) {
    drawText(ctx, fit(line, BODY), left, top + LINE / 2, BODY);
    top += LINE;
  }
  drawText(ctx, printedAtText, left, top + LINE / 2, PRINTED_AT);

  return toRasterImage(ctx);
};

// ---- 確認用のページ（ラベル用） ----

/** 枠の線の太さ（ドット） */
const STICKER_BORDER = 3;

/** 目盛りの数字 */
const RULER_NUMBER: TextStyle = {
  size: 15,
  weight: 700,
  align: "center",
  baseline: "top",
};

/** 目盛りの線の長さ（10mm・5mm・1mm ごと） */
const tickLength = (mm: number) => (mm % 10 === 0 ? 20 : mm % 5 === 0 ? 12 : 6);

/** 濃さを確かめる段階の網点（8 × 8 の Bayer 行列） */
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/** mm を小数 1 桁まで（29、45、0.5 など） */
const mm = (dots: number) =>
  `${Math.round((dots / PRINTER_DOTS_PER_MM) * 10) / 10}`;

/**
 * ラベル用の確認用のページ（シール 1 枚分）
 *
 * 余白の内側を枠で囲み、上と左に目盛り、右と下の辺の真ん中に三角、大きさ・IP アドレスの文字と、濃さの段階を描く。
 * 目盛りは、最初に刷られる点（画像の左上）からの距離。180° 回す設定でも回さない（目盛りの読み方が変わらないように）。
 */
const drawLabelTestPage = async ({
  address,
  geometry,
}: LabelTestPrintTarget): Promise<StickerLabel> => {
  const { width: W, height: H, margin: m } = geometry;
  const lines = [
    `${W} × ${H} ドット`,
    `${mm(W)} × ${mm(H)} mm`,
    `余白 ${mm(m)} mm`,
    `ラベル用 ${address}`,
  ];
  await loadFonts([...lines, "0123456789"]);
  const { ctx } = createCanvas(W, H);
  const [left, top, right, bottom] = [m, m, W - m, H - m];
  ctx.fillStyle = "#000";

  // 余白の内側の枠
  ctx.fillRect(left, top, right - left, STICKER_BORDER);
  ctx.fillRect(left, bottom - STICKER_BORDER, right - left, STICKER_BORDER);
  ctx.fillRect(left, top, STICKER_BORDER, bottom - top);
  ctx.fillRect(right - STICKER_BORDER, top, STICKER_BORDER, bottom - top);

  // 上の目盛り（縦の線）と、左の目盛り（横の線）。線の太さは 2 ドット
  const firstTick = (from: number) =>
    Math.ceil(from / PRINTER_DOTS_PER_MM) * PRINTER_DOTS_PER_MM;
  for (let d = firstTick(left); d <= right - 2; d += PRINTER_DOTS_PER_MM) {
    const tick = d / PRINTER_DOTS_PER_MM;
    const length = tickLength(tick);
    ctx.fillRect(d, top, 2, length);
    if (tick % 10 === 0 && tick > 0 && d + 14 < right) {
      drawText(ctx, `${tick}`, d + 1, top + length + 2, RULER_NUMBER);
    }
  }
  for (let d = firstTick(top); d <= bottom - 2; d += PRINTER_DOTS_PER_MM) {
    const tick = d / PRINTER_DOTS_PER_MM;
    const length = tickLength(tick);
    ctx.fillRect(left, d, length, 2);
    if (tick % 10 === 0 && tick > 0 && d + 10 < bottom) {
      drawText(ctx, `${tick}`, left + length + 3, d + 1, {
        ...RULER_NUMBER,
        align: "left",
        baseline: "middle",
      });
    }
  }

  // 下と右の辺の真ん中の三角（drawText のあとも塗りは黒のまま）
  ctx.beginPath();
  ctx.moveTo(W / 2 - 9, bottom - 2);
  ctx.lineTo(W / 2 + 9, bottom - 2);
  ctx.lineTo(W / 2, bottom - 16);
  ctx.closePath();
  ctx.moveTo(right - 2, H / 2 - 9);
  ctx.lineTo(right - 2, H / 2 + 9);
  ctx.lineTo(right - 16, H / 2);
  ctx.closePath();
  ctx.fill();

  // 大きさ・IP アドレス。右で切れないよう左寄せにし、入らない行は描かない
  const textLeft = left + 52;
  const size = Math.min(
    24,
    Math.max(11, Math.floor((right - 24 - textLeft) / 11)),
  );
  const style: TextStyle = { size, weight: 700, baseline: "top" };
  let y = top + 44;
  for (const line of lines) {
    if (y + size > bottom - 20) break;
    drawText(
      ctx,
      fitText(line, right - 24 - textLeft, (t) => textWidth(ctx, t, style)),
      textLeft,
      y,
      style,
    );
    y += Math.round(size * 1.35);
  }

  // 濃さの段階（網点で 6 段）。入らなければ描かない
  const steps = 6;
  const stepWidth = Math.floor((right - 24 - textLeft) / steps);
  const wedgeTop = y + 6;
  const wedgeHeight = Math.min(24, bottom - 20 - wedgeTop);
  if (stepWidth > 8 && wedgeHeight >= 8) {
    const image = ctx.getImageData(0, 0, W, H);
    for (let step = 0; step < steps; step++) {
      const tone = 255 - Math.round(((step + 1) * 255) / steps);
      const x0 = textLeft + step * stepWidth;
      for (let yy = wedgeTop; yy < wedgeTop + wedgeHeight; yy++) {
        for (let xx = x0; xx < x0 + stepWidth - 4; xx++) {
          const value = tone < (BAYER8[yy & 7][xx & 7] + 0.5) * 4 ? 0 : 255;
          image.data.fill(value, (yy * W + xx) * 4, (yy * W + xx) * 4 + 3);
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  return toStickerLabel(ctx, false);
};

// ---- 見本 ----

const itemType = (name: string, needsBrew: boolean): ItemType => ({
  name,
  display_name: name,
  makes_cup: needsBrew,
  needs_brew: needsBrew,
  senior_only: false,
  iced_brew: false,
  serve_with_snack: false,
});

const menu = (
  name: string,
  price: number,
  type: ItemType,
  dripper: number | null = null,
) =>
  MenuEntity.fromMenu({
    id: name,
    name,
    abbr: name,
    price,
    key: name,
    item_type: type,
    assignee: null,
    dripper,
  });

/**
 * 見本の注文（No.0）。指名ありのカップ・指名なしのカップ・カップを作らない商品を 1 つずつ
 *
 * シールはカップ 2 枚（指名ありと指名なし。カップを作らない商品は刷らない）、レシートは現金でお釣りあり。
 */
const sampleOrder = () => {
  const coffee = itemType("hot", true);
  const goods = itemType("goods", false);
  const order = OrderEntity.createNew({ orderId: 0 });
  order.menus = [
    menu("ブレンド", 400, coffee, 1),
    menu("カフェオレ", 450, coffee),
    menu("クッキー", 200, goods),
  ];
  order.received = 1100;
  return order;
};

/**
 * ラベル用のテスト印刷。確認用のページと、緊急のシール（ここから・ここまで）で挟んだ見本の注文のカップのシール（2 枚）
 */
export const labelTestPrintJob = async (
  target: LabelTestPrintTarget,
): Promise<PrintJob> => {
  const testPage = await drawLabelTestPage(target);
  const { start, end } = await emergencyStickers(target.geometry);
  return {
    labels: [
      testPage,
      start,
      ...orderLabelJob(sampleOrder(), target.geometry).labels,
      end,
    ],
  };
};

/** レシート用のテスト印刷。確認用のページと見本のレシートを続けて刷り、最後に切る */
export const receiptTestPrintJob = async (
  target: TestPrintTarget,
): Promise<PrintJob> => ({
  labels: [
    { type: "image", image: await drawTestPage(target, Date.now()) },
    ...(await orderReceiptJob(target.width, sampleOrder(), { method: "cash" }))
      .labels,
  ],
});

// ---- 刷る ----

/**
 * テスト印刷の結果
 *
 * - printed: プリンターが刷れたと返した
 * - failed: つながったが刷れなかった（紙切れ・カバーが開いている・返事が来ないなど）
 * - unreachable: つながらなかった
 */
export type PrintOnceResult = "printed" | "failed" | "unreachable";

/** つながるのを待つ時間（ミリ秒）。SDK が答えないまま待ち続けないように */
export const PRINT_ONCE_CONNECT_TIMEOUT_MS = 60_000;

/**
 * プリンターにつないで 1 回だけ刷り、切る
 *
 * レジの usePrinter と違い、刷れなくても残さず、送り直さない（結果を返すだけ）。
 * job は作り終わるのを待ってから送る（画像を描くのと、つなぐのを並べて進められる）。
 */
export const printOnce = (
  createPrinter: CreateLabelPrinter,
  job: Promise<PrintJob>,
) =>
  new Promise<PrintOnceResult>((resolve) => {
    // つながらずに終わったときも、作れなかった job を未処理の reject にしない
    job.catch(() => {});
    // つながった・つながらなかったと分かったら、あとのつながり具合は見ない（刷っている間に切れたら print が false を返す）
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      finish("unreachable");
    }, PRINT_ONCE_CONNECT_TIMEOUT_MS);
    const printer = createPrinter((status) => {
      if (settled || status === "connecting") return;
      settled = true;
      clearTimeout(timer);
      if (status === "disconnected") {
        finish("unreachable");
        return;
      }
      void job
        .then((built) => printer.print(built))
        .catch((error) => {
          console.error("テスト印刷の印刷データを作れませんでした", error);
          return false;
        })
        .then((printed) => finish(printed ? "printed" : "failed"));
    });
    const finish = (result: PrintOnceResult) => {
      printer.disconnect();
      resolve(result);
    };
    printer.connect();
  });
