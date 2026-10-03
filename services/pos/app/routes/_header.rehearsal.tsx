import {
  FESTIVAL_STACK_MODEL,
  type GeneratorParams,
  type MenuEntity,
  type MenuPlan,
  type PlannedLine,
  RESUME_MIN,
  ROLE_LABELS,
  STOP_MIN,
  type WithId,
  flatProfile,
  generateOrders,
  initialPlan,
  matchPastItem,
  menuRepository,
  mulberry32,
  planOrder,
  reweightBaskets,
  scaleOfLevel,
  serviceMin,
  shouldStop,
  stackAt,
  unassignedRoles,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MetaFunction } from "react-router";
import { useOrderStat } from "~/components/functional/useOrderStat";
import {
  MenuPlanEditor,
  unitsOf,
} from "~/components/organisms/rehearsal/MenuPlanEditor";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "オペ練 / 珈琲・俺POS" }];
};

// パラメータは注文間隔そのものを含むのでリポジトリに置かず、端末で読み込んで覚えておく（#748）
const STORAGE_KEY = "rehearsal-params";
const PLAN_KEY = "rehearsal-menu-plan";
const LEVELS = [0.8, 1.0, 1.2, 1.4, 1.6];
const BUSY = "busy";
const TICK_MS = 250;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((n) => typeof n === "number");

const isCounts = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every((n) => typeof n === "number");

// localStorage に覚えるので、形が足りないものを通すと描画で落ちて毎回開けなくなる。使う項目は中まで確かめる
const isParams = (value: unknown): value is GeneratorParams => {
  const v = value as GeneratorParams;
  return (
    v?.version === 2 &&
    isRecord(v.source) &&
    Array.isArray(v.source.dates) &&
    v.source.dates.every((d) => typeof d === "string") &&
    typeof v.source.orders === "number" &&
    typeof v.binMinutes === "number" &&
    isNumbers(v.edges) &&
    v.edges.length > 0 &&
    Array.isArray(v.gapsByStratum) &&
    v.gapsByStratum.every((gaps) => isNumbers(gaps) && gaps.length > 0) &&
    Array.isArray(v.baskets) &&
    v.baskets.every(
      (b) =>
        isCounts(b?.roles) &&
        typeof b.goods === "number" &&
        typeof b.weight === "number",
    ) &&
    Array.isArray(v.days) &&
    v.days.every(
      (d) =>
        typeof d?.date === "string" &&
        typeof d.openAt === "string" &&
        typeof d.durationMin === "number" &&
        isNumbers(d.binRates) &&
        d.binRates.length > 0,
    ) &&
    Array.isArray(v.items) &&
    v.items.every(
      (item) =>
        typeof item?.id === "string" &&
        typeof item.name === "string" &&
        typeof item.role === "string" &&
        isCounts(item.counts),
    )
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

const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 覚えておけなくても、このページを開いている間は使える
  }
};

const isPlan = (value: unknown): value is MenuPlan => {
  const v = value as MenuPlan;
  return (
    v?.version === 1 &&
    isCounts(v.roleShares) &&
    isRecord(v.menus) &&
    Object.values(v.menus).every(
      (a) =>
        isRecord(a) &&
        (a.role === null || typeof a.role === "string") &&
        typeof a.weight === "number",
    )
  );
};

