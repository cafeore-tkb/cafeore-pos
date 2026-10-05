import { useEffect, useState } from "react";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";

/**
 * Slack の通知（api/internal/handlers/activity.go）の文言と条件を試すための雑ページ。
 * API にはつながっておらず、ここで変えても実際の通知は変わらない。
 * 決まったら「JSON をコピー」で書き出して、Go 側に反映する。
 *
 * 文面の書き方
 *   - {名前} は値に置き換わる
 *   - [ ] で囲んだ部分は、中の {名前} のどれかが空なら丸ごと消える
 */

export const meta: MetaFunction = () => [{ title: "通知の試作 / 珈琲・俺POS" }];

type Op =
  | "eq"
  | "ne"
  | "contains"
  | "not_contains"
  | "empty"
  | "not_empty"
  | "gte"
  | "lte"
  | "abs_gte";

const ops: { value: Op; label: string; noValue?: boolean }[] = [
  { value: "eq", label: "が次と等しい" },
  { value: "ne", label: "が次と等しくない" },
  { value: "contains", label: "が次を含む" },
  { value: "not_contains", label: "が次を含まない" },
  { value: "empty", label: "が空", noValue: true },
  { value: "not_empty", label: "が空でない", noValue: true },
  { value: "gte", label: "が次以上" },
  { value: "lte", label: "が次以下" },
  { value: "abs_gte", label: "の絶対値が次以上" },
];

type Condition = { id: string; var: string; op: Op; value: string };

type NotifyEvent = {
  key: string;
  label: string;
  enabled: boolean;
  template: string;
  /** 値の名前と、プレビューに使う例 */
  vars: Record<string, string>;
  conditions: Condition[];
};

// activity.go の今の文面と同じもの
const defaults: NotifyEvent[] = [
  ev(
    "item_type.created",
    "タイプを追加",
    "🆕 タイプを追加: {表示名}（{内部名}） :e-add:",
    { 表示名: "ホット", 内部名: "hot" },
  ),
  ev(
    "item_type.updated",
    "タイプを変更",
    "✏️ タイプを変更: {表示名}（{変更内容}） :e-change:",
    {
      表示名: "HOT",
      内部名: "hot",
      変更内容: "表示名 ホット → HOT",
      変更項目: "表示名",
    },
  ),
  ev(
    "item_type.deleted",
    "タイプを削除",
    "🗑️ タイプを削除: {表示名}（{内部名}） :e-delete:",
    { 表示名: "ホット", 内部名: "hot" },
  ),
  ev(
    "item.created",
    "アイテムを追加",
    "🆕 アイテムを追加: {名前}（略称 {略称} / {タイプ}） :e-add:",
    { 名前: "ルワンダ", 略称: "ルワ", タイプ: "ホット" },
  ),
  ev(
    "item.updated",
    "アイテムを変更",
    "✏️ アイテムを変更: {名前}（{変更内容}） :e-change:",
    {
      名前: "ルワンダ",
      略称: "ルワ",
      タイプ: "ホット",
      変更内容: "略称 ル → ルワ",
      変更項目: "略称",
    },
  ),
  ev("item.deleted", "アイテムを削除", "🗑️ アイテムを削除: {名前} :e-delete:", {
    名前: "ルワンダ",
  }),
  ev(
    "menu.created",
    "メニューを追加",
    "🆕 メニューを追加: {名前} ¥{価格}（キー {キー} / {構成}） :e-add:",
    {
      名前: "ルワンダ",
      略称: "ルワ",
      価格: "400",
      キー: "r",
      構成: "ルワンダ×1",
    },
  ),
  ev(
    "menu.updated",
    "メニューを変更",
    "✏️ メニューを変更: {名前}（{変更内容}） :e-change:",
    {
      名前: "ルワンダ",
      価格: "450",
      変更前の価格: "400",
      変更内容: "価格 ¥400 → ¥450",
      変更項目: "価格",
    },
  ),
  ev(
    "menu.deleted",
    "メニューを削除",
    "🗑️ メニューを削除: {名前}（キー {キー}） :e-delete:",
    { 名前: "ルワンダ", キー: "r" },
  ),
  ev(
    "color.created",
    "背景色を追加",
    "🆕 背景色を追加: {対象}（{画面}）{色} :e-add:",
    {
      対象: "ライチ",
      画面: "マスター",
      色: "#7bf1a8",
    },
  ),
  ev(
    "color.updated",
    "背景色を変更",
    "✏️ 背景色を変更: {対象}（{画面}）{変更前の色} → {色} :e-change:",
    { 対象: "ライチ", 画面: "マスター", 色: "#7bf1a8", 変更前の色: "#bedbff" },
  ),
  ev(
    "color.deleted",
    "背景色を削除",
    "🗑️ 背景色を削除: {対象}（{画面}）{色} :e-delete:",
    {
      対象: "ミルク",
      画面: "提供",
      色: "#fff085",
    },
  ),
  ev(
    "stock_resource.created",
    "在庫対象を追加",
    "🆕 在庫対象を追加: {名前}（{種類} / 1杯 {1杯あたり}{単位}） :e-add:",
    { 名前: "ケニア豆", 種類: "豆", 単位: "g", "1杯あたり": "15" },
  ),
  ev(
    "stock_resource.updated",
    "在庫対象を変更",
    "✏️ 在庫対象を変更: {名前}（{変更内容}） :e-change:",
    { 名前: "ケニア豆", 変更内容: "バッファ 20 → 30", 変更項目: "バッファ" },
  ),
  ev(
    "stock_resource.deleted",
    "在庫対象を削除",
    "🗑️ 在庫対象を削除: {名前} :e-delete:",
    {
      名前: "ケニア豆",
    },
  ),
  ev(
    "usage.item",
    "使用量を変更",
    "✏️ 使用量を変更: {アイテム} → {使用量} :e-take-inventory:",
    {
      アイテム: "ルワンダ",
      使用量: "ホットカップ 1個・ルワンダ豆 15g",
    },
  ),
  ev(
    "usage.all",
    "使用量をまとめて置き換え",
    "✏️ 使用量をまとめて置き換え（{件数}件） :e-take-inventory:",
    { 件数: "24" },
  ),
  ev(
    "stock.count",
    "棚卸し",
    "📝 {名前} {数量}{単位}[（推定 {推定}{単位}、差 {差}{単位}）][「{メモ}」] :e-take-inventory:",
    {
      名前: "ケニア豆",
      単位: "g",
      数量: "1200",
      推定: "1180",
      差: "+20",
      メモ: "",
    },
  ),
  ev(
    "stock.receipt",
    "入荷",
    "📝 {名前} {数量}{単位}[（残り約{残り}{単位}）][「{メモ}」] :e-restock:",
    {
      名前: "ケニア豆",
      単位: "g",
      数量: "+1000",
      残り: "2230",
      メモ: "追加発注分",
    },
  ),
  ev(
    "stock.adjust",
    "調整",
    "📝 {名前} {数量}{単位}[（残り約{残り}{単位}）][「{メモ}」]",
    { 名前: "ケニア豆", 単位: "g", 数量: "-50", 残り: "2180", メモ: "" },
  ),
  ev("master.stop", "オーダーストップ", "⛔ オーダーストップ :e-stop:", {}),
  ev("master.operational", "オーダー再開", "✅ オーダー再開 :e-restart:", {}),
];

