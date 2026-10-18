import { z } from "zod";

const details = z.record(z.unknown());
const clientEntry = z.object({
  tabId: z.string(),
  sequence: z.number(),
  at: z.string().datetime({ offset: true }),
  event: z.string(),
  details,
});
const operation = z.object({
  id: z.string(),
  kind: z.string(),
  occurred_at: z.string().datetime({ offset: true }),
  details: details.optional(),
});
export const logArchiveSchema = z.object({
  entries: z.array(clientEntry),
  operations: z.array(operation).default([]),
});
export type ClientEntry = z.infer<typeof clientEntry>;
export type OperationEvidence = z.infer<typeof operation>;
export interface EvidenceRow {
  key: string;
  at: number;
  event: string;
  source: "server" | "client";
  page: string;
  details: Record<string, unknown>;
}
/** 再送・複数ファイルで重複した記録を同一キーで除く。クリックを業務成功に昇格させない。 */
export const evidenceRows = (
  entries: ClientEntry[],
  operations: OperationEvidence[],
  start: number,
  end: number,
) => {
  const rows: EvidenceRow[] = [
    ...entries.map(
      (entry): EvidenceRow => ({
        key: `client:${entry.tabId}:${entry.sequence}`,
        at: Date.parse(entry.at),
        event: entry.event,
        source: "client",
        page:
          typeof entry.details.page === "string"
            ? entry.details.page
            : "記録なし",
        details: entry.details,
      }),
    ),
    ...operations.map(
      (entry): EvidenceRow => ({
        key: `server:${entry.id}`,
        at: Date.parse(entry.occurred_at),
        event: entry.kind,
        source: "server",
        page: "サーバー成功履歴",
        details: entry.details ?? {},
      }),
    ),
  ];
  return [...new Map(rows.map((row) => [row.key, row])).values()]
    .filter(
      (row) =>
        row.at >= start &&
        row.at < end &&
        row.details.mode !== "practice" &&
        !row.event.startsWith("practice."),
    )
    .sort((a, b) => b.at - a.at);
};

/** 生のDOMイベント数を貢献度にしない。振り返れる業務結果・連絡・失敗だけを抽出。 */
export const reviewEvidence = (rows: EvidenceRow[]) =>
  rows.filter(
    (row) =>
      row.source === "server" ||
      /comment\.|inventory\.|emergency\.|outbox\.(rejected|error)|operation\.rejected/.test(
        row.event,
      ),
  );
