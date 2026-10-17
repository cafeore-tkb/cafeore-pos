import {
  type ItemType,
  MenuEntity,
  OrderEntity,
  type PrinterPaperWidth,
  jstClock,
  jstDate,
} from "@cafeore/common";
import type { PrintJob, RasterImage } from "./document";
import type { CreateLabelPrinter } from "./infra/printer";
import { orderLabelJob } from "./order-label";
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

/**
 * テスト印刷（管理画面のプリンター設定から刷る）
 *
 * 確認用のページ（どのプリンター・IP アドレス・用紙の幅か、印字幅いっぱいの枠）の後に、
 * いつも刷るものの見本（ラベル用はシール、レシート用はレシート）を続けて刷る。
 * 枠の左右が欠けたら紙より広い幅を、枠の外の余白が広ければ紙より狭い幅を選んでいる。
 */

/** テスト印刷するプリンター */
export type TestPrintTarget = {
  /** 確認用のページに載せる、どのプリンターか（「ラベル用」など） */
  name: string;
  address: string;
  paperWidth: PrinterPaperWidth;
  /** 印字幅（ドット） */
  width: number;
  /** 機種の名前（機種を選ぶレシート用だけ） */
  model?: string;
};

// ---- 確認用のページ ----

const TITLE: TextStyle = { size: 36, weight: 800 };
const TARGET_NAME: TextStyle = { size: 28, weight: 700, align: "right" };
const BODY: TextStyle = { size: 26, weight: 600 };
const PRINTED_AT: TextStyle = { size: 22, weight: 500 };

const TITLE_TEXT = "テスト印刷";

/** 枠の線の太さと、枠の内側の余白（ドット） */
const BORDER = 4;
const PADDING = 16;

const TITLE_LINE = 52;
const LINE = 36;

/** 2026/10/17 12:34:56（日本時間） */
const dateTime = (ms: number) =>
  `${jstDate(ms).replaceAll("-", "/")} ${jstClock(ms)}`;

/**
 * 確認用のページを、印字幅（target.width ドット）いっぱいの枠で囲んで描く
 *
 * 文字は印字幅に縮めず、刷るドットの大きさで描く（58mm の紙にも収まる大きさ）。
 * ラベル用のシールにも収まるよう、高さはカップのシールの範囲の終わり（y + height = 234 ドット）より低くする
 * （ラベル用は機種の行が無く 200 ドット。超えるとシールの切れ目にかかり、次のシールを飛ばして白紙が出る）。
 */
const drawTestPage = async (
  target: TestPrintTarget,
  printedAt: number,
): Promise<RasterImage> => {
  const lines = [
    `IP ${target.address}`,
    `用紙 ${target.paperWidth}・${target.width} ドット`,
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

// ---- 見本 ----

const itemType = (name: string, needsBrew: boolean): ItemType => ({
  name,
  display_name: name,
  makes_cup: needsBrew,
  needs_brew: needsBrew,
  senior_only: false,
  iced_brew: false,
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

/** ラベル用のテスト印刷。確認用のページはシールの先頭から刷る（シールの切れ目にかからないように） */
export const labelTestPrintJob = async (
  target: TestPrintTarget,
): Promise<PrintJob> => ({
  labels: [
    {
      type: "image",
      image: await drawTestPage(target, Date.now()),
      top: true,
    },
    ...orderLabelJob(sampleOrder(), target.width).labels,
  ],
});

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
