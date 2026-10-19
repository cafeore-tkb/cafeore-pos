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
  "order.created": "注文を受付",
  "order.status.changed": "できあがり・お渡しを変更",
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
      const { data, error } = await apiClient.GET("/api/caos/logs/export", {
        params: { query: { format: "raw" } },
      });
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
      <h3 className="font-bold">何があったかを振り返る</h3>
      <p className="text-muted-foreground text-sm">
        操作と結果の記録です。個人の成績ではありません。「端末で記録」は、処理が完了した証明とは限りません。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void mutate()}>
          最新の記録に更新
        </Button>
        <Button
          variant="outline"
          onClick={() => void loadServer()}
          disabled={loading}
        >
          {loading ? "取得中…" : "完了した操作を取得"}
        </Button>
        <label className="text-sm">
          保存した記録を開く
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
          ? "記録を読み込み中…"
          : "端末の記録は最新500件・30秒ごとに更新。"}{" "}
        {data?.hasMore && "続きは「完了した操作を取得」で確認できます。"}{" "}
        {archive && `読み込んだ完了記録 ${archive.operations.length}件。`}
      </p>
      {(error || failure) && (
        <p role="alert" className="text-red-700">
          {failure || "端末ログを取得できません。再取得できます。"}
        </p>
      )}
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {rows.slice(0, 200).map((row) => (
          <details
            key={row.key}
            className="border-stone-200 border-b py-3 text-sm"
          >
            <summary className="cursor-pointer">
              {jstClock(row.at)} ·{" "}
              {row.source === "server" ? "完了を確認" : "端末で記録"} ·{" "}
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
            この期間の記録はまだありません。未取得の記録がある場合もあります。
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
