import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CmItem,
  type CmPlaylist,
  cmPlaylist,
  getCmPlaylist,
  subscribeCmPlaylist,
} from "./callscreen-cm";
import type { ScreenDetailed } from "./screens";

// 呼び出し画面の小窓（Fullscreen Companion Window。PC 版の Chrome・Edge の 104 から）。
// 呼び出し画面を外部ディスプレイに全画面で出すとき、同じクリックで手元の画面に設定の画面を小窓で開く。
// 全画面にするのは CM のファイルを持っている元のタブで、小窓は別のページなので CM の並びを持たない。
// 小窓での CM の操作は postMessage で元のタブに頼み、元のタブは並びが変わるたびに今の並びを小窓へ送る
// （blob: の URL は元のタブが作ったものを、同じオリジンの小窓もそのまま読める）。
// 音の設定は localStorage にあるので、送らなくても両方に効く（lib/callscreen-sound）。
// 表示をやめる（全画面を解く）と、元のタブが小窓を閉じる

/** 小窓で開くページ。設定の画面を小窓として出す */
export const COMPANION_PATH = "/callscreen?companion";
/** 小窓の名前。もう開いていれば、その窓で開き直す */
const COMPANION_NAME = "cafeore-callscreen-companion";
/** 小窓を開いてから元のタブの返事を待つ上限。過ぎたら、元のタブは呼び出し画面を出していないとみなす */
const HELLO_TIMEOUT_MS = 5_000;
/** 返事が来るまで頼み直す間隔（元のタブが受け始める前に頼んだときのため） */
const HELLO_RETRY_MS = 1_000;

/** 送るものに付ける印。ほかの postMessage（拡張機能など）と取り違えないため */
const SOURCE = "cafeore:callscreen-companion";

/** 小窓から元のタブへの頼み */
export type CompanionRequest =
  /** 今の並びを送ってほしい（小窓を開いた・読み込み直した） */
  | { type: "hello" }
  | { type: "add"; files: File[] }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; delta: -1 | 1 }
  | { type: "clear" }
  | { type: "image-seconds"; seconds: number }
  /** 表示をやめる（全画面を解く） */
  | { type: "stop" };

/** 元のタブから小窓へ。今の CM の並びと、出している画面の名前 */
export type HostState = {
  type: "state";
  playlist: CmPlaylist;
  screenName: string;
};

