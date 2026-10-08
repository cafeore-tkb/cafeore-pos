import {
  type ColorScreen,
  OVERDUE_SECONDS,
  type OrderEntity,
  type WithId,
  orderElapsedSeconds,
  readableTextColor,
  resolveItemColor,
  useColorSettings,
} from "@cafeore/common";
import dayjs from "dayjs";
import { LuCheck, LuHourglass } from "react-icons/lu";
import { minSec } from "~/lib/minSec";
import { cn } from "~/lib/utils";
import { PendingSpinner } from "../atoms/PendingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { RealtimeElapsedTime } from "./RealtimeElapsedTime";

// カードに並べるアイテム、またはカップ1杯。見せ方は呼ぶ側の画面が決める
export type CupView = ReturnType<OrderEntity["getItems"]>[number] & {
  cupId?: string;
  gray?: boolean; // 灰色にして、色の設定の色を付けない
  servable?: boolean; // 提供可能。緑の枠で目立たせる
  served?: boolean; // 提供済。薄くする
  busy?: boolean; // 応答待ち
  onClick?: () => void; // 押せるカップだけ
};

type props = {
  order: WithId<OrderEntity>;
  timing: "past" | "present" | "all"; // どの注文を表示するか
  cups: CupView[];
  colorScreen?: ColorScreen; // アイテムの背景色を引く色の設定の画面。無ければ色を付けない
  grayed?: boolean; // カードごと灰色にする
  children?: React.ReactNode; // コメントの一覧の下に出す部品
};

/**
 * 注文カードの共通の枠（番号・時刻・杯数・経過時間・カップ・コメントの一覧）。
 * カップの見せ方・押したときの動き・下に出す部品は、呼ぶ側の画面が組み立てて渡す
 */
export function OrderInfoCard({
  order,
  timing,
  cups,
  colorScreen,
  grayed,
  children,
}: props) {
  // アイテムの背景色は、その画面の色の設定（アイテム → 種別の順）から引く。設定の無いアイテムは色を付けない
  const { colorSettings } = useColorSettings(colorScreen !== undefined);
  const cupStyle = (cup: CupView) => {
    if (colorScreen === undefined || cup.gray) return undefined;
    const backgroundColor = resolveItemColor(colorSettings, cup, colorScreen);
    if (backgroundColor === undefined) return undefined;
    return { backgroundColor, color: readableTextColor(backgroundColor) };
  };

  return (
    <div key={order.id}>
      <Card
        className={cn(
          grayed && "bg-gray-300 text-gray-500",
          order.status === "served" && "transition-all duration-200",
        )}
      >
        <CardHeader>
          <div className="flex items-end justify-between">
            <CardTitle className="flex items-end font-normal">
              <div className="font-black text-sm">No.</div>
              <div className="font-black text-6xl">{order.orderId}</div>
            </CardTitle>
            {timing === "present" ? (
              <RealtimeElapsedTime order={order} />
            ) : (
              <ServedTime order={order} />
            )}
            <div className="grid">
              <div className="px-2 text-right">
                {dayjs(order.createdAt).format("H:mm")}
              </div>
              <CardTitle className="flex h-10 items-end justify-center">
                <p className="text-5xl">{order.getCups().length}</p>
                <p className="text-sm">杯</p>
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              timing === "past" && "mb-4",
              "grid grid-cols-2 gap-2",
            )}
          >
            {cups.map((cup, idx) => (
              <CupButton
                key={cup.cupId ?? `${idx}-${cup.id}`}
                busy={!!cup.busy}
                onClick={cup.onClick}
              >
                <Card
                  className={cn(
                    "h-full p-3 transition-all duration-200",
                    cup.gray && "bg-gray-200 text-gray-500",
                    cup.servable &&
                      "shadow-md ring-4 ring-green-500 ring-offset-2",
                    cup.served && "opacity-50",
                  )}
                  style={cupStyle(cup)}
                >
                  <h3 className="text-center font-bold text-3xl">{cup.abbr}</h3>
                  {cup.servable && (
                    <p
                      key="servable"
                      className="fade-in zoom-in-50 flex animate-in items-center justify-center gap-0.5 whitespace-nowrap font-bold text-green-700 text-xs duration-200"
                    >
                      <LuCheck
                        className="h-3.5 w-3.5 shrink-0"
                        strokeWidth={3}
                      />
                      提供可能
                    </p>
                  )}
                  {cup.served && (
                    <p
                      key="served"
                      className="fade-in animate-in text-center font-bold text-xs duration-200"
                    >
                      提供済
                    </p>
                  )}
                  {cup.assignee && (
                    <p
                      className={cn(
                        order.status === "preparing" && "text-red-500",
                        "font-bold text-sm",
                      )}
                    >
                      指名:{cup.assignee}
                    </p>
                  )}
                </Card>
              </CupButton>
            ))}
          </div>
          <CommentList order={order} />
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

// 呼び出し中で、まだ提供していない注文に出す
export const WaitingLabel = ({ order }: { order: OrderEntity }) =>
  order.status === "calling" &&
  !order.servedAt && (
    <div className="mt-5 flex items-center">
      <LuHourglass className="mr-1 h-5 w-5 stroke-yellow-600" />
      <p className="text-yellow-700">提供待ち</p>
    </div>
  );

// 押して状態を切り替えられるカップだけボタンにする。
// 押せることが分かるよう、ホバーで浮かせて押した瞬間に沈ませる。
// 応答待ちの間は角に回転アイコンを出す。
const CupButton = ({
  onClick,
  busy,
  children,
}: {
  onClick: (() => void) | undefined;
  busy: boolean;
  children: React.ReactNode;
}) =>
  onClick ? (
    <div className="relative h-full">
      <button
        type="button"
        onClick={onClick}
        aria-busy={busy}
        className={cn(
          "block h-full w-full cursor-pointer select-none rounded-lg text-left transition-transform duration-150 ease-out",
          "hover:-translate-y-0.5 active:translate-y-0 active:scale-95 hover:[&>*]:shadow-lg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary focus-visible:ring-offset-2",
          busy && "cursor-wait",
        )}
      >
        {children}
      </button>
      {busy && <PendingSpinner />}
    </div>
  ) : (
    <div>{children}</div>
  );

// 受け付けてから提供まで（まだなら今まで）の時間。15分以上で赤くする
const ServedTime = ({ order }: { order: OrderEntity }) => {
  const seconds = orderElapsedSeconds(order);
  const { m, ss } = minSec(seconds);
  return (
    <div
      className={cn(
        "rounded-md px-2",
        seconds >= OVERDUE_SECONDS ? "bg-red-500 text-white" : "bg-slate-100",
      )}
    >
      <div>{order.servedAt == null ? "未提供" : `${m}分${ss}秒`}</div>
    </div>
  );
};

// コメントの書き手を1文字で出す
const AUTHOR_MARKS = { cashier: "レ", master: "マ", serve: "提", others: "他" };

const CommentList = ({ order }: { order: OrderEntity }) =>
  order.comments.length > 0 && (
    <div>
      {order.comments.map((comment, index) => (
        <div
          key={`${index}-${comment.author}`}
          className="my-2 flex gap-2 rounded-md bg-gray-200 px-2 py-1"
        >
          <div className="flex-none font-bold">
            {AUTHOR_MARKS[comment.author]}
          </div>
          <div>{comment.text}</div>
        </div>
      ))}
    </div>
  );
