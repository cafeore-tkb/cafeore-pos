import { dripperLabel, splitCallScreenOrders } from "@cafeore/common";
import { useCallback, useMemo, useRef, useState } from "react";
import type { MetaFunction } from "react-router";
import logoSVG from "~/assets/cafeore.svg";
import brightNotifications from "~/assets/callscreen/bright-notifications.mp3";
import {
  BOARD_W,
  CallingBanner,
  CmFallback,
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
  useCmPlayback,
  useFlash,
  useOnAdded,
  useStageScale,
} from "./callscreen.hooks";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面 / 珈琲・俺POS" }];
};

/**
 * 待機中に流す CM。services/pos/public/ にこの名前で置く（16:9。H.264 の mp4 ならどのブラウザでも流せる）。
 * 置いていない・読めない間は、代わりにロゴの待機画面を出す
 */
const CM_SRC = "/callscreen-cm.mp4";
/** 呼び出しが無くなってから CM に戻るまでの時間 */
const RETURN_TO_CM_MS = 30_000;
/** プレートの文字の上限。段が減っても大きくなりすぎないようにする */
const CALLING_FONT_CAP = 340;
const DRIP_FONT_CAP = 220;

export default function FieldsOfCallScreen() {
  const { orders, isOrdersLoaded } = useOrdersWSContext();

  const videoRef = useRef<HTMLVideoElement>(null);
  const soundRef = useRef<HTMLAudioElement>(null);
  const [cmUnavailable, setCmUnavailable] = useState(false);

  // 提供済みは画面から外し、残りを お呼び出し中 / ドリップ中 / 準備中 に分ける。
  // ドリップ中は CaOS のカードの状態で決める（@cafeore/common の splitCallScreenOrders）
  const { calling, dripping, preparing } = useMemo(
    () => splitCallScreenOrders(orders),
    [orders],
  );

  const drippingIds = useMemo(
    () => dripping.map((order) => order.orderId),
    [dripping],
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

  // 一覧が届くまでは「新しく入った」の判定ができないので、最初の一覧を受け取ってから数える。
  // 呼び出しはチャイムと点滅、ドリップ入りは点滅だけ
  useOnAdded(calling, onCalled, isOrdersLoaded);
  useOnAdded(drippingIds, startFlash, isOrdersLoaded);

  const showCall = useCallVisibility(calling.length > 0, RETURN_TO_CM_MS);
  const scale = useStageScale(STAGE_W, STAGE_H);
  const resumeCm = useCmPlayback(videoRef, showCall);

  const hasDrip = dripping.length > 0;
  const hasPrep = preparing.length > 0;
  const heights = sectionHeights(hasDrip, hasPrep);

  const callingItems: PlateItem[] = useMemo(
    () => calling.map((orderId) => ({ id: orderId, caption: null })),
    [calling],
  );
  const drippingItems: PlateItem[] = useMemo(
    () =>
      dripping.map(({ orderId, drippers }) => ({
        id: orderId,
        // 淹れ終えて準備完了を待っている注文は、もうドリッパーにいないので出さない
        caption:
          drippers.length > 0
            ? `${drippers.map(dripperLabel).join("・")} ドリッパー`
            : null,
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
        {/* CM 待機。呼び出しが入るまではここを流し続ける */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            opacity: showCall ? 0 : 1,
            transition: "opacity 500ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {cmUnavailable ? (
            <CmFallback logo={logoSVG} />
          ) : (
            <video
              ref={videoRef}
              src={CM_SRC}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              onEnded={resumeCm}
              onError={() => setCmUnavailable(true)}
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
          )}

          {/* ドリップ中があれば CM と同時に帯で出す。無ければ準備中だけ細く出す */}
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
              <PreparingBar orderIds={preparing} />
            </div>
          )}
        </div>

        {/* 呼び出し画面。提供できるオーダーが出たら CM の上に被せる */}
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

          {hasPrep && <PreparingBar orderIds={preparing} />}
        </div>
      </div>

      <audio src={brightNotifications} ref={soundRef} preload="auto">
        <track kind="captions" />
      </audio>
    </div>
  );
}
