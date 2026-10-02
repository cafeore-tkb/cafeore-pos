import {
  GOODS_ROLE,
  type GeneratedOrder,
  type GeneratorParams,
  ROLE_LABELS,
  flatProfile,
  generateOrders,
  scaleOfLevel,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MetaFunction } from "react-router";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "オペ練 / 珈琲・俺POS" }];
};

// パラメータは注文間隔そのものを含むのでリポジトリに置かず、端末で読み込んで覚えておく（#748）
const STORAGE_KEY = "rehearsal-params";
const LEVELS = [0.8, 1.0, 1.2, 1.4, 1.6];
const BUSY = "busy";
const TICK_MS = 250;

const isParams = (value: unknown): value is GeneratorParams => {
  const v = value as GeneratorParams;
  return (
    v?.version === 1 &&
    Array.isArray(v.edges) &&
    Array.isArray(v.gapsByStratum) &&
    v.gapsByStratum.every((gaps) => Array.isArray(gaps) && gaps.length > 0) &&
    Array.isArray(v.baskets) &&
    Array.isArray(v.days)
  );
};

const loadStored = (): GeneratorParams | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isParams(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const store = (params: GeneratorParams) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // 覚えておけなくても、このページを開いている間は使える
  }
};

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const contents = (order: GeneratedOrder) => [
  ...Object.entries(order.roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, n]) => ({ label: ROLE_LABELS[role] ?? role, n })),
  ...(order.goods > 0
    ? [{ label: ROLE_LABELS[GOODS_ROLE], n: order.goods }]
    : []),
];

