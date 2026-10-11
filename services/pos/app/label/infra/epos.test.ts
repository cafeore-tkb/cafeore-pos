import { afterEach, describe, expect, test, vi } from "vitest";
import type { PrintJob } from "../document";
import {
  DEFAULT_EPOS_PRINTER_CONFIG,
  type EposBuilder,
  createEposPrinter,
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
    addTextLang: record("addTextLang"),
    addTextSize: record("addTextSize"),
    addText: record("addText"),
    addPageBegin: record("addPageBegin"),
    addPageEnd: record("addPageEnd"),
    addPageArea: record("addPageArea"),
    addPagePosition: record("addPagePosition"),
    addLogo: record("addLogo"),
    addFeedLine: record("addFeedLine"),
    addFeedPosition: record("addFeedPosition"),
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

    writeEposJob(builder, job, { logoKey: [32, 32], trailingFeedLines: 7 });

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
});

describe("[unit] createEposPrinter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** createDevice まで成功する ePOSDevice の偽物 */
  const stubEpson = (device: EposBuilder & { send: () => void }) => {
    const connect = vi.fn(
      (_address: string, _port: number, callback: (r: string) => void) =>
        callback("OK"),
    );
    const createDevice = vi.fn(
      (
        _deviceId: string,
        _type: string,
        _options: unknown,
        callback: (d: typeof device, r: string) => void,
      ) => callback(device, "OK"),
    );
    vi.stubGlobal("window", {
      epson: {
        ePOSDevice: class {
          DEVICE_TYPE_PRINTER = "type_printer";
          connect = connect;
          createDevice = createDevice;
        },
      },
    });
    return { connect, createDevice };
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

  test("SDK が読み込まれていなければ disconnected になる", () => {
    vi.stubGlobal("window", {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: PrinterConnectionStatus[] = [];

    createEposPrinter((status) => statuses.push(status)).connect();

    expect(statuses).toEqual(["connecting", "disconnected"]);
  });
});
