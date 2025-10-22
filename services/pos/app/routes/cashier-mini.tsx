import {
  cashierStateConverter,
  documentSub,
  orderConverter,
} from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
import logoSVG from "~/assets/cafeore.svg";
import logoMotion from "~/assets/cafeore_logo_motion.webm";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { cn } from "~/lib/utils";
import Gradation2025 from "~/assets/gradation2025.png";

export const meta: MetaFunction = () => {
  return [{ title: "珈琲・俺 1号店" }];
};

export default function CasherMini() {
  const [logoShown, setLogoShown] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const soundRef1 = useRef<HTMLAudioElement>(null);
  const soundRef2 = useRef<HTMLAudioElement>(null);
  const { data: orderState } = useSWRSubscription(
    ["global", "cashier-state"],
    documentSub({ converter: cashierStateConverter }),
  );
  const order = orderState?.edittingOrder;
  const submittedOrderId = orderState?.submittedOrderId;
  const { data: preOrder } = useSWRSubscription(
    ["orders", submittedOrderId ?? "none"],
    documentSub({ converter: orderConverter }),
  );
  const isOperational = useOrderStat();

  const orderId = useMemo(() => {
    if (logoShown) {
      return preOrder?.orderId;
    }
    return order?.orderId;
  }, [order, logoShown, preOrder]);

  /**
   * FIXME #412 useEffect内でstateを更新している
   * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
   */
  useEffect(() => {
    setLogoShown(submittedOrderId != null || !isOperational);
  }, [submittedOrderId, isOperational]);

  /**
   * OK
   */
  useEffect(() => {
    if (!logoShown) {
      return;
    }
    videoRef.current?.play();
  }, [logoShown]);

  /**
   * OK
   */
  useEffect(() => {
    if (submittedOrderId === null) {
      return;
    }
    soundRef1.current?.play();
    const timer = setTimeout(() => {
      soundRef2.current?.play();
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [submittedOrderId]);

  const textBelowLogo = useMemo(() => {
    if (submittedOrderId != null) {
      return "ご注文ありがとうございました";
    }
    if (!isOperational) {
      return "しばらくお待ちください";
    }
    return "　ご来店ありがとうございます";
  }, [isOperational, submittedOrderId]);

  const charge = useMemo(() => order?.getCharge() ?? 0, [order]);

  return (
    <>
      <div
        className={cn(
          "absolute top-0 left-0 z-10 h-screen w-screen transition-all",
          "bg-black",
          !logoShown && "opacity-0 duration-500",
        )}
      >
        <div
          className={cn(
            "h-screen w-screen",
            "flex flex-col items-center justify-center",
          )}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            src={logoMotion}
            className="h-3/5 w-full flex-none object-contain"
          />
          <h1
            className={cn(
              "text-center font-zen text-6xl text-[#b09860] opacity-0 duration-1000 ease-in-out",
              logoShown && "mt-5 text-5xl opacity-100 duration-500",
            )}
          >
            {textBelowLogo}
          </h1>
        </div>
      </div>
      <div
        className={cn(
          "absolute top-0 left-0 z-0 h-screen w-screen",
          "bg-cover bg-center bg-no-repeat",
        )}
        style={{ backgroundImage: `url(${Gradation2025})` }}
      >
        <button type="button" className="absolute top-0 left-0 h-24 w-60" />
        <img
          src={logoSVG}
          alt=""
          className="absolute bottom-10 h-screen w-screen p-40"
        />
        <div className="flex h-screen w-screen flex-col px-8 md:px-16 lg:px-28 py-4 md:py-6 lg:py-10 font-zen">
          <p className="flex-none pb-8 md:pb-12 lg:pb-16 font-medium text-3xl md:text-4xl lg:text-5xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
            No. <span className="font-semibold text-4xl md:text-5xl lg:text-7xl">{orderId}</span>
          </p>
          <div className="flex h-4/5 flex-col justify-between">
            <div className="">
              {order?.items.map((item, idx) => {
                return (
                  <div
                    key={`${idx}-${item.id}`}
                    className="flex items-center justify-between pb-7"
                  >
                    <p className="flex-none pr-6 md:pr-10 lg:pr-14 font-bold text-3xl md:text-4xl lg:text-6xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      {idx + 1}
                    </p>
                    <p className="flex-1 font-bold text-2xl md:text-3xl lg:text-5xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      {item.name}
                    </p>
                    <p className="flex-none font-bold text-2xl md:text-3xl lg:text-5xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      {item.price} 円
                    </p>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pb-7">
                {(order?.discount ?? 0) > 0 && (
                  <>
                    <p className="flex-none pr-6 md:pr-10 lg:pr-14 font-bold text-xl md:text-2xl lg:text-3xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      割引
                    </p>
                    <p className="font-bold text-xl md:text-2xl lg:text-4xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      -{order?.discount} 円
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="">
              <div className="mb-7 h-1 w-full bg-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.7)]" />
              <div className="flex items-center justify-between pb-7">
                <p className="flex-none pr-6 md:pr-10 lg:pr-14 font-bold text-2xl md:text-3xl lg:text-5xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                  合計
                </p>
                <p className="font-bold text-2xl md:text-3xl lg:text-5xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                  {order?.billingAmount} 円
                </p>
              </div>
              <div className="flex h-14 items-center justify-between pb-7">
                {(order?.received ?? 0) > 0 && (
                  <>
                    <p className="flex-none pr-6 md:pr-10 lg:pr-14 font-bold text-xl md:text-2xl lg:text-4xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      お預かり
                    </p>
                    <p className="font-bold text-xl md:text-2xl lg:text-4xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      {order?.received} 円
                    </p>
                  </>
                )}
              </div>
              <div className="flex h-12 items-center justify-between pb-7">
                {charge >= 0 && (
                  <>
                    <p className="flex-none pr-6 md:pr-10 lg:pr-14 font-bold text-xl md:text-2xl lg:text-4xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
                      おつり
                    </p>
                    <p className="font-bold text-xl md:text-2xl lg:text-4xl text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">{charge} 円</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
