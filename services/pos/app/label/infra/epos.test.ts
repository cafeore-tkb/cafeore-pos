import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type PrintJob, packImage } from "../document";
import {
  DEFAULT_EPOS_PRINTER_CONFIG,
  EPOS_SECURE_PORT,
  type EposBuilder,
  RECEIPT_EPOS_PRINTER_CONFIG,
  createEposPrinter,
  eposPrinterAt,
  labelPrinterAt,
  writeEposJob,
} from "./epos";
import type { PrinterConnectionStatus } from "./printer";

/** プリンターの返事 */
type Reply = { success: boolean; code: string };

/**
 * 積まれた命令を [名前, ...引数] で覚える builder
 *
 * send するとすぐ reply を返事として返す（null なら返さない。あとで device.onreceive を呼ぶ）。
 */
const recordingBuilder = (
  reply: Reply | null = { success: true, code: "" },
) => {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const builder: EposBuilder & {
    timeout: number;
    send: () => void;
    onreceive: ((response: Reply) => void) | null;
    onerror: ((error: unknown) => void) | null;
  } = {
    timeout: 10_000,
    FEED_CURRENT_TOF: "current_tof",
    FEED_NEXT_TOF: "next_tof",
    FEED_PEELING: "peeling",
    ALIGN_LEFT: "left",
    ALIGN_CENTER: "center",
    CUT_FEED: "cut_feed",
    DIRECTION_RIGHT_TO_LEFT: "right_to_left",
    COLOR_1: "color_1",
    MODE_MONO: "mono",
    addTextLang: record("addTextLang"),
    addTextAlign: record("addTextAlign"),
    addTextSize: record("addTextSize"),
    addText: record("addText"),
    addPageBegin: record("addPageBegin"),
    addPageEnd: record("addPageEnd"),
    addPageArea: record("addPageArea"),
    addPageDirection: record("addPageDirection"),
    addPagePosition: record("addPagePosition"),
    addLogo: record("addLogo"),
    // 画像は context から読める画素を覚える
    addImage: (context, ...args) => {
      calls.push(["addImage", context.getImageData(), ...args]);
    },
    addFeedLine: record("addFeedLine"),
    addFeedPosition: record("addFeedPosition"),
    addCut: record("addCut"),
    send: () => {
      calls.push(["send"]);
      if (reply) builder.onreceive?.(reply);
    },
    onreceive: null,
    onerror: null,
  };
  return { builder, calls };
};

