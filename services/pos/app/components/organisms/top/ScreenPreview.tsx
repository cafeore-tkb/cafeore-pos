import { FaCheck } from "react-icons/fa";
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
  | "master-sheet"
  | "master-sheet-view"
  | "master-sheet-libero"
  | "serve"
  | "cashier-mini"
  | "callscreen"
  | "dashboard"
  | "inventory"
  | "rehearsal"
  | "products";

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
  "master-sheet": () => <CaosPreview />,
  "master-sheet-view": () => <CaosPreview readOnly />,
  "master-sheet-libero": LiberoPreview,
  serve: () => <OrderBoardPreview user="serve" />,
  "cashier-mini": CashierMiniPreview,
  callscreen: CallscreenPreview,
  dashboard: DashboardPreview,
  inventory: InventoryPreview,
  rehearsal: RehearsalPreview,
  products: ProductsPreview,
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
  // 呼び出しがある間の画面（お呼び出し中・ドリップ中・準備中の 3 段）。呼び出しが無い間は CM を流す
  const heading = (ja: string, en: string) => (
    <div className="flex items-center gap-[0.4em]">
      <span className="font-zen text-[0.8em] tracking-[0.2em]">{ja}</span>
      <span className="font-zen text-[0.4em] text-theme-gold uppercase tracking-[0.3em]">
        {en}
      </span>
      <div className="h-px flex-1 bg-linear-to-r from-theme-gold/60 to-transparent" />
    </div>
  );
  return (
    <div className="flex h-full flex-col gap-[0.4em] bg-[radial-gradient(120%_100%_at_18%_0%,var(--color-theme-primary),var(--color-theme-deep)_50%,color-mix(in_oklch,var(--color-theme-deep)_55%,black))] p-[0.6em] text-white">
      <div className="flex h-[52%] flex-col gap-[0.3em]">
        {heading("お呼び出し中", "Now Calling")}
        <div className="grid flex-1 grid-cols-3 gap-[0.4em]">
          {[38, 36, 35].map((n) => (
            <div
              key={n}
              className="flex items-center justify-center rounded-md border border-theme-gold/50 bg-white/10 font-semibold font-zen text-[2.4em]"
            >
              {n}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-[0.3em]">
        {heading("ドリップ中", "Brewing")}
        <div className="grid flex-1 grid-cols-2 gap-[0.4em]">
          {[
            { n: 39, dripper: "1st" },
            { n: 40, dripper: "3rd" },
          ].map(({ n, dripper }) => (
            <div
              key={n}
              className="flex flex-col items-center justify-center rounded-md border border-white/15 bg-white/[0.07]"
            >
              <span className="font-semibold font-zen text-[1.5em] leading-none">
                {n}
              </span>
              <span className="text-[0.45em] text-theme-gold">
                {dripper} ドリッパー
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-[0.4em] rounded-md border border-white/10 bg-white/[0.03] px-[0.5em] py-[0.3em]">
        <span className="font-zen text-[0.7em]">準備中</span>
        {[41, 42, 43].map((n) => (
          <span
            key={n}
            className="rounded border border-white/15 px-[0.4em] font-zen text-[0.7em] text-white/80"
          >
            {n}
          </span>
        ))}
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
    { kind: "アイテム", name: "ブラジル", value: "64 回分", level: "ok" },
    {
      kind: "アイテム",
      name: "エチオピア",
      value: "18 回分",
      level: "warning",
    },
    { kind: "カップ", name: "ホット用", value: "120 回分", level: "ok" },
    { kind: "カップ", name: "アイス用", value: "9 回分", level: "critical" },
  ] as const;
  return (
    <div className="flex h-full flex-col px-[1em] py-[0.8em]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[1.2em]">在庫</span>
        <span className="text-[0.6em] text-stone-500 underline">
          在庫の設定 →
        </span>
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

function ProductsPreview() {
  const menus = [
    { name: "優勝ブレンド", key: "-", price: "¥500" },
    { name: "珈琲・俺ブレンド", key: "^", price: "¥300" },
    { name: "ケニア", key: ";", price: "¥400" },
    { name: "アイスコーヒー", key: "\\", price: "¥400" },
    { name: "トートセット", key: "@", price: "¥1000" },
  ];
  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col px-[1em] py-[0.8em]">
        <span className="font-semibold text-[1.2em]">商品管理</span>
        <div className="mt-[0.3em] flex w-fit gap-[0.2em] rounded-md bg-muted p-[0.2em] text-[0.55em]">
          {["メニュー", "アイテム", "タイプ", "背景色", "在庫"].map(
            (tab, i) => (
              <span
                key={tab}
                className={cn(
                  "rounded px-[0.5em] py-[0.15em]",
                  i === 0 ? "bg-white shadow-sm" : "text-stone-500",
                )}
              >
                {tab}
              </span>
            ),
          )}
        </div>
        <div className="mt-[0.5em] divide-y rounded-md border text-[0.7em]">
          {menus.map((menu, i) => (
            <div
              key={menu.name}
              className={cn(
                "flex items-center gap-[0.6em] px-[0.6em] py-[0.35em]",
                i === 2 && "bg-muted",
              )}
            >
              <span className="flex-1 font-semibold">{menu.name}</span>
              <span className="rounded border px-[0.4em] font-mono">
                {menu.key}
              </span>
              <span className="w-[3.5em] text-right tabular-nums">
                {menu.price}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex w-[34%] flex-col gap-[0.4em] border-l bg-stone-50 p-[0.7em] text-[0.6em] shadow-[-0.3em_0_0.6em_rgba(0,0,0,0.06)]">
        <span className="font-semibold text-[1.4em]">アイテムの編集</span>
        <div>
          <div className="text-stone-500">名前</div>
          <div className="rounded border bg-white px-[0.4em] py-[0.2em]">
            ケニア
          </div>
        </div>
        <div className="rounded border bg-white p-[0.4em]">
          <div className="font-semibold">在庫</div>
          <div className="mt-[0.2em] flex justify-between">
            <span>単位</span>
            <span>g</span>
          </div>
          <div className="flex justify-between">
            <span>1回の量</span>
            <span>15</span>
          </div>
        </div>
        <span className="mt-auto self-end rounded bg-stone-900 px-[0.8em] py-[0.2em] text-white">
          保存
        </span>
      </div>
    </div>
  );
}

// CaOS（ドリップ管制）の管制盤：ドリッパー1〜6の行に抽出カードがタイムラインで並び、下に未割当の注文。
// readOnly は閲覧だけの画面（/master-sheet/view）。管制盤の切り替えの代わりに「閲覧のみ」を出す。
function CaosPreview({ readOnly = false }: { readOnly?: boolean }) {
  const lanes: {
    state: string;
    cards: { left: number; width: number; tone: string }[];
  }[] = [
    {
      state: "抽出中",
      cards: [
        { left: 0, width: 30, tone: "bg-blue-500" },
        { left: 32, width: 22, tone: "bg-blue-200" },
      ],
    },
    { state: "抽出中", cards: [{ left: 0, width: 22, tone: "bg-cyan-500" }] },
    { state: "待機", cards: [] },
    {
      state: "抽出中",
      cards: [
        { left: 0, width: 38, tone: "bg-emerald-500" },
        { left: 40, width: 22, tone: "bg-emerald-200" },
      ],
    },
    { state: "抽出中", cards: [{ left: 0, width: 16, tone: "bg-orange-400" }] },
    { state: "待機", cards: [] },
  ];
  const unassigned = ["#043", "#044", "#045"];
  return (
    <div className="flex h-full flex-col gap-[0.4em] bg-[#f0f4fa] p-[0.5em] text-[#0f172a]">
      <div className="flex items-center gap-[0.4em]">
        <span className="rounded bg-slate-900 px-[0.5em] py-[0.15em] font-black text-[0.8em] text-white">
          CaOS
        </span>
        {readOnly ? (
          <span className="rounded border bg-white px-[0.4em] py-[0.1em] font-bold text-[0.6em] text-slate-600">
            閲覧のみ
          </span>
        ) : (
          ["A", "B", "C", "D"].map((v, i) => (
            <span
              key={v}
              className={cn(
                "flex h-[1.4em] w-[1.4em] items-center justify-center rounded font-bold text-[0.7em]",
                i === 0 ? "bg-blue-700 text-white" : "bg-white text-slate-500",
              )}
            >
              {v}
            </span>
          ))
        )}
        <span className="ml-auto font-black font-mono text-[1.1em]">10:24</span>
      </div>
      <div className="relative flex-1 overflow-hidden rounded-md border bg-white">
        {lanes.map((lane, i) => (
          <div
            key={`lane-${i + 1}`}
            className="flex h-1/6 items-center border-b last:border-b-0"
          >
            <div className="flex w-[22%] items-center gap-[0.3em] border-r px-[0.3em]">
              <span className="flex h-[1.3em] w-[1.3em] items-center justify-center rounded border font-bold text-[0.7em]">
                {i + 1}
              </span>
              <span className="text-[0.6em] text-slate-600">{lane.state}</span>
            </div>
            <div className="relative h-[70%] flex-1">
              {lane.cards.map((card) => (
                <span
                  key={card.left}
                  className={cn("absolute top-0 h-full rounded-sm", card.tone)}
                  style={{ left: `${card.left + 4}%`, width: `${card.width}%` }}
                />
              ))}
            </div>
          </div>
        ))}
        <span className="absolute top-0 bottom-0 left-[26%] w-[0.12em] bg-red-500" />
      </div>
      <div className="flex items-center gap-[0.4em] rounded-md border bg-white px-[0.5em] py-[0.3em]">
        <span className="font-bold text-[0.7em]">未割当</span>
        {unassigned.map((id) => (
          <span
            key={id}
            className="rounded border border-blue-300 bg-blue-50 px-[0.4em] py-[0.1em] font-bold font-mono text-[0.6em]"
          >
            {id}
          </span>
        ))}
      </div>
    </div>
  );
}

// CaOS のリベロビュー（/master-sheet/libero）：ドリッパー1〜6の行に、入れ始めてからの時間の長い順の順位と経過を大きく。
// 長いほど濃く、予定の抽出時間を過ぎたら赤。抽出していないドリッパーは薄く
function LiberoPreview() {
  const lanes = [
    {
      id: 6,
      name: "田中",
      no: "042",
      cups: 2,
      time: "0:24",
      fill: 92,
      color: "#b91c1c",
      next: "046",
    },
    {
      id: 5,
      name: "佐藤",
      no: "043",
      cups: 1,
      time: "1:12",
      fill: 76,
      color: "#1d4ed8",
      next: "047",
    },
    {
      id: 4,
      name: "鈴木",
      no: "044",
      cups: 2,
      time: "2:30",
      fill: 58,
      color: "#ef7777",
      next: "048",
    },
    {
      id: 3,
      name: "高橋",
      no: "045",
      cups: 1,
      time: "3:20",
      fill: 33,
      color: "#93b8ef",
      next: "049",
    },
    {
      id: 2,
      name: "山田",
      no: "041",
      cups: 2,
      time: "あとちょっと",
      fill: 100,
      color: "#991b1b",
      next: "050",
    },
    {
      id: 1,
      name: "伊藤",
      no: "046",
      cups: 1,
      time: "4:30",
      fill: 10,
      color: "#f5caca",
      next: "051",
    },
  ];
  return (
    <div className="flex h-full flex-col gap-[0.4em] bg-[#f0f4fa] p-[0.5em] text-[#0f172a]">
      <div className="flex items-center gap-[0.4em]">
        <span className="rounded bg-slate-900 px-[0.5em] py-[0.15em] font-black text-[0.8em] text-white">
          CaOS
        </span>
        <span className="rounded border bg-white px-[0.4em] py-[0.1em] font-bold text-[0.6em] text-slate-600">
          リベロ
        </span>
        <span className="ml-auto font-black text-[1.1em] tabular-nums">
          10:24
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-6 gap-[0.3em]">
        {lanes.map((lane) => (
          <div
            key={lane.id}
            className="grid min-w-0 grid-rows-[1fr_3fr_2fr] overflow-hidden rounded border border-slate-300 bg-white text-center"
          >
            <div className="flex flex-col items-center justify-center border-slate-200 border-b py-[0.3em]">
              <span className="font-black text-[1.5em]">{lane.id}</span>
              <span className="font-bold text-[0.65em]">{lane.name}</span>
            </div>
            <div className="relative isolate flex flex-col items-center justify-evenly overflow-hidden py-[0.5em]">
              <div
                className="-z-[1] absolute inset-y-0 right-0"
                style={{ width: `${lane.fill}%`, backgroundColor: lane.color }}
              />
              <span className="rounded bg-white px-[0.1em] font-black text-[0.9em]">
                #{lane.no}
              </span>
              <span className="rounded bg-white px-[0.2em] font-black text-[1.1em]">
                {lane.cups}杯
              </span>
              <span className="rounded bg-white px-[0.2em] text-[0.55em]">
                あと
              </span>
              <span className="rounded bg-white px-[0.1em] font-black text-[0.8em] tabular-nums">
                {lane.time}
              </span>
              <div className="relative h-[0.25em] w-4/5 overflow-hidden rounded-full bg-slate-300">
                <div
                  className="absolute inset-y-0 right-0 bg-slate-800"
                  style={{ width: `${lane.fill}%` }}
                />
              </div>
            </div>
            <div
              className="flex flex-col items-center justify-evenly border-slate-300 border-t py-[0.4em]"
              style={{ backgroundColor: lane.id % 2 ? "#dbeafe" : "#fecaca" }}
            >
              <span className="text-[0.55em]">NEXT</span>
              <span className="font-black text-[0.85em]">#{lane.next}</span>
              <span className="font-black text-[0.85em]">1杯</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
