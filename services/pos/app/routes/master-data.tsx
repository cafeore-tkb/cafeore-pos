import {
  MASTER_TABLE_LABELS,
  type MasterData,
  MasterImportError,
  type MasterImportResult,
  type MasterTable,
  type ParsedMasterFiles,
  exportMasterData,
  importMasterData,
  masterDataToCsv,
  parseMasterFiles,
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

const TABLES: MasterTable[] = ["item_types", "items", "menus"];

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "problems"; problems: string[] }
  | { kind: "ready"; preview: MasterImportResult }
  | { kind: "importing"; preview: MasterImportResult }
  | { kind: "done"; result: MasterImportResult }
  | { kind: "error"; message: string };

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

export default function MasterDataPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedMasterFiles | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [exportError, setExportError] = useState<string | null>(null);

  const download = async (format: "json" | MasterTable) => {
    setExportError(null);
    let data: MasterData;
    try {
      data = await exportMasterData();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "書き出しに失敗しました");
      return;
    }
    if (format === "json") {
      downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
        `master-${getTimestamp()}.json`,
      );
      return;
    }
    downloadBlob(
      new Blob([masterDataToCsv(data)[format]], {
        type: "text/csv;charset=utf-8;",
      }),
      `${format}-${getTimestamp()}.csv`,
    );
  };

  // 同じファイルを選び直しても change が来るよう、失敗したら選択を外す。
  // Excel で直して同じ名前で保存し直すのが普通の流れなので。
  const clearFileInput = () => {
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = await Promise.all(
      Array.from(fileList).map(async (file) => ({
        name: file.name,
        bytes: await file.arrayBuffer(),
      })),
    );
    const result = parseMasterFiles(files);
    setParsed(result);
    if (result.problems.length > 0) {
      setStatus({ kind: "problems", problems: result.problems });
      clearFileInput();
      return;
    }
    await runImport(result.data, true);
  };

  // dryRun で中身を確かめてから、同じデータで本番の取り込みをする
  const runImport = async (data: MasterData, dryRun: boolean) => {
    setStatus((prev) =>
      !dryRun && prev.kind === "ready"
        ? { kind: "importing", preview: prev.preview }
        : { kind: "checking" },
    );
    try {
      const result = await importMasterData(data, { dryRun });
      setStatus(
        dryRun ? { kind: "ready", preview: result } : { kind: "done", result },
      );
    } catch (e) {
      clearFileInput();
      if (e instanceof MasterImportError) {
        setStatus({ kind: "problems", problems: e.problems });
        return;
      }
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "取り込みに失敗しました",
      });
    }
  };

  const reset = () => {
    setParsed(null);
    setStatus({ kind: "idle" });
    clearFileInput();
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-4">
      <ItemsPageHeader />

      <section className="flex flex-col gap-3 px-4">
        <h2 className="font-bold text-xl">書き出し</h2>
        <p className="text-muted-foreground text-sm">
          今の内容を書き出します。Excel
          で直して、そのまま下の取り込みに使えます（空の表は見出しだけのテンプレートになります）。
        </p>
        <div className="flex flex-wrap gap-2">
          {TABLES.map((table) => (
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
          を選んでください。複数まとめて選べます。アイテムタイプとアイテムは
          name、メニューは key
          が同じ行を更新し、無ければ作ります。ファイルに無いものは消しません。
        </p>
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">CSV の書き方</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>
              1行目は見出しです。どの表かは見出しで判定するので、ファイル名は自由です。
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                アイテムタイプ: <code>name,display_name</code>
              </li>
              <li>
                アイテム: <code>name,abbr,item_type</code>（item_type
                はアイテムタイプの name）
              </li>
              <li>
                メニュー: <code>key,name,abbr,price,items</code>
                （items はアイテムの name を <code>;</code> 区切り。数量は{" "}
                <code>ミルク*2</code> のように書く）
              </li>
            </ul>
            <p>
              アイテムタイプとアイテムには、背景色の列 <code>master_color</code>
              （マスター画面）・<code>serve_color</code>（提供画面）を足せます。
              <code>#f74316</code>{" "}
              の形で書き、空にすると色を外します。列ごと無ければ色は変えません。
            </p>
            <p>
              見出しは日本語（名前・表示名・略称・タイプ・キー・価格・アイテム・マスター色・提供色）でも読めます。
            </p>
          </div>
        </details>

        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".csv,.json,text/csv,application/json"
          className="file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
          onChange={(event) => handleFiles(event.target.files)}
        />

        {parsed && parsed.files.length > 0 && (
          <ul className="text-sm">
            {parsed.files.map((file) => (
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
              件あります。直してから選び直してください（何も書き込んでいません）。
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

        {(status.kind === "ready" ||
          status.kind === "importing" ||
          status.kind === "done") && (
          <div className="flex flex-col gap-3">
            <p className="font-medium">
              {status.kind === "done"
                ? "取り込みました。"
                : "この内容で取り込みます。よければ「取り込む」を押してください。"}
            </p>
            <ResultTable
              result={status.kind === "done" ? status.result : status.preview}
            />
            <div className="flex gap-2">
              {status.kind !== "done" && parsed && (
                <Button
                  type="button"
                  disabled={status.kind === "importing"}
                  onClick={() => runImport(parsed.data, false)}
                >
                  {status.kind === "importing" ? "取り込み中..." : "取り込む"}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={reset}>
                {status.kind === "done" ? "続けて取り込む" : "やめる"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ResultTable({ result }: { result: MasterImportResult }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-right">新規</TableHead>
          <TableHead className="text-right">更新</TableHead>
          <TableHead className="text-right">変更なし</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {TABLES.map((table) => (
          <TableRow key={table}>
            <TableCell className="font-medium">
              {MASTER_TABLE_LABELS[table]}
            </TableCell>
            <TableCell className="text-right">
              {result[table].created}
            </TableCell>
            <TableCell className="text-right">
              {result[table].updated}
            </TableCell>
            <TableCell className="text-right">
              {result[table].unchanged}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
