import type { Label, PrintJob, RasterImage, TextLine } from "../document";
import type {
  CreateLabelPrinter,
  LabelPrinter,
  PrinterConnectionStatus,
} from "./printer";

/**
 * Epson ePOS SDK（public/epos-2.27.0.js、root.tsx で読み込む）のうち、ここで使うところだけの型
 *
 * add〜 は命令を積むだけで、send で積んだ命令（ePOS-Print の XML）をまとめて送る。
 */
export type EposBuilder = {
  FEED_CURRENT_TOF: string;
  ALIGN_LEFT: string;
  ALIGN_CENTER: string;
  CUT_FEED: string;
  COLOR_1: string;
  MODE_MONO: string;
  addTextLang: (lang: string) => unknown;
  addTextAlign: (align: string) => unknown;
  addTextSize: (width: number, height: number) => unknown;
  addText: (text: string) => unknown;
  addPageBegin: () => unknown;
  addPageEnd: () => unknown;
  addPageArea: (x: number, y: number, width: number, height: number) => unknown;
  addPagePosition: (x: number, y: number) => unknown;
  addLogo: (key1: number, key2: number) => unknown;
  /** context からは getImageData で画素（data・width・height）を読むだけ */
  addImage: (
    context: { getImageData: () => RasterImage },
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    mode: string,
  ) => unknown;
  addFeedLine: (line: number) => unknown;
  addFeedPosition: (position: string) => unknown;
  addCut: (type: string) => unknown;
};

/** プリンターの返事（ePOS の onreceive）。success が false なら code に理由（用紙切れなど） */
type EposResponse = { success: boolean; code: string };

type EposPrinterDevice = EposBuilder & {
  send: () => unknown;
  onreceive: ((response: EposResponse) => void) | null;
  onerror: ((error: unknown) => void) | null;
};

type EposDevice = {
  DEVICE_TYPE_PRINTER: string;
  connect: (
    address: string,
    port: number,
    callback: (result: string) => void,
  ) => void;
  createDevice: (
    deviceId: string,
    deviceType: string,
    options: { crypto: boolean; buffer: boolean },
    callback: (device: EposPrinterDevice | null, result: string) => void,
  ) => void;
  disconnect: () => void;
};

declare global {
  interface Window {
    epson?: { ePOSDevice: new () => EposDevice };
  }
}

export type EposPrinterConfig = {
  /** プリンターの IP アドレス */
  address: string;
  /** ePOS-Device のポート。SDK は 8008 なら http、それ以外は https でつなぐ */
  port: number;
  /** プリンターに設定してあるデバイス ID */
  deviceId: string;
  /** プリンターに登録してあるロゴのキー（key1, key2） */
  logoKey: readonly [number, number];
  /** 最後のシールを刷った後に送る行数 */
  trailingFeedLines: number;
  /** 送った後に紙を切るか（レシート用のプリンター） */
  cut: boolean;
  /** 送ってから返事を待つ時間（ミリ秒）。来なければ刷れなかったとみなし、つなぎ直すまで送らない */
  responseTimeoutMs: number;
};

/** 今使っているプリンター（ラベル用） */
export const DEFAULT_EPOS_PRINTER_CONFIG: EposPrinterConfig = {
  address: "192.168.77.2",
  port: 8008,
  deviceId: "local_printer",
  logoKey: [32, 32],
  trailingFeedLines: 7,
  cut: false,
  responseTimeoutMs: 30_000,
};

/** レシート用のプリンター。刷るたびに紙を切る */
export const RECEIPT_EPOS_PRINTER_CONFIG: EposPrinterConfig = {
  ...DEFAULT_EPOS_PRINTER_CONFIG,
  address: "192.168.77.3",
  trailingFeedLines: 1,
  cut: true,
};

const writeLine = (builder: EposBuilder, line: TextLine) => {
  if (line.length === 0) {
    builder.addText("\n");
    return;
  }
  line.forEach((run, i) => {
    builder.addTextSize(run.size[0], run.size[1]);
    builder.addText(i === line.length - 1 ? `${run.text}\n` : run.text);
  });
};

const writeLabel = (
  builder: EposBuilder,
  label: Label,
  config: Pick<EposPrinterConfig, "logoKey">,
) => {
  if (label.type === "image") {
    const { image } = label;
    builder.addTextAlign(builder.ALIGN_CENTER);
    builder.addImage(
      { getImageData: () => image },
      0,
      0,
      image.width,
      image.height,
      builder.COLOR_1,
      builder.MODE_MONO,
    );
    builder.addTextAlign(builder.ALIGN_LEFT);
    return;
  }

  if (label.type === "flow") {
    const center = label.align === "center";
    if (center) builder.addTextAlign(builder.ALIGN_CENTER);
    for (const line of label.lines) {
      writeLine(builder, line);
    }
    if (center) builder.addTextAlign(builder.ALIGN_LEFT);
    return;
  }

  // ページモード: 範囲の中に座標で置く
  builder.addFeedPosition(builder.FEED_CURRENT_TOF);
  builder.addPageBegin();
  const { x, y, width, height } = label.area;
  builder.addPageArea(x, y, width, height);
  for (const element of label.elements) {
    builder.addPagePosition(element.x, element.y);
    if (element.type === "text") {
      writeLine(builder, element.line);
    } else {
      builder.addLogo(config.logoKey[0], config.logoKey[1]);
    }
  }
  builder.addPageEnd();
};