function ev(
  key: string,
  label: string,
  template: string,
  vars: Record<string, string>,
): NotifyEvent {
  return { key, label, enabled: true, template, vars, conditions: [] };
}

const placeholder = /\{([^{}\s]+)\}/g;

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(placeholder, (m, name: string) =>
    name in vars ? vars[name] : m,
  );

// [ ] の中の {名前} のどれかが空なら丸ごと消す。{名前} を含まない [ ] はそのまま
function render(template: string, vars: Record<string, string>) {
  return template
    .replace(/\[([^\]]*)\]/g, (m, inner: string) => {
      const names = [...inner.matchAll(placeholder)].map((x) => x[1]);
      if (names.length === 0) return m;
      return names.some((n) => n in vars && vars[n] === "") ? "" : inner;
    })
    .replace(placeholder, (m) => fill(m, vars))
    .trim();
}

function match(c: Condition, vars: Record<string, string>) {
  const v = vars[c.var] ?? "";
  switch (c.op) {
    case "eq":
      return v === c.value.trim();
    case "ne":
      return v !== c.value.trim();
    case "contains":
      return v.includes(c.value);
    case "not_contains":
      return !v.includes(c.value);
    case "empty":
      return v === "";
    case "not_empty":
      return v !== "";
  }
  if (v.trim() === "" || c.value.trim() === "") return false;
  const n = Number(v);
  const want = Number(c.value);
  if (Number.isNaN(n) || Number.isNaN(want)) return false;
  if (c.op === "gte") return n >= want;
  if (c.op === "lte") return n <= want;
  return Math.abs(n) >= want;
}

const textOf = (e: NotifyEvent) =>
  e.enabled && e.conditions.every((c) => match(c, e.vars))
    ? render(e.template, e.vars)
    : "";

// 既定の文面を変えたらキーも変え、古い保存内容を読まないようにする
const STORAGE_KEY = "dev-notify-v3";
const WEBHOOK_KEY = "dev-notify-webhook";

const load = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

// Slack の Webhook は CORS を返さないので no-cors で投げる。結果は読めないので Slack で確認する
async function postToSlack(url: string, text: string) {
  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ text }),
  });
}

