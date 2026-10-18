import {
  dripperLabel,
  isCallOutOfOrder,
  planDripAnnouncement,
  splitCallScreenOrders,
} from "@cafeore/common";
import { useCallback, useMemo, useRef } from "react";
import type { MetaFunction } from "react-router";
import logoSVG from "~/assets/cafeore.svg";
import brightNotifications from "~/assets/callscreen/bright-notifications.mp3";
import { CmPlayer } from "~/components/organisms/callscreen/CmPlayer";
import { useCmPlaylist } from "~/lib/callscreen-cm";
import {
  getCallScreenSound,
  hasCallScreenVoice,
  useCallScreenSound,
} from "~/lib/callscreen-sound";
import {
  BOARD_W,
  BrewingIndicator,
  CallScreenBackdrop,
  DripBand,
  PlateBoard,
  type PlateItem,
  PreparingBar,
  STAGE_H,
  STAGE_W,
  SectionHeading,
  dripBandLayout,
  layoutDripPlates,
  layoutPlates,
  sectionHeights,
  stageContentStyle,
} from "./callscreen.components";
import {
  URGENT_HOLD_MS,
  callVoicePath,
  dripVoicePath,
  recallVoicePath,
  useAnnouncer,
  useCallVisibility,
  useFlash,
  useOnAdded,
  useRevealedCalls,
  useStageScale,
  useWarmCallVoices,
} from "./callscreen.hooks";
import {
  useOrderRecalled,
  useOrdersWSContext,
} from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面 / 珈琲・俺POS" }];
};

/**
 * 待機中に流す CM。マスタ設定の「呼び出し画面の CM」でこの端末のファイルを選んでいれば、それを順番に流す（lib/callscreen-cm）。
 * 選んでいなければ services/pos/public/ にこの名前で置いた動画を流す（16:9。H.264 の mp4 ならどのブラウザでも流せる）。
 * どれも流せない間は、代わりに呼び出し画面と同じ地（ロゴ入り）を出す
 */
const CM_SRC = "/callscreen-cm.mp4";
const DEFAULT_CM = [{ id: "default", kind: "video", url: CM_SRC }] as const;
/** 呼び出しが無くなってから CM に戻るまでの時間 */
const RETURN_TO_CM_MS = 30_000;
/** プレートの文字の上限。段が減っても大きくなりすぎないようにする */
const CALLING_FONT_CAP = 340;
const DRIP_FONT_CAP = 220;

