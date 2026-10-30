import { afterEach, describe, expect, test, vi } from "vitest";
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

function interaction(
  type: "click" | "keydown",
  properties: Record<string, unknown> = {},
  path: unknown[] = [],
) {
  return Object.assign(new Event(type, { cancelable: true }), {
    ...properties,
    composedPath: () => path,
  });
}

afterEach(() => vi.useRealTimers());

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

  test("WebKitの遅延通知を待つ間は重複要求せず、完了後は監視を解除する", async () => {
    const { doc, events } = display();
    const request = vi.fn(() => {});
    Object.assign(events.documentElement, {
      requestFullscreen: undefined,
      webkitRequestFullscreen: request,
    });
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
    events.webkitFullscreenElement =
      events.documentElement as unknown as Element;
    events.dispatchEvent(new Event("webkitfullscreenchange"));
    events.webkitFullscreenElement = null;
    events.dispatchEvent(new Event("webkitfullscreenchange"));
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  test("WebKitのエラー通知後は、次の操作で再試行できる", async () => {
    const { doc, events } = display();
    const request = vi.fn(() => {});
    Object.assign(events.documentElement, {
      requestFullscreen: undefined,
      webkitRequestFullscreen: request,
    });
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    events.dispatchEvent(new Event("webkitfullscreenerror"));
    events.dispatchEvent(new Event("click"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  test("WebKitから通知がなくても、時間を置いた後の操作で再試行できる", async () => {
    vi.useFakeTimers();
    const { doc, events } = display();
    const request = vi.fn(() => {});
    Object.assign(events.documentElement, {
      requestFullscreen: undefined,
      webkitRequestFullscreen: request,
    });
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    // 時間経過だけでは全画面要求しない。
    expect(request).toHaveBeenCalledTimes(1);
    events.dispatchEvent(new Event("click"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("要求のPromiseが未完了の間も重複要求を防ぐ", async () => {
    const { doc, events, request, enter } = display();
    let complete!: () => void;
    request.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const stop = requestFullscreenOnLoad(doc);
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
    await enter();
    complete();
    await Promise.resolve();
    stop();
  });

  test("CM動画など別要素の全画面表示が解除されても自動再突入しない", async () => {
    const { doc, events, request } = display();
    request.mockRejectedValue(new TypeError("User activation required"));
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    events.fullscreenElement = { tagName: "VIDEO" } as Element;
    events.dispatchEvent(new Event("fullscreenchange"));
    events.fullscreenElement = null;
    events.dispatchEvent(new Event("fullscreenchange"));
    events.dispatchEvent(new Event("click"));
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  test("入力・ボタン・リンク・動画とその子要素や編集領域の操作を優先する", async () => {
    const { doc, events, request } = display();
    request.mockRejectedValue(new TypeError("User activation required"));
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    const targets = [
      ...[
        "INPUT",
        "TEXTAREA",
        "SELECT",
        "BUTTON",
        "A",
        "VIDEO",
        "AUDIO",
        "SUMMARY",
      ].map((tagName) => ({ tagName })),
      { tagName: "DIV", isContentEditable: true },
      ...[
        "button",
        "link",
        "textbox",
        "combobox",
        "checkbox",
        "radio",
        "switch",
        "slider",
        "spinbutton",
        "listbox",
        "menuitem",
      ].map((role) => ({ tagName: "DIV", getAttribute: () => role })),
    ];
    for (const target of targets) {
      for (const type of ["click", "keydown"] as const) {
        // 子のspanやShadow DOM内の要素から始まった操作を模す。
        const event = interaction(type, { key: "Enter" }, [
          { tagName: "SPAN" },
          target,
        ]);
        const normalOperation = vi.fn();
        events.addEventListener(type, normalOperation, { once: true });
        events.dispatchEvent(event);
        expect(normalOperation).toHaveBeenCalledWith(event);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    expect(request).toHaveBeenCalledTimes(1);
    // 背景上の操作は引き続き再試行できる。
    events.dispatchEvent(interaction("click", {}, [{ tagName: "DIV" }]));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  test("ほかの操作がpreventDefaultしたイベントでは再試行しない", async () => {
    const { doc, events, request } = display();
    request.mockRejectedValue(new TypeError("User activation required"));
    events.addEventListener("keydown", (event) => event.preventDefault());
    events.addEventListener("click", (event) => event.preventDefault());
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    events.dispatchEvent(interaction("keydown", { key: "Enter" }));
    events.dispatchEvent(interaction("click"));
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  test("IME変換・修飾キー・キーリピートでは再試行しない", async () => {
    const { doc, events, request } = display();
    request.mockRejectedValue(new TypeError("User activation required"));
    const stop = requestFullscreenOnLoad(doc);
    await Promise.resolve();
    for (const properties of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      for (const key of ["Enter", " "]) {
        events.dispatchEvent(interaction("keydown", { key, ...properties }));
      }
    }
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });
});
