import {
  dripperLabel,
  isCallOutOfOrder,
  planDripAnnouncement,
  splitCallScreenOrders,
} from "@cafeore/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, type MetaFunction, useSearchParams } from "react-router";
import { toast } from "sonner";
import logoSVG from "~/assets/cafeore.svg";
import brightNotifications from "~/assets/callscreen/bright-notifications.mp3";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";
import {
  CallScreenSettings,
  type CmPlaylistControl,
} from "~/components/organisms/callscreen/CallScreenSettings";
import { CmPlayer } from "~/components/organisms/callscreen/CmPlayer";
import {
  DisplayPicker,
  type PresentChoice,
} from "~/components/organisms/callscreen/DisplayPicker";
import { Button, buttonVariants } from "~/components/ui/button";
import { cmPlaylist, useCmPlaylist } from "~/lib/callscreen-cm";
import {
  openCompanion,
  useCompanionHost,
  useCompanionLink,
} from "~/lib/callscreen-companion";
import { useCallScreenSound } from "~/lib/callscreen-sound";
import { enterFullscreen } from "~/lib/screens";
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

export const meta: MetaFunction = ({ location }) => {
  const companion = new URLSearchParams(location.search).has("companion");
  return [
    {
      title: companion
        ? "呼び出し画面の操作 / 珈琲・俺POS"
        : "呼び出し画面 / 珈琲・俺POS",
    },
  ];
};

/**
 * 待機中に流す CM。設定の画面（このページを全画面にする前）でこの端末のファイルを選んでいれば、それを順番に流す（lib/callscreen-cm）。
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

/**
 * 呼び出し画面そのもの（お客さんに見せる面）。設定の画面から外部ディスプレイに全画面で出したときに描く
 */