// 形が不正なら null を返し、去年の割合から作り直す
const loadPlan = (): MenuPlan | null => {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const EMPTY_PLAN: MenuPlan = { version: 1, roleShares: {}, menus: {} };

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 乱数を生成器と分けて、メニューの割り当てを変えても客の流れ（時刻・杯数）は変わらないようにする
const MENU_SEED_SALT = 0x5bd1e995;

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
  // 列に並んだ客のうち、列から消えた（受け付けた）客の数
  const accepted = arrived - queue.length;

  const [menus, setMenus] = useState<WithId<MenuEntity>[] | null>(null);
  const [menusError, setMenusError] = useState(false);
  const [plan, setPlan] = useState<MenuPlan | null>(null);

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
    menuRepository
      .findAll()
      .then(setMenus)
      .catch(() => setMenusError(true));
  }, []);

  // 割り当ては端末に覚えておく。初めてなら、名前が去年の商品と同じメニューを去年の割合で入れる。
  // 覚えている割り当てに無いメニュー（あとから足したもの）は、名前で分類だけ推して割合は 0 にする。
  // 今のメニューに無い id（消したメニューや入れ直した DB の古い id）は捨てる
  useEffect(() => {
    if (!params || !menus || plan) return;
    const stored = loadPlan();
    const planMenus = menus.map((m) => ({ id: m.id, name: m.name }));
    if (!stored) {
      setPlan(initialPlan(params, planMenus));
      return;
    }
    const known = new Set(menus.map((m) => m.id));
    const added = menus.filter((m) => !(m.id in stored.menus));
    setPlan({
      ...stored,
      menus: {
        ...Object.fromEntries(
          Object.entries(stored.menus).filter(([id]) => known.has(id)),
        ),
        ...Object.fromEntries(
          added.map((m) => [
            m.id,
            { role: matchPastItem(params, m.name)?.role ?? null, weight: 0 },
          ]),
        ),
      },
    });
  }, [params, menus, plan]);

  const changePlan = (next: MenuPlan) => {
    setPlan(next);
    store(PLAN_KEY, next);
  };

  const generated = useMemo(() => {
    if (!params) return [];
    const day = params.days.find((d) => d.date === profileKey);
    // 分類ごとの割合を去年から変えたら、過去の注文の組の重みを付け直してそこに合わせる
    const baskets = plan
      ? reweightBaskets(params.baskets, plan.roleShares)
      : params.baskets;
    return generateOrders(
      { ...params, baskets },
      {
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
      },
    );
  }, [params, plan, profileKey, durationMin, level, seed]);

  // セットに入っている物販の数。セットを引いた注文は、そのぶん別の物販を引かない
  const goodsInMenu = useMemo(
    () =>
      Object.fromEntries(
        (menus ?? []).map((menu) => [
          menu.id,
          menu.items
            .filter(({ item }) => item.item_type.name === "others")
            .reduce((sum, { quantity }) => sum + quantity, 0),
        ]),
      ),
    [menus],
  );

  const planned = useMemo(() => {
    const rng = mulberry32((seed ^ MENU_SEED_SALT) >>> 0);
    return generated.map((order) =>
      planOrder(order, plan ?? EMPTY_PLAN, rng, goodsInMenu),
    );
  }, [generated, plan, seed, goodsInMenu]);

  const menuById = useMemo(
    () => new Map((menus ?? []).map((m) => [m.id, m])),
    [menus],
  );
  const labelOf = (line: PlannedLine) => {
    const menu = line.menuId ? menuById.get(line.menuId) : undefined;
    if (!menu) return `${ROLE_LABELS[line.role] ?? line.role}（未割り当て）`;
    return unitsOf(menu) > 1 ? `${menu.name}（セット）` : menu.name;
  };
  const missingRoles = plan ? unassignedRoles(plan) : [];

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
    // 同じ描画で客が着いても上書きしないよう、更新関数で今の列から消す
    setQueue((q) => q.slice(Math.min(fresh.length, q.length)));
  }, [posOrders, isOrdersLoaded, started]);

  const acceptHead = () => {
    if (queue.length === 0) return;
    setQueue((q) => q.slice(1));
  };

  const reset = () => {
    setRunning(false);
    setStarted(false);
    setElapsedSec(0);
    setQueue([]);
    setArrived(0);
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
      store(STORAGE_KEY, parsed);
      setParams(parsed);
      setLoadError(null);
      reset();
    } catch {
      setLoadError("JSON として読めませんでした");
    }
  };

  // オーダーストップの目安。まだ提供可能になっていない注文のドリンク杯数から見込みを出す
  const stack = useMemo(
    () =>
      posOrders
        .filter((order) => order.readyAt === null)
        .reduce((sum, order) => sum + order.getDrinkCups().length, 0),
    [posOrders],
  );
  const serviceEstimate = serviceMin(FESTIVAL_STACK_MODEL, stack);
  const adviseStop = shouldStop(FESTIVAL_STACK_MODEL, stack, !isOperational);
  const stopCups = Math.floor(stackAt(FESTIVAL_STACK_MODEL, STOP_MIN)) + 1;
  const resumeCups = Math.ceil(stackAt(FESTIVAL_STACK_MODEL, RESUME_MIN)) - 1;

  const head = queue.length > 0 ? planned[queue[0]] : null;
  const nextArrival =
    started && arrived < generated.length
      ? generated[arrived].offsetSec - elapsedSec
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 font-sans">
      {/* 練習中に見るものを上に、設定は下にまとめる（iPad で開く想定） */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold font-noto text-2xl">オペ練：次のお客さん</h1>
        <div className="flex items-center gap-2">
          {params && (
            <span className="text-sm text-stone-600">
              × {level.toFixed(1)}・seed {seed}・{generated.length} 人
            </span>
          )}
          <Button
            size="lg"
            disabled={!params || elapsedSec >= totalSec}
            onClick={() => {
              setStarted(true);
              setRunning((r) => !r);
            }}
          >
            {running ? "一時停止" : started ? "再開" : "開始"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={!started}
            onClick={reset}
          >
            最初から
          </Button>
        </div>
      </div>

      {!params && (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
          ページの下の「設定」で rehearsal-params.json を読み込んでください。
        </p>
      )}

      {running && !isOperational && (
        <div className="rounded-lg bg-violet-600 p-3 text-center text-white">
          マスターがオーダーストップ中なので、客の到着を止めています
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border-4 border-amber-900 p-6 md:col-span-2">
          <h2 className="text-stone-600">次のお客さん</h2>
          {head ? (
            <>
              <ul className="mt-2 space-y-1">
                {head.map((line) => (
                  <li
                    key={line.menuId ?? line.role}
                    className="font-bold text-4xl text-amber-950"
                  >
                    {labelOf(line)} × {line.count}
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
                {planned[index]
                  .map((line) => `${labelOf(line)} × ${line.count}`)
                  .join("、")}
              </li>
            ))}
          </ol>
          {queue.length > 6 && (
            <p className="text-stone-500">ほか {queue.length - 6} 人</p>
          )}
        </section>
      )}

      <section
        className={cn(
          "rounded-lg border p-4",
          isOrdersLoaded &&
            adviseStop &&
            isOperational &&
            "border-red-600 bg-red-50",
          isOrdersLoaded &&
            !adviseStop &&
            !isOperational &&
            "border-green-600 bg-green-50",
        )}
      >
        <h2 className="text-stone-600">オーダーストップの目安</h2>
        {isOrdersLoaded ? (
          <>
            <p className="mt-1 font-bold text-2xl">
              {isOperational
                ? adviseStop
                  ? "止める目安を超えています"
                  : "受付を続けてよい目安です"
                : adviseStop
                  ? "まだ止めておく目安です"
                  : "再開してよい目安です"}
            </p>
            <p className="mt-1">
              提供待ちのドリンク {stack} 杯 → 新しい注文の提供時間の見込み{" "}
              {serviceEstimate.toFixed(1)} 分
            </p>
            <p className="mt-1 text-sm text-stone-600">
              見込みが {STOP_MIN} 分を超えたら（{stopCups} 杯以上）止め、
              {RESUME_MIN} 分を下回ったら（{resumeCups}{" "}
              杯以下）再開する目安です。止めるのはマスターの判断で、この画面は自動では止めません。
            </p>
          </>
        ) : (
          <p className="mt-1 text-stone-500">注文一覧を読み込んでいます</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-bold text-xl">設定</h2>
        <p className="text-sm text-stone-600">
          過去の祭の注文から、混む時間帯の客の流れを作って出題します。レジ係は出た注文をいつものレジ画面で打ってください。
          注文が確定すると、並んでいる先頭が自動で消えます。この画面は注文を作りません。
        </p>
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
        </div>
        {params && (
          <p className="text-sm text-stone-600">
            この設定で {generated.length} 人の客が来ます。同じ seed
            なら毎回同じ流れです。開始すると設定は変えられません。
          </p>
        )}
        {menusError && (
          <p className="text-red-700 text-sm">
            メニューを読み込めませんでした。注文は分類名のまま出ます。
          </p>
        )}
        {missingRoles.length > 0 && (
          <p className="text-amber-700 text-sm">
            メニューが割り当たっていない分類があります（
            {missingRoles.map((role) => ROLE_LABELS[role]).join("、")}
            ）。この分類の注文は分類名のまま出ます。
          </p>
        )}
      </section>

      {params && menus && plan && (
        <MenuPlanEditor
          params={params}
          menus={menus}
          plan={plan}
          onChange={changePlan}
          disabled={started}
        />
      )}

      <p className="text-stone-500 text-xs">
        注文の組（何杯をどの分類で）は過去の祭の注文をそのまま使い、その 1
        杯ずつを割り当てた今年のメニューに置き換えています。同じ分類の 2
        杯が別のメニューになることもあります。セットは 1 杯ぶんとして出ます。
        作っているのは過去の体制でさばけた注文の流れで、需要の予測ではありません。
        オーダーストップの目安は 2024・2025 年祭（抽出 5〜6
        人）の提供時間から当てはめたもので、今年の体制では外れることがあります。
      </p>
    </div>
  );
}