export default function Rehearsal() {
  const [params, setParams] = useState<GeneratorParams | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [level, setLevel] = useState(1.0);
  const [durationMin, setDurationMin] = useState(120);
  const [seed, setSeed] = useState(1);
  const [profileKey, setProfileKey] = useState(BUSY);

  const [running, setRunning] = useState(false);
  // 一度でも開始したか。開始したら設定を変えられないようにする
  const [started, setStarted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [queue, setQueue] = useState<number[]>([]);
  const [arrived, setArrived] = useState(0);
  const [accepted, setAccepted] = useState(0);

  const {
    orders: posOrders,
    isOrdersLoaded,
    masterState,
  } = useOrdersWSContext();
  // オーダーストップは API から WebSocket で届いた最新を優先する。
  // 接続してから一度も変わっていなければ届かないので、ヘッダーと同じ Firestore の値を使う
  const firestoreOperational = useOrderStat();
  const isOperational = masterState
    ? masterState.type !== "stop"
    : firestoreOperational;

  useEffect(() => {
    setParams(loadStored());
  }, []);

  const generated = useMemo(() => {
    if (!params) return [];
    const day = params.days.find((d) => d.date === profileKey);
    return generateOrders(params, {
      // 混む時間帯は最上位の層のレートをずっと続ける
      profile: day
        ? day.binRates
        : flatProfile(
            params.edges[params.edges.length - 1],
            durationMin,
            params.binMinutes,
          ),
      durationMin: day ? day.durationMin : durationMin,
      scale: scaleOfLevel(level),
      seed,
    });
  }, [params, profileKey, durationMin, level, seed]);

  const totalSec = useMemo(() => {
    const day = params?.days.find((d) => d.date === profileKey);
    return (day ? day.durationMin : durationMin) * 60;
  }, [params, profileKey, durationMin]);

  // 時計はオーダーストップ中は進めない。止めている間は客も来ない
  const ticking = running && isOperational;
  useEffect(() => {
    if (!ticking) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      // 差分は先に確定させる。更新関数の中で last を読むと、実行が遅れたときに 0 になる
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      setElapsedSec((sec) => Math.min(sec + dt, totalSec));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [ticking, totalSec]);

  // 経過時間に追いついた客を列に並べる
  useEffect(() => {
    if (!started) return;
    let next = arrived;
    while (next < generated.length && generated[next].offsetSec <= elapsedSec)
      next++;
    if (next === arrived) return;
    const newcomers = Array.from(
      { length: next - arrived },
      (_, i) => arrived + i,
    );
    setQueue((q) => [...q, ...newcomers]);
    setArrived(next);
  }, [started, elapsedSec, arrived, generated]);

  useEffect(() => {
    if (running && elapsedSec >= totalSec) setRunning(false);
  }, [running, elapsedSec, totalSec]);

  // レジで注文が確定したら、並んでいる先頭を消す。開始より前からある注文は数えない
  const seenIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!isOrdersLoaded) return;
    const ids = posOrders.map((o) => o.id);
    if (seenIds.current === null || !started) {
      seenIds.current = new Set(ids);
      return;
    }
    const known = seenIds.current;
    const fresh = ids.filter((id) => !known.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) known.add(id);
    const n = Math.min(fresh.length, queue.length);
    setQueue(queue.slice(n));
    setAccepted((a) => a + n);
  }, [posOrders, isOrdersLoaded, started, queue]);

  const acceptHead = () => {
    if (queue.length === 0) return;
    setQueue((q) => q.slice(1));
    setAccepted((a) => a + 1);
  };

  const reset = () => {
    setRunning(false);
    setStarted(false);
    setElapsedSec(0);
    setQueue([]);
    setArrived(0);
    setAccepted(0);
    seenIds.current = null;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isParams(parsed)) {
        setLoadError("生成器のパラメータの形ではありません");
        return;
      }
      store(parsed);
      setParams(parsed);
      setLoadError(null);
      reset();
    } catch {
      setLoadError("JSON として読めませんでした");
    }
  };

  const head = queue.length > 0 ? generated[queue[0]] : null;
  const nextArrival =
    arrived < generated.length
      ? generated[arrived].offsetSec - elapsedSec
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 font-sans">
      <div>
        <h1 className="font-bold font-noto text-3xl">オペ練：次のお客さん</h1>
        <p className="mt-1 text-sm text-stone-600">
          過去の祭の注文から、混む時間帯の客の流れを作って出題します。レジ係は出た注文をいつものレジ画面で打ってください。
          注文が確定すると、並んでいる先頭が自動で消えます。この画面は注文を作りません。
        </p>
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            パラメータ
            <input
              type="file"
              accept="application/json,.json"
              className="ml-2 text-sm"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <span
            className={cn(
              "text-sm",
              params ? "text-green-700" : "text-stone-500",
            )}
          >
            {params
              ? `読み込み済み（${params.source.dates.join("・")} の ${params.source.orders} 件から）`
              : "rehearsal-params.json を読み込んでください"}
          </span>
          {loadError && (
            <span className="text-red-700 text-sm">{loadError}</span>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-sm">
            流れ
            <select
              className="mt-1 h-10 rounded-md border px-2"
              value={profileKey}
              disabled={started || !params}
              onChange={(e) => setProfileKey(e.target.value)}
            >
              <option value={BUSY}>混む時間帯（ずっと最も混む層）</option>
              {params?.days.map((day) => (
                <option key={day.date} value={day.date}>
                  {day.date} の 1 日（{day.openAt.slice(0, 5)} から）
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            混雑の段
            <select
              className="mt-1 h-10 rounded-md border px-2"
              value={level}
              disabled={started || !params}
              onChange={(e) => setLevel(Number(e.target.value))}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  × {l.toFixed(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            長さ（分）
            <input
              type="number"
              min={10}
              max={600}
              step={10}
              className="mt-1 h-10 w-24 rounded-md border px-2"
              value={durationMin}
              disabled={started || !params || profileKey !== BUSY}
              onChange={(e) =>
                setDurationMin(Math.max(1, Number(e.target.value) || 1))
              }
            />
          </label>
          <label className="flex flex-col text-sm">
            seed
            <input
              type="number"
              className="mt-1 h-10 w-24 rounded-md border px-2"
              value={seed}
              disabled={started || !params}
              onChange={(e) => setSeed(Math.trunc(Number(e.target.value) || 0))}
            />
          </label>
          <div className="flex gap-2">
            <Button
              disabled={!params || elapsedSec >= totalSec}
              onClick={() => {
                setStarted(true);
                setRunning((r) => !r);
              }}
            >
              {running ? "一時停止" : started ? "再開" : "開始"}
            </Button>
            <Button variant="outline" disabled={!started} onClick={reset}>
              最初から
            </Button>
          </div>
        </div>
        {params && (
          <p className="text-sm text-stone-600">
            この設定で {generated.length} 人の客が来ます。同じ seed
            なら毎回同じ流れです。
          </p>
        )}
      </section>

      {running && !isOperational && (
        <div className="rounded-lg bg-violet-600 p-3 text-center text-white">
          オーダーストップ中：客の到着を止めています
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border-4 border-amber-900 p-6 md:col-span-2">
          <h2 className="text-stone-600">次のお客さん</h2>
          {head ? (
            <>
              <ul className="mt-2 space-y-1">
                {contents(head).map(({ label, n }) => (
                  <li key={label} className="font-bold text-4xl text-amber-950">
                    {label} × {n}
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                variant="outline"
                className="mt-6"
                onClick={acceptHead}
              >
                受付した（手で進める）
              </Button>
            </>
          ) : (
            <p className="mt-2 text-2xl text-stone-500">
              {started
                ? "いま並んでいる人はいません"
                : "開始を押すと客が来ます"}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-lg border p-4 md:grid-cols-1">
          <div>
            <dt className="text-sm text-stone-600">並んでいる人数</dt>
            <dd className="font-bold text-5xl">{queue.length}</dd>
          </div>
          <div>
            <dt className="text-sm text-stone-600">次の客まで</dt>
            <dd className="font-bold text-2xl">
              {nextArrival === null ? "—" : `${Math.ceil(nextArrival)} 秒`}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-stone-600">経過</dt>
            <dd className="text-xl">
              {clock(elapsedSec)} / {clock(totalSec)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-stone-600">来た客 / 受付済み</dt>
            <dd className="text-xl">
              {arrived} / {accepted}
            </dd>
          </div>
        </dl>
      </section>

      {queue.length > 1 && (
        <section>
          <h2 className="text-stone-600">その後ろ</h2>
          <ol className="mt-2 space-y-1">
            {queue.slice(1, 6).map((index) => (
              <li key={index} className="text-lg">
                {contents(generated[index])
                  .map(({ label, n }) => `${label} × ${n}`)
                  .join("、")}
              </li>
            ))}
          </ol>
          {queue.length > 6 && (
            <p className="text-stone-500">ほか {queue.length - 6} 人</p>
          )}
        </section>
      )}

      <p className="text-stone-500 text-xs">
        注文の中身は役割カテゴリまでです（2026
        年のメニューへの割り当ては未対応）。セット販売の注文は出ません。
        作っているのは過去の体制でさばけた注文の流れで、需要の予測ではありません。
      </p>
    </div>
  );
}
