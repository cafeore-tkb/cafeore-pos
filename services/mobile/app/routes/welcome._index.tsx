import { collectionSub, documentSub, orderConverter } from "@cafeore/common";
import {
  isRouteErrorResponse,
  useRouteError,
  useSearchParams,
} from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
import bellSound from "~/assets/bell.mp3";
import logoMotion from "~/assets/cafeore_logo_motion.webm";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ViewState } from "~/components/viewState";
import { cn } from "~/lib/utils";

export default function Welcome() {
  const [searchParam, setSearchParam] = useSearchParams();
  const [videoShown, setVideoShown] = useState(true);
  // いつか使うならuseParamsに直したい
  const id = searchParam.get("id") ?? "none";

  const soundRef1 = useRef<HTMLAudioElement>(null);
  const soundRef2 = useRef<HTMLAudioElement>(null);

  const [inputOrderId, setInputOrderId] = useState("");
  const [errorMessage, setErrorMeggage] = useState("");

  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "desc")),
  );

  const { data: order } = useSWRSubscription(
    id !== undefined ? ["orders", id] : null,
    documentSub({ converter: orderConverter }),
  );

  async function searchDocId(orderId: number): Promise<string | undefined> {
    if (orders) {
      for (const element of orders) {
        if (element.orderId === orderId && element.id !== undefined) {
          return element.id;
        }
      }
    } else {
      return undefined;
    }
    return undefined;
  }

  /**
   * 注文が完了した際に音を鳴らす
   * OK
   */
  // useEffect(() => {
  //   if (!order?.readyAt) {
  //     return;
  //   }
  //   soundRef1.current?.play();
  //   const timer = setTimeout(() => {
  //     soundRef2.current?.play();
  //   }, 500);
  //   return () => {
  //     clearTimeout(timer);
  //   };
  // }, [order?.readyAt]);

  // URL に ?id=XXX をセット
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputOrderId.trim() !== "") {
      const paramOrder = await searchDocId(Number.parseInt(inputOrderId));
      if (paramOrder !== undefined) {
        setSearchParam({ id: paramOrder });
      } else {
        setErrorMeggage("注文が見つかりません");
      }
    }
  };

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
            <div className="grid h-5/6 place-items-center">
              <div>
                <h3 className="font-bold">提供状況を確認する</h3>
                <p>交換券に記載されている番号を入力してください</p>
                <div className="flex flex-col items-center gap-2 md:flex-row">
                  <Input
                    type="number"
                    value={inputOrderId}
                    placeholder="1"
                    className="h-10"
                    onChange={(e) => setInputOrderId(e.target.value)}
                  />
                  <Button
                    type="submit"
                    onClick={handleSubmit}
                    className=""
                    variant="outline"
                  >
                    確認
                  </Button>
                </div>
                <div className="text-center text-red-500">
                  {errorMessage !== "" ? errorMessage : ""}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-5/6">
              <div className="flex h-full flex-col">
                <div className="flex flex-[3] items-center justify-center">
                  <h1>オーダーの提供状況</h1>
                </div>
                <div className="flex flex-[5] items-center justify-center">
                  <ViewState order={order} />
                </div>
                <div className="flex flex-[4] items-center justify-center">
                  {order.servedAt && (
                    <div>
                      <h1 className="text-2xl">
                        またのご来店をお待ちしております
                      </h1>
                    </div>
                  )}
                  {order.readyAt && order.servedAt === null && (
                    <div>
                      <p>提供口にてお受け取りください</p>
                      <p>ごゆっくりとお楽しみください！</p>
                    </div>
                  )}
                  {order.readyAt === null && (
                    <div>
                      <p>ご注文の提供をこの画面でお知らせします</p>
                      <p>展示やドリップの様子をご覧になって</p>
                      <p>お待ちください！</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* 珈琲・俺Webサイト見てね！を入れる */}
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
