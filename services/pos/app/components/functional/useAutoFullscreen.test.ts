import { describe, expect, test, vi } from "vitest";
import { requestFullscreenOnLoad } from "./useAutoFullscreen";

function display() {
  const request = vi.fn<() => Promise<void>>();
  const root = { requestFullscreen: request };
  const events = Object.assign(new EventTarget(), {
    documentElement: root,
    fullscreenElement: null as Element | null,
    webkitFullscreenElement: null as Element | null,
  });
  const doc = events as unknown as Document;
  const enter = () => {
    events.fullscreenElement = root as unknown as Element;
    events.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
  return { doc, events, request, enter };
}

describe("[unit] 客用画面の自動全画面表示", () => {
  test("読み込み時に要求し、成功後にEscで解除しても再び全画面にしない", async () => {
    const { doc, events, request, enter } = display();
    request.mockImplementation(enter);
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    expect(request).toHaveBeenCalledExactlyOnceWith({ navigationUI: "hide" });
    events.fullscreenElement = null;
    events.dispatchEvent(new Event("fullscreenchange"));
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  test("操作なしの要求が拒否されたら、次のクリックで再試行する", async () => {
    const { doc, events, request, enter } = display();
    request.mockRejectedValueOnce(new TypeError("User activation required"));
    request.mockImplementationOnce(enter);
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    events.dispatchEvent(new Event("click"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(events.fullscreenElement).not.toBeNull();
    stop();
  });

  test.each(["Enter", " "])(
    "%jキーでも再試行でき、Escは対象にしない",
    async (key) => {
      const { doc, events, request, enter } = display();
      request.mockRejectedValueOnce(new TypeError("User activation required"));
      request.mockImplementationOnce(enter);
      const stop = requestFullscreenOnLoad(doc);
      await Promise.resolve();
      events.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "Escape" }),
      );
      expect(request).toHaveBeenCalledTimes(1);
      events.dispatchEvent(Object.assign(new Event("keydown"), { key }));
      await Promise.resolve();
      expect(request).toHaveBeenCalledTimes(2);
      stop();
    },
  );

  test("画面を離れたら、クリックによる再試行を解除する", async () => {
    const { doc, events, request } = display();
    request.mockRejectedValue(new TypeError("User activation required"));
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    stop();
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("すでに全画面なら要求を追加しない", () => {
    const { doc, request, enter } = display();
    void enter();
    const stop = requestFullscreenOnLoad(doc);
    expect(request).not.toHaveBeenCalled();
    stop();
  });

  test("標準APIが無くてもWebKitの全画面APIを使える", async () => {
    const { doc, events } = display();
    const request = vi.fn(() => {
      events.webkitFullscreenElement = {} as Element;
      events.dispatchEvent(new Event("webkitfullscreenchange"));
    });
    Object.assign(events.documentElement, {
      requestFullscreen: undefined,
      webkitRequestFullscreen: request,
    });
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    events.webkitFullscreenElement = null;
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  test("全画面API未対応の環境でも表示を妨げない", () => {
    const { doc, events } = display();
    Object.assign(events.documentElement, { requestFullscreen: undefined });
    const stop = requestFullscreenOnLoad(doc);
    expect(() => events.dispatchEvent(new Event("click"))).not.toThrow();
    stop();
  });
});
