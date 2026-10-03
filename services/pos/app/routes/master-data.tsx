import {
  MASTER_COLUMNS,
  MASTER_TABLES,
  MASTER_TABLE_LABELS,
  type MasterCall,
  type MasterImportResult,
  type MasterTable,
  type ReadMasterFilesResult,
  fetchMasterSnapshot,
  planMasterImport,
  readMasterFiles,
  runMasterImport,
  snapshotToTables,
  tablesToCsv,
} from "@cafeore/common";
import { useRef, useState } from "react";
import type { MetaFunction } from "react-router";
import { ItemsPageHeader } from "~/components/organisms/itemsPageHeader";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export const meta: MetaFunction = () => {
  return [{ title: "一括取り込み・書き出し / 珈琲・俺POS" }];
};

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "problems"; problems: string[] }
  | { kind: "ready"; calls: MasterCall[] }
  | { kind: "importing"; calls: MasterCall[]; done: number }
  | { kind: "finished"; calls: MasterCall[]; result: MasterImportResult }
  | { kind: "error"; message: string };

const CALL_TABLES: MasterCall["table"][] = [
  "item_types",
  "items",
  "menus",
  "color_settings",
];

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

export default function MasterDataPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<ReadMasterFilesResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
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

  // 同じファイルを選び直しても change が来るよう、選択を外す。
  // Excel で直して同じ名前で保存し直すのが普通の流れなので。
  const clearFileInput = () => {
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setStatus({ kind: "checking" });
    // ファイルの読み込みで失敗しても checking のまま止まらないよう、全体を囲む
    try {
      const files = await Promise.all(
        Array.from(fileList).map(async (file) => ({
          name: file.name,
          bytes: await file.arrayBuffer(),
        })),
      );
      const result = readMasterFiles(files);
      setRead(result);
      if (result.problems.length > 0) {
        setStatus({ kind: "problems", problems: result.problems });
        clearFileInput();
        return;
      }
      const plan = planMasterImport(result.rows, await fetchMasterSnapshot());
      if (plan.problems.length > 0) {
        setStatus({ kind: "problems", problems: plan.problems });
        clearFileInput();
        return;
      }
      setStatus({ kind: "ready", calls: plan.calls });
    } catch (e) {
      setStatus({ kind: "error", message: errorText(e, "確認に失敗しました") });
      clearFileInput();
    }
  };

  const runImport = async (calls: MasterCall[]) => {
    setStatus({ kind: "importing", calls, done: 0 });
    const result = await runMasterImport(calls, (done) =>
      setStatus({ kind: "importing", calls, done }),
    );
    setStatus({ kind: "finished", calls, result });
    clearFileInput();
  };

  const reset = () => {
    setRead(null);
    setStatus({ kind: "idle" });
    clearFileInput();
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-4">
      <ItemsPageHeader />

      <section className="flex flex-col gap-3 px-4">
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

      <section className="flex flex-col gap-3 px-4">
        <h2 className="font-bold text-xl">取り込み</h2>
        <p className="text-muted-foreground text-sm">
          CSV（Excel の「CSV (コンマ区切り)」「CSV UTF-8」どちらでも可）か JSON
          を選んでください。複数まとめて選べます。新しく作るだけで、既にある名前（メニューはキー）はエラーになります。背景色は既存のアイテムにも付けられます。
        </p>
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            ファイルの書き方
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>
              CSV は表ごとに1ファイルで、ファイル名を表の名前で始めます（
              <code>items.csv</code> など）。1行目は見出しです。JSON
              は表の名前をキーにした行の配列です。
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {MASTER_TABLES.map((table) => (
                <li key={table}>
                  {MASTER_TABLE_LABELS[table]}（<code>{table}</code>）:{" "}
                  <code>{MASTER_COLUMNS[table].join(",")}</code>
                </li>
              ))}
            </ul>
            <p>
              <code>item_type</code>・<code>item</code>・<code>target</code>{" "}
              は名前、<code>menu</code> はメニューの <code>key</code>{" "}
              で書きます。メニューの構成は <code>menu_items</code>{" "}
              に1行ずつ書き、同じファイルで作るメニューにだけ付けられます。
            </p>
            <p>
              値の決まり（必須の列、数値の範囲、色の形など）は API
              と同じものを使って、送る前に確かめます。
            </p>
          </div>
        </details>

        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".csv,.json,text/csv,application/json"
          className="file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
          disabled={status.kind === "checking" || status.kind === "importing"}
          onChange={(event) => handleFiles(event.target.files)}
        />

        {read && read.files.length > 0 && (
          <ul className="text-sm">
            {read.files.map((file) => (
              <li key={file.name}>
                {file.name} →{" "}
                {file.tables
                  .map(
                    ({ table, rows }) =>
                      `${MASTER_TABLE_LABELS[table]} ${rows}件`,
                  )
                  .join("、")}
              </li>
            ))}
          </ul>
        )}

        {status.kind === "checking" && <p>確認中...</p>}

        {status.kind === "problems" && (
          <div className="rounded-md border border-destructive p-3">
            <p className="font-medium text-destructive">
              取り込めない行が {status.problems.length}{" "}
              件あります。直してから選び直してください（何も送っていません）。
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {status.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        {status.kind === "error" && (
          <p className="text-destructive">エラー: {status.message}</p>
        )}

        {status.kind === "ready" && (
          <div className="flex flex-col gap-3">
            <p className="font-medium">
              {status.calls.length === 0
                ? "取り込むものがありません。"
                : "この内容で登録します。よければ「登録する」を押してください。"}
            </p>
            <CallTable calls={status.calls} />
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={status.calls.length === 0}
                onClick={() => runImport(status.calls)}
              >
                登録する
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                やめる
              </Button>
            </div>
          </div>
        )}

        {status.kind === "importing" && (
          <p>
            登録中... {status.done} / {status.calls.length}
          </p>
        )}

        {status.kind === "finished" && (
          <div className="flex flex-col gap-3">
            {status.result.failed ? (
              <div className="rounded-md border border-destructive p-3">
                <p className="font-medium text-destructive">
                  {status.result.done + 1} 件目の
                  {MASTER_TABLE_LABELS[status.result.failed.call.table]}「
                  {status.result.failed.call.label}
                  」で失敗したので止めました: {status.result.failed.message}
                </p>
                <p className="mt-1 text-sm">
                  それより前の {status.result.done}{" "}
                  件は登録済みです。直して取り込み直すときは、登録済みの行をファイルから外してください。
                </p>
              </div>
            ) : (
              <p className="font-medium">
                {status.result.done} 件登録しました。
              </p>
            )}
            <CallTable
              calls={status.calls.slice(0, status.result.done)}
              title="登録済み"
            />
            <div>
              <Button type="button" variant="outline" onClick={reset}>
                続けて取り込む
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function CallTable({
  calls,
  title = "件数",
}: {
  calls: MasterCall[];
  title?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-right">{title}</TableHead>
          <TableHead>内容</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {CALL_TABLES.map((table) => {
          const rows = calls.filter((call) => call.table === table);
          return (
            <TableRow key={table}>
              <TableCell className="font-medium">
                {MASTER_TABLE_LABELS[table]}
              </TableCell>
              <TableCell className="text-right">{rows.length}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {rows.map((call) => call.label).join("、")}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