/** ラベル用で、剥離位置まで送る設定 */
const PEELING_CONFIG = {
  ...DEFAULT_EPOS_PRINTER_CONFIG,
  trailingFeed: "peeling",
} as const;

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
  test("印刷データを ePOS の命令にし、剥離位置まで送るなら最後に 1 回だけ送る", () => {
    const { builder, calls } = recordingBuilder();

    writeEposJob(builder, job, PEELING_CONFIG);

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
      // 一連の印刷の最後に 1 回だけ
      ["addFeedPosition", "peeling"],
    ]);
  });

  test("空のシールを 1 枚送るなら、最後に次のシールの先頭へ送って白（8 × 8 ドット）を刷り、その次のシールの先頭まで送る", () => {
    const { builder, calls } = recordingBuilder();

    writeEposJob(
      builder,
      { labels: [{ type: "flow", lines: [[{ text: "ラテ", size: [1, 1] }]] }] },
      { ...DEFAULT_EPOS_PRINTER_CONFIG, trailingFeed: "blank_label" },
    );

    expect(calls).toEqual([
      ["addTextLang", "ja"],
      ["addTextSize", 2, 2],
      ["addTextSize", 1, 1],
      ["addText", "ラテ\n"],
      ["addFeedPosition", "current_tof"],
      [
        "addImage",
        {
          width: 8,
          height: 8,
          data: new Uint8ClampedArray(8 * 8 * 4).fill(255),
        },
        0,
        0,
        8,
        8,
        "color_1",
        "mono",
      ],
      ["addFeedPosition", "next_tof"],
    ]);
  });

  test("ラベル用の既定は、空のシールを 1 枚送る", () => {
    expect(DEFAULT_EPOS_PRINTER_CONFIG.trailingFeed).toBe("blank_label");
  });

  test("rotate180 の fixed は、範囲を置いてから向きを 180° にして置く", () => {
    const { builder, calls } = recordingBuilder();
    const rotated: PrintJob = {
      labels: [
        {
          type: "fixed",
          area: { x: 0, y: 0, width: 360, height: 208 },
          elements: [{ type: "logo", x: 230, y: 204 }],
          rotate180: true,
        },
      ],
    };

    writeEposJob(builder, rotated, PEELING_CONFIG);

    expect(calls).toEqual([
      ["addTextLang", "ja"],
      ["addTextSize", 2, 2],
      ["addFeedPosition", "current_tof"],
      ["addPageBegin"],
      ["addPageArea", 0, 0, 360, 208],
      ["addPageDirection", "right_to_left"],
      ["addPagePosition", 230, 204],
      ["addLogo", 32, 32],
      ["addPageEnd"],
      ["addFeedPosition", "peeling"],
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
      trailingFeed: 1,
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
      { logoKey: [32, 32], trailingFeed: 1, cut: true },
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

  test("シール 1 枚分の画像は、シールの先頭へ送ってから左端から刷る。続けて刷っても剥離位置へは最後に 1 回だけ送る", () => {
    const { builder, calls } = recordingBuilder();
    // 黒・白の 2 ドット
    const image = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const sticker = { type: "sticker", image: packImage(image) } as const;

    writeEposJob(builder, { labels: [sticker, sticker] }, PEELING_CONFIG);

    const printed = [
      ["addFeedPosition", "current_tof"],
      ["addTextAlign", "left"],
      ["addImage", image, 0, 0, 2, 1, "color_1", "mono"],
    ];
    expect(calls).toEqual([
      ["addTextLang", "ja"],
      ["addTextSize", 2, 2],
      ...printed,
      ...printed,
      ["addFeedPosition", "peeling"],
    ]);
  });
});

describe("[unit] createEposPrinter", () => {
  // つながったポートを覚える先。テストごとに空にする
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * createDevice まで成功する ePOSDevice の偽物
   *
   * deferConnect なら connect の応答を返さず、pending に貯める（あとで呼ぶ）。
   * failPorts のポートには、つながらなかった（ERROR_TIMEOUT）と返す。
   */
  const stubEpson = (
    device: ReturnType<typeof recordingBuilder>["builder"],
    {
      deferConnect = false,
      failPorts = [],
    }: { deferConnect?: boolean; failPorts?: number[] } = {},
  ) => {
    const pending: ((r: string) => void)[] = [];
    const connect = vi.fn(
      (_address: string, port: number, callback: (r: string) => void) => {
        if (deferConnect) {
          pending.push(callback);
        } else {
          callback(failPorts.includes(port) ? "ERROR_TIMEOUT" : "OK");
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

  test("つないでから刷ると、命令を積んで 1 回送る", async () => {
    const { builder, calls } = recordingBuilder();
    const { connect, createDevice } = stubEpson(builder);
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    await printer.print(job);

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
    // ピーラーでシールを取るまで待てるよう、プリンターの待ち時間を延ばす
    expect(builder.timeout).toBe(DEFAULT_EPOS_PRINTER_CONFIG.printTimeoutMs);
  });

  test("つながっていなければ刷らず、disconnected を知らせる", async () => {
    const { builder, calls } = recordingBuilder();
    stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    await printer.print(job);

    expect(statuses).toEqual(["disconnected"]);
    expect(calls).toEqual([]);
  });

  test("刷れたと返したら true、つながっていなければ false を返す", async () => {
    const { builder } = recordingBuilder();
    stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const printer = createEposPrinter(() => {});
    expect(await printer.print(job)).toBe(false);
    printer.connect();
    expect(await printer.print(job)).toBe(true);
  });

  test("プリンターが失敗を返したら false（つながりはそのまま）", async () => {
    const { builder } = recordingBuilder({
      success: false,
      code: "EPTR_REC_EMPTY",
    });
    stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();

    expect(await printer.print(job)).toBe(false);
    expect(statuses).toEqual(["connecting", "connected"]);
  });

  test("返事が来なければ false にし、つながりを切る", async () => {
    vi.useFakeTimers();
    const { builder, calls } = recordingBuilder(null);
    const { disconnect } = stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    const printed = printer.print(job);
    await vi.advanceTimersByTimeAsync(
      DEFAULT_EPOS_PRINTER_CONFIG.responseTimeoutMs,
    );

    expect(await printed).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("disconnected");
    // 切ったので、次は送らない
    expect(await printer.print(job)).toBe(false);
    expect(calls.filter(([name]) => name === "send")).toHaveLength(1);
    vi.useRealTimers();
  });

  test("返事を待つ間にやめていたら、時間切れでも知らせない", async () => {
    vi.useFakeTimers();
    const { builder } = recordingBuilder(null);
    const { disconnect } = stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    const printed = printer.print(job);
    await vi.advanceTimersByTimeAsync(0); // 送るまで進める
    printer.disconnect();
    await vi.advanceTimersByTimeAsync(
      DEFAULT_EPOS_PRINTER_CONFIG.responseTimeoutMs,
    );

    expect(await printed).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connecting", "connected"]);
    vi.useRealTimers();
  });

  test("前の印刷の返事を待ってから次を送る", async () => {
    const { builder, calls } = recordingBuilder(null);
    stubEpson(builder);
    const printer = createEposPrinter(() => {});
    printer.connect();
    const sends = () => calls.filter(([name]) => name === "send").length;

    const first = printer.print(job);
    const second = printer.print(job);
    await Promise.resolve();
    expect(sends()).toBe(1);

    builder.onreceive?.({ success: true, code: "" });
    expect(await first).toBe(true);
    expect(sends()).toBe(2);
    builder.onreceive?.({ success: true, code: "" });
    expect(await second).toBe(true);
  });

  test("やめた後は、つなぎかけの応答が来ても知らせず刷らない", async () => {
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
    expect(await printer.print(job)).toBe(false);
    expect(calls).toEqual([]);
  });

  test("やめてからつなぎ直すと、新しい方の応答だけを使う（古い方がつながらなくても次のポートは試さない）", async () => {
    const { builder } = recordingBuilder();
    const { connect, pending } = stubEpson(builder, { deferConnect: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    printer.disconnect();
    printer.connect();
    pending[0]("ERROR_TIMEOUT");
    expect(statuses).toEqual(["connecting", "connecting"]);
    expect(connect).toHaveBeenCalledTimes(2);
    pending[1]("OK");

    expect(statuses).toEqual(["connecting", "connecting", "connected"]);
    expect(await printer.print(job)).toBe(true);
  });

  test("eposPrinterAt はアドレスだけ変え、ほかは渡した設定のまま", async () => {
    const { builder, calls } = recordingBuilder();
    const { connect } = stubEpson(builder);

    const printer = eposPrinterAt(
      "10.0.0.3",
      RECEIPT_EPOS_PRINTER_CONFIG,
    )(() => {});
    printer.connect();
    await printer.print({ labels: [{ type: "flow", lines: [] }] });

    expect(connect).toHaveBeenCalledWith(
      "10.0.0.3",
      RECEIPT_EPOS_PRINTER_CONFIG.port,
      expect.any(Function),
    );
    expect(calls.slice(-3)).toEqual([
      ["addFeedLine", RECEIPT_EPOS_PRINTER_CONFIG.trailingFeed],
      ["addCut", "cut_feed"],
      ["send"],
    ]);
    expect(builder.timeout).toBe(RECEIPT_EPOS_PRINTER_CONFIG.printTimeoutMs);
  });

  test("labelPrinterAt はラベル用の設定で、アドレスと最後の送り方だけ変える", async () => {
    const { builder, calls } = recordingBuilder();
    const { connect } = stubEpson(builder);

    const printer = labelPrinterAt("10.0.0.2", "peeling")(() => {});
    printer.connect();
    await printer.print({ labels: [{ type: "flow", lines: [] }] });

    expect(connect).toHaveBeenCalledWith(
      "10.0.0.2",
      DEFAULT_EPOS_PRINTER_CONFIG.port,
      expect.any(Function),
    );
    expect(calls.slice(-2)).toEqual([["addFeedPosition", "peeling"], ["send"]]);
    expect(builder.timeout).toBe(DEFAULT_EPOS_PRINTER_CONFIG.printTimeoutMs);
  });

  const connectedPorts = (connect: ReturnType<typeof stubEpson>["connect"]) =>
    connect.mock.calls.map(([, port]) => port);

  test("8008 でつながらなければ 8043 でつなぎ直し、次からはそのアドレスだけ 8043 から試す", async () => {
    const { builder } = recordingBuilder();
    const { connect, disconnect } = stubEpson(builder, {
      failPorts: [DEFAULT_EPOS_PRINTER_CONFIG.port],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();

    expect(connectedPorts(connect)).toEqual([
      DEFAULT_EPOS_PRINTER_CONFIG.port,
      EPOS_SECURE_PORT,
    ]);
    // つながらなかった方は切る
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(await printer.print(job)).toBe(true);

    connect.mockClear();
    createEposPrinter(() => {}).connect();
    eposPrinterAt("10.0.0.3")(() => {}).connect();
    expect(connectedPorts(connect)).toEqual([
      EPOS_SECURE_PORT,
      DEFAULT_EPOS_PRINTER_CONFIG.port,
      EPOS_SECURE_PORT,
    ]);
  });

  test("8008 でつながる端末は 8008 だけで、8043 は試さない", () => {
    const { builder } = recordingBuilder();
    const { connect } = stubEpson(builder);

    createEposPrinter(() => {}).connect();
    createEposPrinter(() => {}).connect();

    expect(connectedPorts(connect)).toEqual([
      DEFAULT_EPOS_PRINTER_CONFIG.port,
      DEFAULT_EPOS_PRINTER_CONFIG.port,
    ]);
  });

  test("どのポートでもつながらなければ disconnected で、刷らない", async () => {
    const { builder, calls } = recordingBuilder();
    const { connect } = stubEpson(builder, {
      failPorts: [DEFAULT_EPOS_PRINTER_CONFIG.port, EPOS_SECURE_PORT],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();

    expect(connectedPorts(connect)).toEqual([
      DEFAULT_EPOS_PRINTER_CONFIG.port,
      EPOS_SECURE_PORT,
    ]);
    expect(statuses).toEqual(["connecting", "disconnected"]);
    expect(await printer.print(job)).toBe(false);
    expect(calls).toEqual([]);
    expect(storage.size).toBe(0);
  });

  test("送れなかった（onerror）ら false にし、つながりを切る", async () => {
    const { builder } = recordingBuilder(null);
    const { disconnect } = stubEpson(builder);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    const printer = createEposPrinter((status) => statuses.push(status));
    printer.connect();
    const printed = printer.print(job);
    await Promise.resolve();
    builder.onerror?.({ status: 0, responseText: "" });

    expect(await printed).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
  });

  test("SDK が読み込まれていなければ disconnected になる", () => {
    vi.stubGlobal("window", {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    createEposPrinter((status) => statuses.push(status)).connect();

    expect(statuses).toEqual(["connecting", "disconnected"]);
  });
});