export default function DevNotifyPage() {
  const [events, setEvents] = useState<NotifyEvent[]>(() =>
    load(STORAGE_KEY, defaults),
  );
  const [webhook, setWebhook] = useState(() => load(WEBHOOK_KEY, ""));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
      localStorage.setItem(WEBHOOK_KEY, JSON.stringify(webhook));
    } catch {}
  }, [events, webhook]);

  const update = (key: string, patch: (e: NotifyEvent) => NotifyEvent) =>
    setEvents((list) => list.map((e) => (e.key === key ? patch(e) : e)));

  const send = async (texts: string[]) => {
    const text = texts.filter(Boolean).join("\n");
    if (!webhook) return toast.error("Webhook の URL を入れてください");
    if (!text)
      return toast.error("送る文面がありません（オフか条件を満たしていない）");
    try {
      await postToSlack(webhook, text);
      toast.success("投げました。Slack で確認してください");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "送れませんでした");
    }
  };

  const exportJson = async () => {
    const out = events.map(({ key, enabled, template, conditions }) => ({
      key,
      enabled,
      template,
      conditions: conditions.map(({ id: _, ...c }) => c),
    }));
    await navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    toast.success("JSON をコピーしました");
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl">通知の試作（開発用）</h1>
        <p className="text-muted-foreground text-sm">
          Slack
          通知の文言と条件を試すページ。ここで変えても実際の通知は変わりません。
          {"{名前}"} は値に、[ ] の中は値が空なら丸ごと消えます。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-4">
        <Input
          className="min-w-64 flex-1"
          placeholder="https://hooks.slack.com/services/..."
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
        />
        <Button onClick={() => send(events.map(textOf))}>
          全部まとめて試し投稿
        </Button>
        <Button variant="outline" onClick={exportJson}>
          JSON をコピー
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm("すべて既定に戻しますか？")) setEvents(defaults);
          }}
        >
          既定に戻す
        </Button>
      </div>

      {events.map((e) => {
        const text = textOf(e);
        const varNames = Object.keys(e.vars);
        return (
          <section key={e.key} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={e.enabled}
                onCheckedChange={(enabled) =>
                  update(e.key, (x) => ({ ...x, enabled }))
                }
              />
              <h2 className="font-bold">{e.label}</h2>
              <span className="font-mono text-muted-foreground text-xs">
                {e.key}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => send([text])}
              >
                試し投稿
              </Button>
            </div>

            <Textarea
              rows={2}
              className="font-mono"
              value={e.template}
              onChange={(x) =>
                update(e.key, (y) => ({ ...y, template: x.target.value }))
              }
            />

            {varNames.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {varNames.map((name) => (
                  <div key={name} className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      className="shrink-0 rounded bg-muted px-1.5 font-mono text-xs hover:bg-muted-foreground/20"
                      title="文面の末尾に足す"
                      onClick={() =>
                        update(e.key, (y) => ({
                          ...y,
                          template: `${y.template}{${name}}`,
                        }))
                      }
                    >
                      {`{${name}}`}
                    </button>
                    <Input
                      className="h-8"
                      value={e.vars[name]}
                      onChange={(x) =>
                        update(e.key, (y) => ({
                          ...y,
                          vars: { ...y.vars, [name]: x.target.value },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {e.conditions.map((c, i) => {
                const set = (patch: Partial<Condition>) =>
                  update(e.key, (y) => ({
                    ...y,
                    conditions: y.conditions.map((cc, j) =>
                      j === i ? { ...cc, ...patch } : cc,
                    ),
                  }));
                return (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span
                      className={
                        match(c, e.vars) ? "text-green-600" : "text-red-600"
                      }
                    >
                      ●
                    </span>
                    <select
                      className="h-8 rounded border px-2"
                      value={c.var}
                      onChange={(x) => set({ var: x.target.value })}
                    >
                      {varNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-8 rounded border px-2"
                      value={c.op}
                      onChange={(x) => set({ op: x.target.value as Op })}
                    >
                      {ops.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {!ops.find((o) => o.value === c.op)?.noValue && (
                      <Input
                        className="h-8 w-40"
                        value={c.value}
                        onChange={(x) => set({ value: x.target.value })}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        update(e.key, (y) => ({
                          ...y,
                          conditions: y.conditions.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
              {varNames.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update(e.key, (y) => ({
                      ...y,
                      conditions: [
                        ...y.conditions,
                        {
                          id: crypto.randomUUID(),
                          var: varNames[0],
                          op: "eq",
                          value: "",
                        },
                      ],
                    }))
                  }
                >
                  ＋ 条件（すべて満たしたときだけ送る）
                </Button>
              )}
            </div>

            <div className="whitespace-pre-wrap rounded bg-muted px-3 py-2 text-sm">
              {text || (
                <span className="text-muted-foreground">（送らない）</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
