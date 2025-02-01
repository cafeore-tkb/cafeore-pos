import {
  isRouteErrorResponse,
  useRouteError,
  useSearchParams,
} from "@remix-run/react";
import { orderConverter } from "common/firebase-utils/converter";
import { documentSub } from "common/firebase-utils/subscription";
import { useEffect, useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
import bellSound from "~/assets/bell.mp3";
import logoMotion from "~/assets/cafeore_logo_motion.webm";
import { cn } from "~/lib/utils";

console.log(import.meta.env.VITE_SOHOSAI_VOTE_URL);

export default function Welcome() {
  const [searchParam, setSearchParam] = useSearchParams();
  const [videoShown, setVideoShown] = useState(true);
  const id = searchParam.get("id") ?? "none";

  const soundRef1 = useRef<HTMLAudioElement>(null);
  const soundRef2 = useRef<HTMLAudioElement>(null);

  const { data: order } = useSWRSubscription(
    ["orders", id],
    documentSub({ converter: orderConverter }),
  );

  useEffect(() => {
    if (!order?.readyAt) {
      return;
    }
    soundRef1.current?.play();
    const timer = setTimeout(() => {
      soundRef2.current?.play();
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [order?.readyAt]);

  return (
    <>
      {/* ローディングアニメーション部分 */}
      <div
        className={cn(
          "absolute top-0 left-0 z-10 h-screen w-screen transition-all duration-300",
          "flex items-center justify-center bg-black",
          "grid columns-4",
          !videoShown && "opacity-0",
        )}
      >
        <button
          type="button"
          onClick={() => setVideoShown(false)}
          className="h-screen w-screen"
        >
          <video
            playsInline
            muted
            autoPlay
            src={logoMotion}
            className="h-3/5 w-full object-contain"
          />
          <h1 className="font-sans text-white">タップで開く</h1>
        </button>
      </div>
      {/* メイン部分 */}
      <div
        className={cn(
          "absolute top-0 left-0 h-dvh w-screen opacity-0 transition-all duration-500",
          "flex flex-col items-center justify-between",
          !videoShown && "z-20 opacity-100",
        )}
      >
        <div className="flex-1">
          {order === undefined ? (
            <div className="flex h-5/6 w-screen items-center justify-center">
              <h1 className="text-2xl">またのご来店をお待ちしております</h1>
            </div>
          ) : (
            <>
              <h1 className="text-xl">No. {order.orderId}</h1>
              {order.readyAt && (
                <div>
                  <h2 className="font-bold text-orange-600 text-xl">
                    ドリップが完了しました！
                  </h2>
                  <p>提供口にてお受け取りください</p>
                  <p>ごゆっくりとお楽しみください！</p>
                </div>
              )}
              {order.readyAt === null && (
                <p>ご注文の提供をこの画面でお知らせします</p>
              )}
            </>
          )}
        </div>
        <footer className="h-1/6 w-screen bg-gray-100">
          <a
            href={import.meta.env.VITE_SOHOSAI_VOTE_URL}
            className="flex h-full w-full flex-col items-center justify-center"
            target="_blank"
            rel="noreferrer"
          >
            <h4 className="text-lg">雙峰祭グランプリ</h4>
            <h4 className="text-lg">投票をお願いします！</h4>
          </a>
        </footer>
        <audio src={bellSound} ref={soundRef1}>
          <track kind="captions" />
        </audio>
        <audio src={bellSound} ref={soundRef2}>
          <track kind="captions" />
        </audio>
      </div>
    </>
  );
}

export const ErrorBoundary = () => {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div>
        <h1>
          {error.status} {error.statusText}
        </h1>
        <p>{error.data}</p>
      </div>
    );
  }
  if (error instanceof Error) {
    return (
      <div>
        <h1>Error</h1>
        <p>{error.message}</p>
        <p>The stack trace is:</p>
        <pre>{error.stack}</pre>
      </div>
    );
  }
  return <h1>Unknown Error</h1>;
};