const wrap = (message: CompanionRequest | HostState) => ({
  source: SOURCE,
  ...message,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** 小窓からの頼みを読む。形の違うもの・ほかから来たものは null */
export const parseCompanionRequest = (
  data: unknown,
): CompanionRequest | null => {
  if (!isRecord(data) || data.source !== SOURCE) return null;
  switch (data.type) {
    case "hello":
    case "clear":
    case "stop":
      return { type: data.type };
    case "add":
      return Array.isArray(data.files) &&
        data.files.every((file) => file instanceof File)
        ? { type: "add", files: data.files }
        : null;
    case "remove":
      return typeof data.id === "string"
        ? { type: "remove", id: data.id }
        : null;
    case "move":
      return typeof data.id === "string" &&
        (data.delta === -1 || data.delta === 1)
        ? { type: "move", id: data.id, delta: data.delta }
        : null;
    case "image-seconds":
      return typeof data.seconds === "number"
        ? { type: "image-seconds", seconds: data.seconds }
        : null;
    default:
      return null;
  }
};

const isCmItem = (value: unknown): value is CmItem =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  (value.kind === "video" || value.kind === "image") &&
  typeof value.type === "string" &&
  typeof value.url === "string";

/** 元のタブから届いたものを読む。形の違うもの・ほかから来たものは null */
export const parseHostState = (data: unknown): HostState | null => {
  if (!isRecord(data) || data.source !== SOURCE || data.type !== "state") {
    return null;
  }
  const { playlist, screenName } = data;
  if (
    !isRecord(playlist) ||
    !Array.isArray(playlist.items) ||
    !playlist.items.every(isCmItem) ||
    typeof playlist.imageSeconds !== "number" ||
    typeof screenName !== "string"
  ) {
    return null;
  }
  return {
    type: "state",
    playlist: { items: playlist.items, imageSeconds: playlist.imageSeconds },
    screenName,
  };
};

/** 小窓を開く位置と大きさ。その画面の使える広さいっぱいに開く */
export const companionFeatures = (
  screen: Pick<
    ScreenDetailed,
    "availLeft" | "availTop" | "availWidth" | "availHeight"
  >,
) =>
  `left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`;

/**
 * 小窓を screen に開く。画面を指定して全画面にした（enterFullscreen）すぐ後なら、同じクリックのうちに開ける
 * （Fullscreen Companion Window）。開けなければ（ポップアップを止められた・対応していない）null
 */
export const openCompanion = (screen: ScreenDetailed) =>
  window.open(COMPANION_PATH, COMPANION_NAME, companionFeatures(screen));

/** 小窓の頼みで CM の並びを変える（hello・stop は呼ぶ側で扱う） */
const applyRequest = (request: CompanionRequest) => {
  switch (request.type) {
    case "add":
      cmPlaylist.add(request.files);
      return;
    case "remove":
      cmPlaylist.remove(request.id);
      return;
    case "move":
      cmPlaylist.move(request.id, request.delta);
      return;
    case "clear":
      cmPlaylist.clear();
      return;
    case "image-seconds":
      cmPlaylist.setImageSeconds(request.seconds);
      return;
  }
};

/**
 * 元のタブ（外部ディスプレイに全画面で出している方）で、小窓の頼みを受ける。
 * CM の並びを変え、変わるたびに今の並びを小窓へ送る。「表示をやめる」なら onStop を呼ぶ
 */
export function useCompanionHost(
  companion: Window | null,
  screenName: string,
  onStop: () => void,
) {
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    if (!companion) return;
    const send = () =>
      companion.postMessage(
        wrap({ type: "state", playlist: getCmPlaylist(), screenName }),
        window.location.origin,
      );
    const onMessage = (event: MessageEvent) => {
      // 自分が開いた小窓からだけ受ける（小窓を読み込み直しても同じ窓）
      if (
        event.origin !== window.location.origin ||
        event.source !== companion
      ) {
        return;
      }
      const request = parseCompanionRequest(event.data);
      if (!request) return;
      if (request.type === "hello") send();
      else if (request.type === "stop") onStopRef.current();
      else applyRequest(request);
    };
    window.addEventListener("message", onMessage);
    const unsubscribe = subscribeCmPlaylist(send);
    return () => {
      window.removeEventListener("message", onMessage);
      unsubscribe();
    };
  }, [companion, screenName]);
}

export type CompanionLink =
  | { status: "connecting" }
  | { status: "connected"; playlist: CmPlaylist; screenName: string }
  /** 開いたのが元のタブでない・返事が無い（表示をやめた、元のタブを読み込み直した） */
  | { status: "lost" };

/**
 * 小窓の側。元のタブ（window.opener）に今の並びを頼み、届いたものを返す。
 * send で元のタブに頼む
 */
export function useCompanionLink() {
  const [link, setLink] = useState<CompanionLink>({ status: "connecting" });

  useEffect(() => {
    const host = window.opener as Window | null;
    if (!host) {
      setLink({ status: "lost" });
      return;
    }
    const hello = () =>
      host.postMessage(wrap({ type: "hello" }), window.location.origin);
    const retry = setInterval(hello, HELLO_RETRY_MS);
    const timer = setTimeout(() => {
      clearInterval(retry);
      setLink((prev) =>
        prev.status === "connecting" ? { status: "lost" } : prev,
      );
    }, HELLO_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== host) {
        return;
      }
      const state = parseHostState(event.data);
      if (!state) return;
      clearInterval(retry);
      clearTimeout(timer);
      setLink({
        status: "connected",
        playlist: state.playlist,
        screenName: state.screenName,
      });
    };
    window.addEventListener("message", onMessage);
    hello();
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(retry);
      clearTimeout(timer);
    };
  }, []);

  const send = useCallback((request: CompanionRequest) => {
    (window.opener as Window | null)?.postMessage(
      wrap(request),
      window.location.origin,
    );
  }, []);

  return { link, send };
}
