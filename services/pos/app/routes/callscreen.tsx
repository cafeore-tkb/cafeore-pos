import type { OrderEntity, WithId } from "@cafeore/common";
import { useCallback, useMemo, useRef } from "react";
import type { MetaFunction } from "react-router";
import brightNotifications from "~/assets/callscreen/bright-notifications.mp3";
import {
  BOARD_W,
  CallingBanner,
  DripBand,
  DripBanner,
  GRAD_CALLING,
  GRAD_PLATE,
  PlateBoard,
  type PlateItem,
  PreparingBar,
  STAGE_H,
  STAGE_W,
  dripBandLayout,
  layoutPlates,
  sectionHeights,
} from "./callscreen.components";
import {
  useCallVisibility,
  useFlash,
  useOnAdded,
  usePvPlayback,
  useStageScale,
} from "./callscreen.hooks";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面 / 珈琲・俺POS" }];
};

/** 待機中に流す PV。差し替えるときは public/ のファイルを置き換える */
const PV_SRC = "/callscreen-pv.mp4";
/** 呼び出しが無くなってから PV に戻るまでの時間 */
const RETURN_TO_PV_MS = 30_000;
/** プレートの文字の上限。段が減っても大きくなりすぎないようにする */
const CALLING_FONT_CAP = 340;
const DRIP_FONT_CAP = 220;

const byCreatedAtAsc = (a: WithId<OrderEntity>, b: WithId<OrderEntity>) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.orderId - b.orderId;

export default function FieldsOfCallScreen() {
  const { orders } = useOrdersWSContext();

  const videoRef = useRef<HTMLVideoElement>(null);
  const soundRef = useRef<HTMLAudioElement>(null);

  // 提供済みは画面から外し、残りを お呼び出し中 / ドリップ中 / 準備中 に分ける
  const { calling, dripping, preparing } = useMemo(() => {
    const unserved = (orders ?? []).filter((order) => order.servedAt === null);

    return {
      // 新しい呼び出しほど大きく出したいので、呼び出した時刻の新しい順
      calling: unserved
        .filter((order) => order.readyAt !== null)
        .sort(
          (a, b) =>
            (b.readyAt?.getTime() ?? 0) - (a.readyAt?.getTime() ?? 0) ||
            b.orderId - a.orderId,
        ),
      // ドリッパー番号順。台ごとの位置が動かないので見つけやすい
      dripping: unserved
        .filter((order) => order.readyAt === null && order.dripper !== null)
        .sort((a, b) => (a.dripper ?? 0) - (b.dripper ?? 0)),
      // 淹れる順に並べる
      preparing: unserved
        .filter((order) => order.readyAt === null && order.dripper === null)
        .sort(byCreatedAtAsc),
    };
  }, [orders]);

  const callingIds = useMemo(
    () => calling.map((order) => order.orderId),
    [calling],
  );
  const drippingIds = useMemo(
    () => dripping.map((order) => order.orderId),
    [dripping],
  );
  const preparingIds = useMemo(
    () => preparing.map((order) => order.orderId),
    [preparing],
  );

  const { startFlash, isFlashing } = useFlash();

  const playChime = useCallback(() => {
    const audio = soundRef.current;
    if (!audio) return;

    try {
      audio.currentTime = 0;
    } catch (error) {
      // Safari など currentTime の操作に失敗する環境があるので握りつぶす
    }

    void audio.play().catch(() => {
      // 自動再生の制限で弾かれた場合は握りつぶす
    });
  }, []);

  const onCalled = useCallback(
    (orderId: number) => {
      playChime();
      startFlash(orderId);
    },
    [playChime, startFlash],
  );

  // 一覧が届くまでは「新しく入った」の判定ができない。
  // useOrdersWS は最初の一覧を受け取るまで空配列を返すので、それを合図にする
  const loaded = (orders ?? []).length > 0;

  // 呼び出しはチャイムと点滅、ドリップ入りは点滅だけ
  useOnAdded(callingIds, onCalled, loaded);
  useOnAdded(drippingIds, startFlash, loaded);

  const showCall = useCallVisibility(calling.length > 0, RETURN_TO_PV_MS);
  const scale = useStageScale(STAGE_W, STAGE_H);
  const resumePv = usePvPlayback(videoRef, showCall);

  const hasDrip = dripping.length > 0;
  const hasPrep = preparing.length > 0;
  const heights = sectionHeights(hasDrip, hasPrep);

  const callingItems: PlateItem[] = useMemo(
    () => calling.map((order) => ({ id: order.orderId, caption: null })),
    [calling],
  );
  const drippingItems: PlateItem[] = useMemo(
    () =>
      dripping.map((order) => ({
        id: order.orderId,
        caption: `${order.dripper}番ドリッパー`,
      })),
    [dripping],
  );

  const callingPlates = layoutPlates(
    callingItems,
    BOARD_W,
    heights.callingBoard,
    CALLING_FONT_CAP,
  );
  const drippingPlates = layoutPlates(
    drippingItems,
    BOARD_W,
    heights.dripBoard,
    DRIP_FONT_CAP,
  );
  const bandPlates = dripBandLayout(drippingItems);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "#000",
      }}
      className="font-noto"
    >
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          width: `${STAGE_W}px`,
          height: `${STAGE_H}px`,
          overflow: "hidden",
          background: "#000",
          transform: `scale(${scale})`,
        }}
      >
        {/* PV 待機。呼び出しが入るまではここを流し続ける */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            opacity: showCall ? 0 : 1,
            transition: "opacity 500ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <video
            ref={videoRef}
            src={PV_SRC}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onEnded={resumePv}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          >
            <track kind="captions" />
          </video>

          {/* ドリップ中があれば PV と同時に帯で出す。無ければ準備中だけ細く出す */}
          {!showCall && hasDrip && (
            <DripBand
              plates={bandPlates}
              isFlashing={isFlashing}
              preparingCount={preparing.length}
            />
          )}
          {!showCall && !hasDrip && hasPrep && (
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <PreparingBar orderIds={preparingIds} />
            </div>
          )}
        </div>

        {/* 呼び出し画面。提供できるオーダーが出たら PV の上に被せる */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "8px",
            boxSizing: "border-box",
            background: "#fff",
            opacity: showCall ? 1 : 0,
            pointerEvents: showCall ? "auto" : "none",
            transition: "opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              height: `${heights.calling}px`,
              padding: "0 16px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <CallingBanner />
            <PlateBoard
              plates={callingPlates}
              gradient={GRAD_CALLING}
              isFlashing={isFlashing}
            />
          </div>

          {hasDrip && (
            <div
              style={{
                flexShrink: 0,
                height: `${heights.drip}px`,
                padding: "0 16px",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <DripBanner />
              <PlateBoard
                plates={drippingPlates}
                gradient={GRAD_PLATE}
                isFlashing={isFlashing}
              />
            </div>
          )}

          {hasPrep && <PreparingBar orderIds={preparingIds} />}
        </div>
      </div>

      <audio src={brightNotifications} ref={soundRef} preload="auto">
        <track kind="captions" />
      </audio>
    </div>
  );
}
