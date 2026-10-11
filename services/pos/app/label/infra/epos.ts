import type { Label, PrintJob, TextLine } from "../document";
import type { LabelPrinter, PrinterConnectionStatus } from "./printer";

/**
 * Epson ePOS SDK（public/epos-2.27.0.js、root.tsx で読み込む）のうち、ここで使うところだけの型
 *
 * add〜 は命令を積むだけで、send で積んだ命令（ePOS-Print の XML）をまとめて送る。
 */
export type EposBuilder = {
  FEED_CURRENT_TOF: string;
  addTextLang: (lang: string) => unknown;
  addTextSize: (width: number, height: number) => unknown;
  addText: (text: string) => unknown;
  addPageBegin: () => unknown;
  addPageEnd: () => unknown;
  addPageArea: (x: number, y: number, width: number, height: number) => unknown;
  addPagePosition: (x: number, y: number) => unknown;
  addLogo: (key1: number, key2: number) => unknown;
  addFeedLine: (line: number) => unknown;
  addFeedPosition: (position: string) => unknown;
};

type EposPrinterDevice = EposBuilder & { send: () => unknown };

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
};

/** 今使っているプリンター */
export const DEFAULT_EPOS_PRINTER_CONFIG: EposPrinterConfig = {
  address: "192.168.77.2",
  port: 8008,
  deviceId: "local_printer",
  logoKey: [32, 32],
  trailingFeedLines: 7,
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
  if (label.type === "flow") {
    for (const line of label.lines) {
      writeLine(builder, line);
    }
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
  config: Pick<EposPrinterConfig, "logoKey" | "trailingFeedLines">,
) => {
  builder.addTextLang("ja");
  builder.addTextSize(2, 2);
  for (const label of job.labels) {
    writeLabel(builder, label, config);
  }
  builder.addFeedLine(config.trailingFeedLines);
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

  const connect = () => {
    onStatusChange("connecting");
    if (!window.epson) {
      onStatusChange("disconnected");
      console.error("ePOSDevice not found");
      return;
    }
    const ePosDev = new window.epson.ePOSDevice();

    ePosDev.connect(config.address, config.port, (result) => {
      if (result !== "OK" && result !== "SSL_CONNECT_OK") {
        onStatusChange("disconnected");
        console.error("ePOSDevice connect failed:", result);
        return;
      }
      ePosDev.createDevice(
        config.deviceId,
        ePosDev.DEVICE_TYPE_PRINTER,
        { crypto: true, buffer: false },
        (devobj, retcode) => {
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

  const print = (job: PrintJob) => {
    if (!device) {
      onStatusChange("disconnected");
      console.error("Printer not connected");
      return;
    }
    writeEposJob(device, job, config);
    device.send();
  };

  return { connect, print };
};
