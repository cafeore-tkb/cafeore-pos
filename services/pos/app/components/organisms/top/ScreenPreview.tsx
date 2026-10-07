import { FaCheck, FaCoffee } from "react-icons/fa";
import { HiBell } from "react-icons/hi2";
import logoSVG from "~/assets/cafeore.svg";
import { cn } from "~/lib/utils";

/**
 * トップページのカードに出す各画面の見本。
 * 実画面を iframe で埋め込むとレジが API に書き込んだり音が鳴ったりするので、
 * レイアウトだけを真似た静的な縮小版を描く。
 * 文字サイズはカード幅に追従させたいので、ルートを cqw で決めて中は em で書く。
 */
export type ScreenKind =
  | "cashier"
  | "master"
  | "serve"
  | "cashier-mini"
  | "callscreen"
  | "dashboard"
  | "inventory"
  | "rehearsal";

export function ScreenPreview({ kind }: { kind: ScreenKind }) {
  const Preview = previews[kind];
  return (
    <div className="@container aspect-[16/10] w-full overflow-hidden rounded-md border bg-white">
      <div className="h-full w-full select-none text-[2.4cqw] leading-tight">
        <Preview />
      </div>
    </div>
  );
}

const previews: Record<ScreenKind, () => JSX.Element> = {
  cashier: CashierPreview,
  master: () => <OrderBoardPreview user="master" />,
  serve: () => <OrderBoardPreview user="serve" />,
  "cashier-mini": CashierMiniPreview,
  callscreen: CallscreenPreview,
  dashboard: DashboardPreview,
  inventory: InventoryPreview,
  rehearsal: RehearsalPreview,
};

function StatusBar() {
  return <div className="h-[0.35em] bg-green-600" />;
}

function CashierPreview() {
  const steps = ["商品", "割引", "備考", "会計", "確定"];
  return (
    <div className="flex h-full flex-col text-[1.25em]">
      <StatusBar />
      <div className="flex items-center justify-between px-[0.8em] py-[0.4em]">
        <span className="font-black text-[1.3em] underline decoration-dotted">
          No.42
        </span>
        <span className="rounded bg-slate-200 px-[0.5em] py-[0.2em] text-[0.7em]">
          過去の注文
        </span>
      </div>
      <div className="grid grid-cols-5 items-start gap-[0.6em] px-[0.8em]">
        {steps.map((step, i) => (
          <div key={step}>
            <div
              className={cn(
                "flex items-center gap-[0.4em] rounded-md p-[0.3em]",
                i === 0 && "bg-theme-secondary",
              )}
            >
              <span
                className={cn(
                  "flex h-[1.6em] w-[1.6em] shrink-0 items-center justify-center rounded-full border-2 font-bold text-[0.8em]",
                  i === 0
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-400 text-stone-500",
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "font-bold text-[0.8em]",
                  i !== 0 && "text-stone-500",
                )}
              >
                {step}
              </span>
            </div>
          </div>
        ))}
        <div className="col-start-1 row-start-2 space-y-[0.3em] text-[0.7em]">
          <PriceRow label="ホット" value="¥500" />
          <PriceRow label="アイス" value="¥500" />
          <PriceRow label="ミルク" value="¥100" />
          <div className="border-t pt-[0.3em] font-bold">
            <PriceRow label="合計" value="¥1,100" />
          </div>
        </div>
        <div className="col-start-2 row-start-2 text-[0.7em]">
          <div className="text-stone-500">引換券番号</div>
          <div className="mt-[0.3em] flex">
            {[0, 1, 2].map((n) => (
              <span key={n} className="h-[1.6em] w-[1.6em] border" />
            ))}
          </div>
        </div>
        <div className="col-start-3 row-start-2">
          <div className="h-[3.5em] rounded border" />
        </div>
        <div className="col-start-4 row-start-2 space-y-[0.3em] text-[0.7em]">
          <PriceRow label="合計" value="¥1,100" bold />
          <PriceRow label="受取" value="¥2,000" />
          <PriceRow label="おつり" value="¥900" bold />
        </div>
        <div className="col-start-5 row-start-2">
          <div className="rounded-md bg-theme-primary py-[0.5em] text-center font-bold text-[0.8em] text-white">
            送信
          </div>
        </div>
      </div>
    </div>
  );
}

