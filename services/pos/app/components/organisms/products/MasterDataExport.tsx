import {
  MASTER_TABLES,
  MASTER_TABLE_LABELS,
  type MasterTable,
  fetchMasterSnapshot,
  snapshotToTables,
  tablesToCsv,
} from "@cafeore/common";
import { useState } from "react";
import { Button } from "~/components/ui/button";

const getTimestamp = (): string => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

export function MasterDataExport() {
  const [exportError, setExportError] = useState<string | null>(null);

  const download = async (format: "json" | MasterTable) => {
    setExportError(null);
    let tables: ReturnType<typeof snapshotToTables>;
    try {
      tables = snapshotToTables(await fetchMasterSnapshot());
    } catch (e) {
      setExportError(errorText(e, "書き出しに失敗しました"));
      return;
    }
    if (format === "json") {
      downloadBlob(
        new Blob([JSON.stringify(tables, null, 2)], {
          type: "application/json",
        }),
        `master-${getTimestamp()}.json`,
      );
      return;
    }
    // 取り込みはファイル名の先頭で表を決めるので、表の名前で始める
    downloadBlob(
      new Blob([tablesToCsv(tables)[format]], {
        type: "text/csv;charset=utf-8;",
      }),
      `${format}-${getTimestamp()}.csv`,
    );
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-bold text-xl">書き出し</h2>
      <p className="text-muted-foreground text-sm">
        今の内容を、取り込みと同じ形で書き出します。別の環境に持っていくときや、ひな形に使えます。
        取り込みは作成のみなので、同じ環境にそのまま戻すと重複のエラーになります。
      </p>
      <div className="flex flex-wrap gap-2">
        {MASTER_TABLES.map((table) => (
          <Button
            key={table}
            type="button"
            variant="outline"
            onClick={() => download(table)}
          >
            {MASTER_TABLE_LABELS[table]} CSV
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => download("json")}
        >
          まとめて JSON
        </Button>
      </div>
      {exportError && <p className="text-destructive">{exportError}</p>}
    </section>
  );
}