export default function FieldsOfCallScreen() {
  const { orders, isOrdersLoaded } = useOrdersWSContext();

  const soundRef = useRef<HTMLAudioElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const cm = useCmPlaylist();
  const sound = useCallScreenSound();

  // 提供済みは画面から外し、残りを お呼び出し中 / ドリップ中 / 準備中 に分ける。
  // ドリップ中は CaOS のカードの状態で決める（@cafeore/common の splitCallScreenOrders）
  const { calling, dripping, preparing, brewing } = useMemo(
    () => splitCallScreenOrders(orders),
    [orders],
  );

  const drippingIds = useMemo(
    () => dripping.map((order) => order.orderId),
    [dripping],
  );
  // まだ呼んでいない注文。呼び出しの読み上げを先に作らせておく
  const waitingIds = useMemo(
    () => [...preparing, ...drippingIds],
    [preparing, drippingIds],
  );
  const brewingKeys = useMemo(() => brewing.map((card) => card.key), [brewing]);

  const { startFlash, flashesOf } = useFlash();
  // 呼び出し催促した番号は、読み上げを鳴らし始めてから URGENT_MS のあいだ目立たせる
  const { startFlash: startUrgent, flashesOf: urgentsOf } =
    useFlash(URGENT_HOLD_MS);
  // 新しく呼んだ番号は、チャイムを鳴らすときに画面に出して光らせる（何件入っても 1 件ずつ音と揃える）
  const { shown: shownCalling, reveal } = useRevealedCalls(
    calling,
    isOrdersLoaded,
  );

  const announce = useAnnouncer(soundRef, voiceRef);
  // 呼んだ時点の一覧で「順番が前後するか」を決めたいので、最新の一覧を持っておく
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const brewingRef = useRef(brewing);
  brewingRef.current = brewing;
  // ドリップの案内を流した注文（ID）と、最後に「よろしければ…」を付けた時刻
  const announcedDripOrdersRef = useRef(new Set<string>());
  const lastDripInviteAtRef = useRef<number | null>(null);
  const shownCallingRef = useRef(shownCalling);
  shownCallingRef.current = shownCalling;
  // 読み上げを待っている呼び出し催促の番号。続けて押されても、まだ流していないものには重ねない
  const queuedRecallsRef = useRef(new Set<number>());

  const onCalled = useCallback(
    (orderId: number) => {
      announce({
        path: callVoicePath(
          orderId,
          isCallOutOfOrder(ordersRef.current, orderId),
        ),
        kind: "call",
        chime: true,
        onStart: () => {
          if (reveal(orderId)) startFlash(orderId);
        },
      });
    },
    [announce, reveal, startFlash],
  );

  // 提供の画面で「呼び出し催促」を押したとき。お呼び出し中に出している番号だけ、チャイムを鳴らして
  // 「N番のお客様、商品のご用意ができております。お急ぎ、提供口までお越しください。」を流し、鳴らし始めたらその番号を目立たせる。
  // チャイム・音声呼び出しを切っていても鳴らす
  const onRecalled = useCallback(
    (id: string) => {
      const orderNo = ordersRef.current.find(
        (order) => order.id === id,
      )?.orderId;
      if (orderNo === undefined || !shownCallingRef.current.includes(orderNo)) {
        return;
      }
      if (queuedRecallsRef.current.has(orderNo)) return;
      queuedRecallsRef.current.add(orderNo);
      announce({
        path: recallVoicePath(orderNo),
        kind: "recall",
        chime: true,
        onStart: () => {
          queuedRecallsRef.current.delete(orderNo);
          startUrgent(orderNo);
        },
      });
    },
    [announce, startUrgent],
  );
  useOrderRecalled(onRecalled);

  // CaOS でカードを淹れ始めたとき（空いたドリッパーに割り当てた、積まれていたカードを担当し始めた）に、
  // 「N番のお客様、M番ドリッパーにてドリップいたします。…」を流す。呼び出しと取り違えないよう、チャイムは鳴らさない。
  // 1 つの注文につき最初の 1 回だけ流し、立て続け（1 分以内）なら「よろしければ…」を省く（@cafeore/common の planDripAnnouncement）。
  // ドリップの案内を切っている間に淹れ始めたカードは、案内したことにしない（「最初の 1 回」「立て続け」は、実際に流した案内で数える）
  const onBrewStarted = useCallback(
    (key: string) => {
      if (!getCallScreenSound().dripVoice) return;
      const card = brewingRef.current.find((item) => item.key === key);
      if (!card) return;
      const now = Date.now();
      const plan = planDripAnnouncement(
        card,
        announcedDripOrdersRef.current,
        lastDripInviteAtRef.current,
        now,
      );
      if (!plan) return;
      for (const order of plan.orders) {
        announcedDripOrdersRef.current.add(order.id);
      }
      if (plan.invite) lastDripInviteAtRef.current = now;
      announce({
        path: dripVoicePath(
          plan.orders.map((order) => order.orderId),
          card.dripper,
          plan.invite,
        ),
        kind: "drip",
        chime: false,
      });
    },
    [announce],
  );

  // 一覧が届くまでは「新しく入った」の判定ができないので、最初の一覧を受け取ってから数える
  // （開いたときにもう呼んでいた・淹れていたものは読み上げない）。
  // 呼び出しはチャイムと読み上げと光（鳴らすときに画面に出す）、ドリップ入りは光、淹れ始めたカードはドリップの案内
  useOnAdded(calling, onCalled, isOrdersLoaded);
  useOnAdded(drippingIds, startFlash, isOrdersLoaded);
  useOnAdded(brewingKeys, onBrewStarted, isOrdersLoaded);
  // 読み上げを両方切っている間は、読み上げを作らせない（番号の片はドリップの案内でも使うので、どちらかを流すなら作らせる）
  useWarmCallVoices(waitingIds, isOrdersLoaded && hasCallScreenVoice(sound));

  const showCall = useCallVisibility(shownCalling.length > 0, RETURN_TO_CM_MS);
  const scale = useStageScale(STAGE_W, STAGE_H);

  const hasDrip = dripping.length > 0;
  const hasPrep = preparing.length > 0;
  const heights = sectionHeights(hasDrip, hasPrep);

  const callingItems: PlateItem[] = useMemo(
    () => shownCalling.map((orderId) => ({ id: orderId, caption: null })),
    [shownCalling],
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
  // ドリップ中の番号は、お呼び出し中のいちばん小さい番号より大きくしない（呼び出しが多くても、呼んでいる番号を目立たせる）
  const drippingPlates = layoutDripPlates(
    drippingItems,
    BOARD_W,
    heights.dripBoard,
    Math.min(DRIP_FONT_CAP, ...callingPlates.map((plate) => plate.fontSize)),
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
          <CmPlayer
            items={cm.items.length > 0 ? cm.items : DEFAULT_CM}
            imageSeconds={cm.imageSeconds}
            paused={showCall}
            fallback={<CallScreenBackdrop logo={logoSVG} />}
          />

          {/* ドリップ中があれば CM と同時に帯で出す。無ければ準備中だけ細く出す */}
          {!showCall && hasDrip && (
            <DripBand
              plates={bandPlates}
              flashesOf={flashesOf}
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
              <PreparingBar orderIds={preparing} overlay />
            </div>
          )}
        </div>

        {/* 呼び出し画面。提供できるオーダーが出たら CM の上に被せる */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: showCall ? 1 : 0,
            pointerEvents: showCall ? "auto" : "none",
            transition: "opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <CallScreenBackdrop logo={logoSVG} subdued />
          <div style={stageContentStyle}>
            <div
              className="flex shrink-0 flex-col gap-4"
              style={{ height: `${heights.calling}px` }}
            >
              <SectionHeading ja="お呼び出し中" en="Now Calling" />
              <PlateBoard
                plates={callingPlates}
                tone="calling"
                flashesOf={flashesOf}
                urgentsOf={urgentsOf}
              />
            </div>

            {hasDrip && (
              <div
                className="flex shrink-0 flex-col gap-4"
                style={{ height: `${heights.drip}px` }}
              >
                <SectionHeading
                  ja="ドリップ中"
                  en="Brewing"
                  indicator={<BrewingIndicator />}
                />
                <PlateBoard
                  plates={drippingPlates}
                  tone="drip"
                  flashesOf={flashesOf}
                />
              </div>
            )}

            {hasPrep && <PreparingBar orderIds={preparing} />}
          </div>
        </div>
      </div>

      <audio src={brightNotifications} ref={soundRef} preload="auto">
        <track kind="captions" />
      </audio>
      {/* 読み上げ。src は読むたびに useAnnouncer が入れる */}
      <audio ref={voiceRef} preload="none">
        <track kind="captions" />
      </audio>
    </div>
  );
}