function PriceRow({
  label,
  value,
  bold,
}: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between", bold && "font-bold")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

const sampleOrders = [
  { id: 38, cups: ["ホ", "ア"], state: "calling" },
  { id: 39, cups: ["ホ"], state: "ready" },
  { id: 40, cups: ["ア", "ア", "ミ"], state: "ready" },
  { id: 41, cups: ["ホ", "ベ"], state: "ready" },
  { id: 42, cups: ["ア"], state: "ready" },
  { id: 43, cups: ["ホ", "ホ"], state: "ready" },
] as const;

function OrderBoardPreview({ user }: { user: "master" | "serve" }) {
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="flex items-center justify-between px-[0.8em] py-[0.5em]">
        <span className="text-[1.3em]">
          {user === "master" ? "マスター" : "提供"}
        </span>
        {user === "master" && (
          <span className="rounded bg-red-700 px-[0.6em] py-[0.25em] text-[0.7em] text-white">
            オーダーストップする
          </span>
        )}
        <span className="text-[0.7em]">提供待ち：6</span>
      </div>
      <div className="grid grid-cols-4 gap-[0.5em] px-[0.8em]">
        {sampleOrders.map((order) => {
          const calling = order.state === "calling";
          return (
            <div
              key={order.id}
              className={cn(
                "rounded-md border p-[0.4em] shadow-sm",
                calling && "bg-gray-300 text-gray-500",
              )}
            >
              <div className="flex items-end justify-between">
                <span className="font-black text-[1.6em]">
                  <span className="text-[0.4em]">No.</span>
                  {order.id}
                </span>
                <span className="text-[0.8em]">{order.cups.length}杯</span>
              </div>
              <div className="mt-[0.3em] grid grid-cols-2 gap-[0.25em]">
                {order.cups.map((cup, i) => (
                  <span
                    key={`${order.id}-${i}`}
                    className={cn(
                      "rounded border py-[0.1em] text-center font-bold text-[0.8em]",
                      !calling && cup === "ア" && "bg-blue-200",
                      !calling && cup === "ベ" && "bg-green-300",
                      !calling &&
                        cup === "ミ" &&
                        (user === "serve" ? "bg-yellow-200" : "bg-gray-300"),
                    )}
                  >
                    {cup}
                  </span>
                ))}
              </div>
              {user === "serve" && (
                <div className="mt-[0.3em] flex justify-end gap-[0.25em]">
                  <span
                    className={cn(
                      "flex h-[1.5em] w-[1.8em] items-center justify-center rounded",
                      calling ? "bg-white" : "bg-gray-500",
                    )}
                  >
                    <HiBell
                      className={cn(
                        "h-[0.9em] w-[0.9em]",
                        calling ? "fill-orange-600" : "fill-white",
                      )}
                    />
                  </span>
                  <span className="flex h-[1.5em] w-[1.8em] items-center justify-center rounded bg-green-600">
                    <FaCheck className="h-[0.8em] w-[0.8em] fill-white" />
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CashierMiniPreview() {
  return (
    <div className="relative flex h-full flex-col justify-between bg-linear-to-br from-theme-primary via-theme-primary to-theme-sub-deep p-[1.2em] font-bold text-white">
      <img
        src={logoSVG}
        alt=""
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-[70%] opacity-25"
      />
      <div className="relative text-[1.6em]">
        No.<span className="text-[1.6em]">42</span>
      </div>
      <div className="relative">
        <div className="flex items-end justify-between border-white border-t pt-[0.4em]">
          <span className="text-[1.4em]">合計</span>
          <span className="text-[2em] tabular-nums">
            1,100<span className="text-[0.6em]">円</span>
          </span>
        </div>
        <div className="flex justify-between text-[0.9em]">
          <span>おつり</span>
          <span className="tabular-nums">900 円</span>
        </div>
      </div>
    </div>
  );
}

function CallscreenPreview() {
  return (
    <div className="flex h-full flex-col p-[0.3em]">
      <div className="flex h-[66%]">
        <div className="flex w-[40%] items-center justify-center border-r">
          <div className="rounded-xl px-[1em] py-[0.4em] shadow-[0.3em_0.3em_0.6em_rgba(0,0,0,0.25)]">
            <span className="font-extrabold text-[3em] text-theme-primary">
              38
            </span>
          </div>
        </div>
        <div className="w-[60%] p-[0.5em]">
          <div className="flex items-center justify-center gap-[0.3em] rounded-full bg-linear-to-r/oklch from-theme-primary to-theme-sub-deep py-[0.25em] font-bold text-[0.8em] text-white">
            <HiBell />
            お呼び出し中
            <HiBell />
          </div>
          <div className="mt-[0.5em] grid grid-cols-3 gap-[0.4em]">
            {[35, 36, 38].map((n) => (
              <div
                key={n}
                className="rounded-md border py-[0.2em] text-center font-bold text-[1.4em] text-theme-primary shadow-sm"
              >
                {n}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t p-[0.5em]">
        <div className="flex items-center justify-center gap-[0.3em] rounded-full bg-linear-to-r/oklch from-theme-primary to-theme-sub-deep py-[0.25em] font-bold text-[0.8em] text-white">
          <FaCoffee />
          ドリップ中
        </div>
        <div className="mt-[0.4em] grid grid-cols-8 gap-[0.3em]">
          {[39, 40, 41, 42, 43].map((n) => (
            <div
              key={n}
              className="rounded border py-[0.1em] text-center font-bold text-[0.8em] text-theme-primary"
            >
              {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardPreview() {
  const bars = [
    { name: "ホット", now: 82, past: 95 },
    { name: "アイス", now: 64, past: 70 },
    { name: "ミルク", now: 45, past: 40 },
    { name: "ベッピン", now: 38, past: 52 },
    { name: "マンデ", now: 22, past: 30 },
    { name: "限定", now: 15, past: 12 },
  ];
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="flex items-center justify-between px-[0.8em] py-[0.4em]">
        <span className="text-[1.3em]">ダッシュボード</span>
        <span className="text-[0.7em]">提供待ち：6</span>
      </div>
      <div className="mx-[0.8em] flex w-fit gap-[0.2em] rounded-md bg-muted p-[0.2em] text-[0.6em]">
        {["種類別注文数", "提供時間推移", "注文一覧"].map((tab, i) => (
          <span
            key={tab}
            className={cn(
              "rounded px-[0.5em] py-[0.15em]",
              i === 0 ? "bg-white shadow-sm" : "text-stone-500",
            )}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="m-[0.8em] flex flex-1 items-end gap-[0.8em] rounded-md border px-[1em] pt-[0.8em] pb-[0.4em]">
        {bars.map((bar) => (
          <div
            key={bar.name}
            className="flex h-full flex-1 items-end gap-[0.15em]"
          >
            <div
              className="flex-1 rounded-t bg-[hsl(var(--chart-2))]"
              style={{ height: `${bar.now}%` }}
            />
            <div
              className="flex-1 rounded-t bg-[hsl(var(--chart-2))] opacity-30"
              style={{ height: `${bar.past}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function InventoryPreview() {
  const resources = [
    { kind: "豆", name: "ブラジル", value: "64 杯", level: "ok" },
    { kind: "豆", name: "エチオピア", value: "18 杯", level: "warning" },
    { kind: "カップ", name: "ホット用", value: "120 個", level: "ok" },
    { kind: "カップ", name: "アイス用", value: "9 個", level: "critical" },
  ] as const;
  return (
    <div className="flex h-full flex-col px-[1em] py-[0.8em]">
      <span className="font-semibold text-[1.2em]">在庫</span>
      <div className="mt-[0.3em] flex gap-[0.3em] text-[0.6em]">
        <span className="rounded bg-stone-900 px-[0.6em] py-[0.2em] text-white">
          残量
        </span>
        <span className="rounded border px-[0.6em] py-[0.2em]">設定</span>
      </div>
      <div className="mt-[0.6em] grid flex-1 grid-cols-2 gap-[0.5em]">
        {resources.map((r) => (
          <div
            key={r.name}
            className={cn(
              "rounded-md border p-[0.5em] shadow-sm",
              r.level === "warning" && "border-amber-400",
              r.level === "critical" && "border-red-400",
            )}
          >
            <div className="flex items-center gap-[0.3em] text-[0.7em]">
              <span className="rounded bg-muted px-[0.3em] text-stone-500">
                {r.kind}
              </span>
              <span className="font-semibold">{r.name}</span>
            </div>
            <div className="mt-[0.2em] font-bold text-[1.3em] tabular-nums">
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RehearsalPreview() {
  return (
    <div className="flex h-full flex-col px-[1em] py-[0.8em]">
      <span className="font-bold text-[1.2em]">オペ練：次のお客さん</span>
      <div className="mt-[0.5em] grid flex-1 grid-cols-3 gap-[0.5em]">
        <div className="col-span-2 rounded-md border-[0.2em] border-amber-900 p-[0.6em]">
          <div className="text-[0.7em] text-stone-600">次のお客さん</div>
          <div className="mt-[0.3em] space-y-[0.1em] font-bold text-[1.4em] text-amber-950">
            <div>ホット × 2</div>
            <div>アイス × 1</div>
          </div>
        </div>
        <div className="space-y-[0.4em] rounded-md border p-[0.5em]">
          <div>
            <div className="text-[0.6em] text-stone-600">並んでいる人数</div>
            <div className="font-bold text-[1.8em]">4</div>
          </div>
          <div>
            <div className="text-[0.6em] text-stone-600">次の客まで</div>
            <div className="font-bold text-[1em]">12 秒</div>
          </div>
        </div>
      </div>
      <div className="mt-[0.5em] rounded-md border border-green-600 bg-green-50 px-[0.6em] py-[0.3em] text-[0.7em]">
        <span className="font-bold">受付を続けてよい目安です</span>
        <span className="ml-[0.5em] text-stone-600">提供待ち 8 杯</span>
      </div>
    </div>
  );
}
