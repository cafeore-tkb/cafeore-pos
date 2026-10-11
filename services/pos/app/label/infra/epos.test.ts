import { afterEach, describe, expect, test, vi } from "vitest";
import type { PrintJob } from "../document";
import {
  DEFAULT_EPOS_PRINTER_CONFIG,
  type EposBuilder,
  RECEIPT_EPOS_PRINTER_CONFIG,
  createEposPrinter,
  eposPrinterAt,
  writeEposJob,
} from "./epos";
import type { PrinterConnectionStatus } from "./printer";

/** 積まれた命令を [名前, ...引数] で覚える builder */
const recordingBuilder = () => {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const builder: EposBuilder & { send: () => void } = {
    FEED_CURRENT_TOF: "current_tof",
    ALIGN_LEFT: "left",
    ALIGN_CENTER: "center",
    CUT_FEED: "cut_feed",
    COLOR_1: "color_1",
    MODE_MONO: "mono",
    addTextLang: record("addTextLang"),
    addTextAlign: record("addTextAlign"),
    addTextSize: record("addTextSize"),
    addText: record("addText"),
    addPageBegin: record("addPageBegin"),
    addPageEnd: record("addPageEnd"),
    addPageArea: record("addPageArea"),
    addPagePosition: record("addPagePosition"),
    addLogo: record("addLogo"),
    // 画像は context から読める画素を覚える
    addImage: (context, ...args) => {
      calls.push(["addImage", context.getImageData(), ...args]);
    },
    addFeedLine: record("addFeedLine"),
    addFeedPosition: record("addFeedPosition"),
    addCut: record("addCut"),
    send: record("send"),
  };
  return { builder, calls };
};

const job: PrintJob = {
  labels: [
    {
      type: "fixed",
      area: { x: 0, y: 24, width: 570, height: 230 },
      elements: [
        {
          type: "text",
          x: 0,
          y: 48,
          line: [
            { text: " ", size: [2, 2] },
            { text: "No.", size: [1, 1] },
          ],
        },
        { type: "logo", x: 230, y: 204 },
      ],
    },
    { type: "flow", lines: [[{ text: "ラテ", size: [1, 1] }]] },
  ],
};

describe("[unit] writeEposJob", () => {
  test("印刷データを ePOS の命令にする", () => {
    const { builder, calls } = recordingBuilder();

    writeEposJob(builder, job, {
      logoKey: [32, 32],
      trailingFeedLines: 7,
      cut: false,
    });

    expect(calls).toEqual([
      ["addTextLang", "ja"],
      ["addTextSize", 2, 2],
      // fixed: シールの先頭へ送り、ページモードで座標に置く
      ["addFeedPosition", "current_tof"],
      ["addPageBegin"],
      ["addPageArea", 0, 24, 570, 230],
      ["addPagePosition", 0, 48],
      ["addTextSize", 2, 2],
      ["addText", " "],
      ["addTextSize", 1, 1],
      // 行の最後の文字に改行を付ける
      ["addText", "No.\n"],
      ["addPagePosition", 230, 204],
      ["addLogo", 32, 32],
      ["addPageEnd"],
      // flow: 先頭へは送らず、そのまま行を流す
      ["addTextSize", 1, 1],
      ["addText", "ラテ\n"],
      ["addFeedLine", 7],
    ]);
  });

  test("中央寄せの flow は寄せてから流して左に戻し、cut なら最後に紙を切る", () => {
    const { builder, calls } = recordingBuilder();
    const receipt: PrintJob = {
      labels: [
        {
          type: "flow",
          align: "center",
          lines: [[{ text: "領収書", size: [2, 2] }], []],
        },
      ],
    };

    writeEposJob(builder, receipt, {
      logoKey: [32, 32],
      trailingFeedLines: 1,
      cut: true,
    });

    expect(calls).toEqual([
      ["addTextLang", "ja"],
      ["addTextSize", 2, 2],
      ["addTextAlign", "center"],
      ["addTextSize", 2, 2],
      ["addText", "領収書\n"],
      ["addText", "\n"],
      ["addTextAlign", "left"],
      ["addFeedLine", 1],
      ["addCut", "cut_feed"],
    ]);
  });

  test("画像は中央に寄せて白黒で刷り、左寄せに戻す", () => {
    const { builder, calls } = recordingBuilder();
    const image = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    };

    writeEposJob(
      builder,
      { labels: [{ type: "image", image }] },
      { logoKey: [32, 32], trailingFeedLines: 1, cut: true },
    );

    expect(calls).toEqual([
      ["addTextLang", "ja"],
      ["addTextSize", 2, 2],
      ["addTextAlign", "center"],
      ["addImage", image, 0, 0, 2, 1, "color_1", "mono"],
      ["addTextAlign", "left"],
      ["addFeedLine", 1],
      ["addCut", "cut_feed"],
    ]);
  });
});

