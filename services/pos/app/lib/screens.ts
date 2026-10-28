import { useCallback, useEffect, useReducer, useState } from "react";

// つないでいる画面（Window Management API）。呼び出し画面を外部ディスプレイに全画面で出すのに使う。
// PC 版の Chrome・Edge（100 から）だけが持つ。Safari・Firefox・スマホ・iPad には無い。
// 画面の一覧を読むには「ウィンドウの管理」の許可（window-management）が要り、初めて getScreenDetails() を呼ぶとブラウザが聞く。
// TypeScript の DOM の型には無いので、使うところだけここで書く（https://w3c.github.io/window-management/）

/** 画面 1 つ。座標はすべての画面をまとめた座標（メインの画面の左上が 0, 0） */
export interface ScreenDetailed extends Screen {
  readonly availLeft: number;
  readonly availTop: number;
  readonly left: number;
  readonly top: number;
  readonly isPrimary: boolean;
  /** ノート PC の画面など、本体に付いている画面か */
  readonly isInternal: boolean;
  readonly devicePixelRatio: number;
  /** OS が付けた名前。空のこともある */
  readonly label: string;
}

/** 画面の一覧。つないだ・外したら screenschange、このウィンドウの画面が変わったら currentscreenchange が来る */
export interface ScreenDetails extends EventTarget {
  readonly screens: readonly ScreenDetailed[];
  /** このウィンドウのある画面。screens のどれかと === で比べられる */
  readonly currentScreen: ScreenDetailed;
}

type WindowWithScreens = Window & {
  getScreenDetails?: () => Promise<ScreenDetails>;
};

type ScreenWithExtended = Screen &
  EventTarget & {
    /** 画面が 2 つ以上あるか。許可が無くても読める */
    isExtended?: boolean;
  };

/** 全画面にするときに出す先の画面を渡せる（Window Management API の足したもの） */
type FullscreenOnScreenOptions = FullscreenOptions & {
  screen?: ScreenDetailed;
};

/** 「ウィンドウの管理」の許可。聞けなければ unknown */
export type ScreenPermission = PermissionState | "unknown";

/** 画面を選べるブラウザか（getScreenDetails があるか） */
export const canPickScreen = () =>
  typeof window !== "undefined" && "getScreenDetails" in window;

const isExtended = () =>
  typeof window !== "undefined" &&
  (window.screen as ScreenWithExtended).isExtended === true;

/**
 * 出す先の画面の既定。このウィンドウの無い画面のうち、本体に付いていないもの（外部ディスプレイ）を先に選ぶ。
 * ほかに画面が無ければ、このウィンドウの画面
 */
export const pickTargetScreen = <T extends Pick<ScreenDetailed, "isInternal">>(
  screens: readonly T[],
  current: T,
): T => {
  const others = screens.filter((screen) => screen !== current);
  return others.find((screen) => !screen.isInternal) ?? others[0] ?? current;
};

/**
 * 小窓（設定の画面）を開く画面。出す先と同じ画面に開くと全画面が解けるので、別の画面にする。
 * このウィンドウの画面が出す先でなければそこ、そうでなければほかの画面。ほかに無ければ開かない（null）
 */
export const pickCompanionScreen = <T>(
  screens: readonly T[],
  target: T,
  current: T,
): T | null => {
  if (current !== target) return current;
  return screens.find((screen) => screen !== target) ?? null;
};

/** 画面の名前。OS が名前を付けていなければ、並びの番号で呼ぶ */
export const screenName = (
  screen: Pick<ScreenDetailed, "label">,
  index: number,
) => screen.label.trim() || `ディスプレイ ${index + 1}`;

/**
 * このページ（documentElement）を全画面にする。target を渡せばその画面で（Window Management API）、
 * null なら今の画面で。クリックなどの操作の中で呼ぶこと
 */
export const enterFullscreen = (target: ScreenDetailed | null) => {
  const options: FullscreenOnScreenOptions = target
    ? { navigationUI: "hide", screen: target }
    : { navigationUI: "hide" };
  return document.documentElement.requestFullscreen(options);
};

/** 許可の状態を聞く。Chrome 111 より前は window-placement という名前だった */
const queryPermission = async (): Promise<PermissionStatus | null> => {
  for (const name of ["window-management", "window-placement"]) {
    try {
      return await navigator.permissions.query({
        name: name as PermissionName,
      });
    } catch {
      // 知らない名前なら、もう 1 つの名前で聞く
    }
  }
  return null;
};

/**
 * つないでいる画面の一覧。許可済みなら開いたときに読み、まだなら request で許可を聞いて読む。
 * 画面をつないだ・外したら描き直す
 */
export function useScreenDetails() {
  const supported = canPickScreen();
  const [extended, setExtended] = useState(isExtended);
  const [permission, setPermission] = useState<ScreenPermission>("unknown");
  const [details, setDetails] = useState<ScreenDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // 画面をつないだ・外したら isExtended が変わる（screen の change で知る。Window Management API の無いブラウザでは来ない）
  useEffect(() => {
    const screen = window.screen as ScreenWithExtended;
    const update = () => setExtended(isExtended());
    screen.addEventListener?.("change", update);
    return () => screen.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!supported) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const update = () => {
      if (status) setPermission(status.state);
    };
    void queryPermission().then((result) => {
      if (cancelled || !result) return;
      status = result;
      update();
      result.addEventListener("change", update);
    });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", update);
    };
  }, [supported]);

  /** 画面の一覧を読む。許可がまだなら、ブラウザが許可を聞く */
  const request = useCallback(async () => {
    const getScreenDetails = (window as WindowWithScreens).getScreenDetails;
    if (!getScreenDetails) return;
    try {
      setDetails(await getScreenDetails.call(window));
      setFailed(false);
    } catch {
      // 断られた（NotAllowedError）。許可の状態は permission の change で変わる
      setFailed(true);
    }
  }, []);

  // 許可済みなら聞かれないので、開いたときに読んでおく
  useEffect(() => {
    if (permission === "granted" && !details) void request();
  }, [permission, details, request]);

  useEffect(() => {
    if (!details) return;
    details.addEventListener("screenschange", rerender);
    details.addEventListener("currentscreenchange", rerender);
    return () => {
      details.removeEventListener("screenschange", rerender);
      details.removeEventListener("currentscreenchange", rerender);
    };
  }, [details]);

  return {
    /** 画面を選べるブラウザか */
    supported,
    /** 画面が 2 つ以上あるか */
    extended,
    permission,
    /** 画面の一覧（読めていなければ null）。描き直すたびに今の一覧を読む */
    screens: details?.screens ?? null,
    currentScreen: details?.currentScreen ?? null,
    /** 読もうとして断られたか */
    failed,
    request,
  };
}