/** 印刷データを ePOS の命令にして積む（送りはしない） */
export const writeEposJob = (
  builder: EposBuilder,
  job: PrintJob,
  config: Pick<EposPrinterConfig, "logoKey" | "trailingFeedLines" | "cut">,
) => {
  builder.addTextLang("ja");
  builder.addTextSize(2, 2);
  for (const label of job.labels) {
    writeLabel(builder, label, config);
  }
  builder.addFeedLine(config.trailingFeedLines);
  if (config.cut) builder.addCut(builder.CUT_FEED);
};

/**
 * Epson の ePOS-Device につながるプリンター
 *
 * ブラウザから直接プリンターにつなぐ（サーバーは通らない）。
 */
export const createEposPrinter = (
  onStatusChange: (status: PrinterConnectionStatus) => void,
  config: EposPrinterConfig = DEFAULT_EPOS_PRINTER_CONFIG,
): LabelPrinter => {
  let device: EposPrinterDevice | null = null;
  let ePosDev: EposDevice | null = null;
  // つなぐ・やめるたびに増やす。古いつなぎかけの応答は、これが変わっていたら捨てる
  let generation = 0;

  const disconnect = () => {
    generation += 1;
    device = null;
    // つなぎかけ・つなぎ損ねたものも切る。SDK が投げても画面は止めない
    try {
      ePosDev?.disconnect();
    } catch (error) {
      console.error("ePOSDevice disconnect failed:", error);
    }
    ePosDev = null;
  };

  const connect = () => {
    const current = generation + 1;
    generation = current;
    onStatusChange("connecting");
    if (!window.epson) {
      onStatusChange("disconnected");
      console.error("ePOSDevice not found");
      return;
    }
    const dev = new window.epson.ePOSDevice();
    ePosDev = dev;

    dev.connect(config.address, config.port, (result) => {
      if (current !== generation) return;
      if (result !== "OK" && result !== "SSL_CONNECT_OK") {
        onStatusChange("disconnected");
        console.error("ePOSDevice connect failed:", result);
        return;
      }
      dev.createDevice(
        config.deviceId,
        dev.DEVICE_TYPE_PRINTER,
        { crypto: true, buffer: false },
        (devobj, retcode) => {
          if (current !== generation) return;
          if (retcode === "OK" && devobj) {
            device = devobj;
            onStatusChange("connected");
          } else {
            onStatusChange("disconnected");
            console.error("ePOSDevice createDevice failed:", retcode);
          }
        },
      );
    });
  };

  // 1 件ずつ送り、返事を待ってから次を送る（返事がどの印刷のものか取り違えないように）
  const send = (job: PrintJob) =>
    new Promise<boolean>((resolve) => {
      const target = device;
      if (!target) {
        onStatusChange("disconnected");
        console.error("Printer not connected");
        resolve(false);
        return;
      }
      const finish = (printed: boolean) => {
        clearTimeout(timer);
        target.onreceive = null;
        target.onerror = null;
        resolve(printed);
      };
      // 返事が来ないときは、つながりが切れたとみなす（つなぎ直すまで送らない）
      const timer = setTimeout(() => {
        console.error("ePOS print timed out");
        disconnect();
        onStatusChange("disconnected");
        finish(false);
      }, config.responseTimeoutMs);
      target.onreceive = (response) => {
        if (!response.success)
          console.error("ePOS print failed:", response.code);
        finish(response.success);
      };
      target.onerror = (error) => {
        console.error("ePOS print error:", error);
        finish(false);
      };
      try {
        writeEposJob(target, job, config);
        target.send();
      } catch (error) {
        console.error("ePOS print failed:", error);
        finish(false);
      }
    });

  let last = Promise.resolve(true);
  const print = (job: PrintJob) => {
    last = last.then(() => send(job));
    return last;
  };

  return { connect, disconnect, print };
};

/** address のプリンターを作る（ほかは base の設定のまま） */
export const eposPrinterAt =
  (
    address: string,
    base: EposPrinterConfig = DEFAULT_EPOS_PRINTER_CONFIG,
  ): CreateLabelPrinter =>
  (onStatusChange) =>
    createEposPrinter(onStatusChange, { ...base, address });