describe("[unit] createEposPrinter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * createDevice まで成功する ePOSDevice の偽物
   *
   * deferConnect なら connect の応答を返さず、pending に貯める（あとで呼ぶ）。
   */
  const stubEpson = (
    device: EposBuilder & { send: () => void },
    { deferConnect = false } = {},
  ) => {
    const pending: ((r: string) => void)[] = [];
    const connect = vi.fn(
      (_address: string, _port: number, callback: (r: string) => void) => {
        if (deferConnect) {
          pending.push(callback);
        } else {
          callback("OK");
        }
      },
    );
    const createDevice = vi.fn(
      (
        _deviceId: string,
        _type: string,
        _options: unknown,
        callback: (d: typeof device, r: string) => void,
      ) => callback(device, "OK"),
    );
    const disconnect = vi.fn();
    vi.stubGlobal("window", {
      epson: {
        ePOSDevice: class {
          DEVICE_TYPE_PRINTER = "type_printer";
          connect = connect;
          createDevice = createDevice;
          disconnect = disconnect;
        },
      },
    });
    return { connect, createDevice, disconnect, pending };
  };

  test("つないでから刷ると、命令を積んで 1 回送る", () => {
    const { builder, calls } = recordingBuilder();
    const { connect, createDevice } = stubEpson(builder);
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    printer.print(job);

    expect(connect).toHaveBeenCalledWith(
      DEFAULT_EPOS_PRINTER_CONFIG.address,
      DEFAULT_EPOS_PRINTER_CONFIG.port,
      expect.any(Function),
    );
    expect(createDevice).toHaveBeenCalledWith(
      DEFAULT_EPOS_PRINTER_CONFIG.deviceId,
      "type_printer",
      { crypto: true, buffer: false },
      expect.any(Function),
    );
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(calls.filter(([name]) => name === "send")).toHaveLength(1);
    expect(calls.at(-1)).toEqual(["send"]);
  });

  test("つながっていなければ刷らず、disconnected を知らせる", () => {
    const { builder, calls } = recordingBuilder();
    stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.print(job);

    expect(statuses).toEqual(["disconnected"]);
    expect(calls).toEqual([]);
  });

  test("刷れたら true、つながっていなければ false を返す", () => {
    const { builder } = recordingBuilder();
    stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const printer = createEposPrinter(() => {});
    expect(printer.print(job)).toBe(false);
    printer.connect();
    expect(printer.print(job)).toBe(true);
  });

  test("やめた後は、つなぎかけの応答が来ても知らせず刷らない", () => {
    const { builder, calls } = recordingBuilder();
    const { disconnect, pending } = stubEpson(builder, { deferConnect: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    printer.disconnect();
    pending[0]("OK");

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connecting"]);
    expect(printer.print(job)).toBe(false);
    expect(calls).toEqual([]);
  });

  test("やめてからつなぎ直すと、新しい方の応答だけを使う", () => {
    const { builder } = recordingBuilder();
    const { pending } = stubEpson(builder, { deferConnect: true });
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    printer.disconnect();
    printer.connect();
    pending[0]("OK");
    expect(statuses).toEqual(["connecting", "connecting"]);
    pending[1]("OK");

    expect(statuses).toEqual(["connecting", "connecting", "connected"]);
    expect(printer.print(job)).toBe(true);
  });

  test("eposPrinterAt はアドレスだけ変え、ほかは渡した設定のまま", () => {
    const { builder, calls } = recordingBuilder();
    const { connect } = stubEpson(builder);

    const printer = eposPrinterAt(
      "10.0.0.3",
      RECEIPT_EPOS_PRINTER_CONFIG,
    )(() => {});
    printer.connect();
    printer.print({ labels: [{ type: "flow", lines: [] }] });

    expect(connect).toHaveBeenCalledWith(
      "10.0.0.3",
      RECEIPT_EPOS_PRINTER_CONFIG.port,
      expect.any(Function),
    );
    expect(calls.slice(-3)).toEqual([
      ["addFeedLine", RECEIPT_EPOS_PRINTER_CONFIG.trailingFeedLines],
      ["addCut", "cut_feed"],
      ["send"],
    ]);
  });

  test("SDK が読み込まれていなければ disconnected になる", () => {
    vi.stubGlobal("window", {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    createEposPrinter((status) => statuses.push(status)).connect();

    expect(statuses).toEqual(["connecting", "disconnected"]);
  });
});
