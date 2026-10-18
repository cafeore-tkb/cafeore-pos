import { apiClient, jstClock } from "@cafeore/common";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "~/components/ui/button";
import {
  type ClientEntry,
  type OperationEvidence,
  evidenceRows,
  logArchiveSchema,
  reviewEvidence,
} from "~/lib/analytics/evidence";

const EVENT_NAMES: Record<string, string> = {
  "order.created": "受注確定",
  "order.status.changed": "準備・提供の状態変更",
  "comment.created": "業務コメントを保存",
  "lanes.change": "担当者交代",
  "lanes.swap": "担当者の入替",
  "lanes.seniors": "担当者属性の更新",
  "emergency.add": "入れ直しを追加",
  "emergency.cancel": "入れ直しを取消",
  "cups.update": "割当・移動・統合",
  "bay.next": "抽出完了・次の抽出へ",
  "operation.rejected": "操作が拒否されました",
  "outbox.error": "操作を送信できませんでした",
  "outbox.rejected": "送信した操作が拒否されました",
};
const eventName = (event: string) =>
  EVENT_NAMES[event] ??
  (event.startsWith("comment.")
    ? "コメントの操作記録"
    : event.startsWith("inventory.")
      ? "棚卸し・入荷の記録"
      : event.startsWith("emergency.")
        ? "入れ直しの操作記録"
        : "業務の操作記録");

const getEntries = async () => {
  const { data, error } = await apiClient.GET("/api/caos/logs", {
    params: { query: { limit: 500, offset: 0 } },
  });
  if (error || !data) throw new Error("操作ログを取得できませんでした。");
  return data;
};
export function LogReview({ start, end }: { start: number; end: number }) {
  const { data, error, isLoading, mutate } = useSWR(
    "analytics-log-review",
    getEntries,
    { refreshInterval: 30_000 },
  );
  const [archive, setArchive] = useState<{
    entries: ClientEntry[];
    operations: OperationEvidence[];
  }>();
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const rows = reviewEvidence(
    evidenceRows(
      [...(data?.entries ?? []), ...(archive?.entries ?? [])],
      archive?.operations ?? [],
      start,
      end,
    ),
  );
  const loadServer = async () => {
    setLoading(true);
    setFailure("");
    try {
      const { data, error } = await apiClient.GET("/api/caos/logs/export");
      if (error || !data)
        throw new Error("サーバーの成功履歴を取得できませんでした。");
      setArchive(logArchiveSchema.parse(data));
    } catch {
      setFailure(
        "成功履歴を取得できませんでした。ログの保存JSONを読み込むか、再取得してください。",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="space-y-3">
      <h3 className="font-bold">業務連絡と操作の証拠</h3>
      <p className="text-muted-foreground text-sm">
        端末のクリックは成功や個人の貢献度とは扱いません。書き手は役割、ページは操作画面であり、個人の本人確認ではありません。記録のある事例を引き継ぎ・振り返りに使ってください。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void mutate()}>
          最新ログを再取得
        </Button>
        <Button
          variant="outline"
          onClick={() => void loadServer()}
          disabled={loading}
        >
          {loading ? "取得中…" : "サーバー成功履歴を取得"}
        </Button>
        <label className="text-sm">
          保存したログJSON
          <input
            type="file"
            className="ml-2 max-w-60"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setArchive(
                  logArchiveSchema.parse(JSON.parse(await file.text())),
                );
                setFailure("");
              } catch {
                setFailure(
                  "ログ形式が不正です。entries / operationsを含む保存JSONを選んでください。",
                );
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="text-xs">
        {isLoading
          ? "最新ログ取得中…"
          : "最新の端末ログは最大500件・30秒ごとに更新。全期間の件数ではありません。"}{" "}
        {data?.hasMore &&
          "続きのログがあります。全成功履歴は上のボタンで取得してください。"}{" "}
        {archive && `読み込んだ成功履歴 ${archive.operations.length}件。`}
      </p>
      {(error || failure) && (
        <p role="alert" className="text-red-700">
          {failure || "端末ログを取得できません。再取得できます。"}
        </p>
      )}
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {rows.slice(0, 200).map((row) => (
          <details key={row.key} className="rounded-md border p-2 text-sm">
            <summary className="cursor-pointer">
              {jstClock(row.at)} ·{" "}
              {row.source === "server" ? "サーバー成功" : "端末観測"} ·{" "}
              {eventName(row.event)}
              {typeof row.details.orderNo === "number" &&
                ` · #${String(row.details.orderNo).padStart(3, "0")}`}
              <span className="ml-2 text-muted-foreground">{row.page}</span>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
              {JSON.stringify({ event: row.event, ...row.details }, null, 2)}
            </pre>
          </details>
        ))}
        {!rows.length && (
          <p className="text-muted-foreground text-sm">
            選択した期間に取得済みの業務結果・連絡ログはありません。未取得と操作ゼロは区別してください。
          </p>
        )}
      </div>
      {rows.length > 200 && (
        <p className="text-xs">
          取得した{rows.length}件のうち最新200件を表示しています。
        </p>
      )}
    </section>
  );
}