function CallBoard() {
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
        chime: true,
        onStart: () => {
          if (reveal(orderId)) startFlash(orderId);
        },
      });
    },
    [announce, reveal, startFlash],
  );

  // 提供の画面で「呼び出し催促」を押したとき。お呼び出し中に出している番号だけ、チャイムを鳴らして
  // 「N番のお客様、商品のご用意ができております。お急ぎ、提供口までお越しください。」を流し、鳴らし始めたらその番号を目立たせる
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
  // 1 つの注文につき最初の 1 回だけ流し、立て続け（1 分以内）なら「よろしければ…」を省く（@cafeore/common の planDripAnnouncement）
  const onBrewStarted = useCallback(
    (key: string) => {
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
  // 読み上げを切っている間は、読み上げを作らせない
  useWarmCallVoices(waitingIds, isOrdersLoaded && sound.voice);

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

/**
 * 呼び出し画面（/callscreen）。開くと設定の画面（出す先・CM・音）で、そこから外部ディスプレイに全画面で出す。
 * 全画面にするのはこのタブなので、このタブで選んだ CM のファイルがそのまま流れる。
 * 外部ディスプレイに出すと、手元の画面に設定の画面を小窓（?companion）で開く（lib/callscreen-companion）
 */
export default function CallScreenPage() {
  const [searchParams] = useSearchParams();
  return searchParams.has("companion") ? (
    <CallScreenCompanion />
  ) : (
    <CallScreenHost />
  );
}

/** 元のタブ。全画面にしていなければ設定の画面を、全画面にしたら呼び出し画面を描く */
function CallScreenHost() {
  const cm = useCmPlaylist();
  const [presenting, setPresenting] = useState(false);
  const [companion, setCompanion] = useState<Window | null>(null);
  const [screenName, setScreenName] = useState("");

  // 全画面が解けたら（外部ディスプレイの側で Esc、小窓の「表示をやめる」）設定の画面に戻し、小窓を閉じる
  // （このタブが元の画面に戻ってくるので、設定の画面が 2 つにならないように）
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) return;
      setPresenting(false);
      setCompanion(null);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // 小窓を外したとき・このページを離れるとき・読み込み直す／タブを閉じるときは小窓を閉じる
  // （CM の並びはこのタブにしか無いので、小窓だけ残っても変えられない）
  useEffect(() => {
    if (!companion) return;
    const close = () => companion.close();
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, [companion]);

  const stop = useCallback(() => {
    if (!document.fullscreenElement) return;
    void document.exitFullscreen().catch(() => undefined);
  }, []);
  // このページを離れるとき（全画面のまま戻るボタンを押したなど）も全画面を解く。外部ディスプレイにほかのページを映さないように
  useEffect(() => stop, [stop]);
  useCompanionHost(companion, screenName, stop);

  const present = async ({
    target,
    companion: companionScreen,
    name,
  }: PresentChoice) => {
    // 全画面にする前に呼び出し画面を描き始める（外部ディスプレイに設定の画面が映らないように）。
    // 全画面はクリックの中でしか頼めないので、ここより前で待たない
    setPresenting(true);
    setScreenName(name);
    try {
      await enterFullscreen(target);
    } catch {
      setPresenting(false);
      toast.error("全画面にできませんでした。もう一度押してください");
      return;
    }
    // 同じクリックのうちに、手元の画面に設定の画面を小窓で開く（Fullscreen Companion Window）。
    // 開けなければ小窓は無し（表示をやめるには、外部ディスプレイの側で Esc を押す）
    if (companionScreen) setCompanion(openCompanion(companionScreen));
  };

  if (presenting) return <CallBoard />;

  return (
    <CallScreenSettings
      header={
        <AdminPageHeader
          group="settings"
          title="呼び出し画面"
          description="受け取り口の外部ディスプレイに、呼び出しの番号と CM を全画面で出します。流す CM と鳴らす音も、ここで決めます。"
        >
          <p className="max-w-[760px] text-pretty text-muted-foreground text-sm">
            選んだ CM のファイルはどこにも上げず、
            <span className="font-semibold text-foreground">
              このタブの中だけで覚えます
            </span>
            。読み込み直したりタブを閉じたりすると消えます。外部ディスプレイにはこのタブをそのまま全画面で出すので、選んだファイルが流れます。
          </p>
        </AdminPageHeader>
      }
      display={<DisplayPicker onPresent={(choice) => void present(choice)} />}
      playlist={cm}
      control={cmPlaylist}
    />
  );
}

/**
 * 外部ディスプレイに出している間、手元の画面に開く小窓。元のタブと同じ設定の画面で、CM の操作は元のタブに頼む。
 * 音の設定は localStorage にあるので、ここで変えれば元のタブにも効く
 */
function CallScreenCompanion() {
  const { link, send } = useCompanionLink();
  const control = useMemo<CmPlaylistControl>(
    () => ({
      add: (files) => send({ type: "add", files }),
      remove: (id) => send({ type: "remove", id }),
      move: (id, delta) => send({ type: "move", id, delta }),
      clear: () => send({ type: "clear" }),
      setImageSeconds: (seconds) => send({ type: "image-seconds", seconds }),
    }),
    [send],
  );

  if (link.status === "connecting") {
    return (
      <p className="px-4 py-10 text-center font-noto text-muted-foreground text-sm">
        外部ディスプレイの呼び出し画面とつないでいます…
      </p>
    );
  }

  if (link.status === "lost") {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-3 px-4 py-10 font-noto">
        <h1 className="font-bold text-2xl">呼び出し画面の操作</h1>
        <p className="text-muted-foreground text-sm">
          外部ディスプレイに出している呼び出し画面が見つかりません（表示をやめた、元のタブを閉じた・読み込み直した）。この窓を閉じて、元のタブから出し直してください。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.close()}>この窓を閉じる</Button>
          <Link
            to="/callscreen"
            className={buttonVariants({ variant: "outline" })}
          >
            この窓で設定の画面を開く
          </Link>
        </div>
      </div>
    );
  }

  return (
    <CallScreenSettings
      header={
        <header className="flex flex-col gap-3 font-noto">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="font-bold text-2xl tracking-tight">
              呼び出し画面の操作
            </h1>
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 font-medium text-white text-xs">
              {link.screenName}に表示中
            </span>
            <Button
              variant="destructive"
              className="ml-auto"
              onClick={() => send({ type: "stop" })}
            >
              表示をやめる
            </Button>
          </div>
          <p className="max-w-[760px] text-pretty text-muted-foreground text-sm">
            外部ディスプレイに出している呼び出し画面を、この窓から操作します。ここで変えた
            CM と音は、すぐ呼び出し画面に効きます（CM
            のファイルは出している元のタブに渡し、そのタブの中だけで覚えます）。「表示をやめる」を押すと、元のタブが手元の画面に戻り、この窓は閉じます。
          </p>
        </header>
      }
      display={null}
      playlist={link.playlist}
      control={control}
    />
  );
}
