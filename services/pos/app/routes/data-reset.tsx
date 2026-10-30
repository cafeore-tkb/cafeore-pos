import {
  type DataResetBackupFile,
  type DataResetTable,
  dataResetRepository,
} from "@cafeore/common";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import useSWR from "swr";
import { AdminOnly } from "~/components/functional/AdminOnly";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { saveBlob } from "~/lib/saveBlob";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => {
  return [{ title: "データのリセット / 珈琲・俺POS" }];
};

/** 表の名前を画面に出す名前にする。知らない表は名前のまま */
const tableLabels: Record<string, string> = {
  orders: "注文",
  order_menus: "注文の明細",
  order_cups: "注文のカップ",
  order_payments: "個別会計の支払い",
  comments: "注文のコメント",
  cup_emergencies: "緊急（淹れ直し）",
  order_stock_usages: "注文で減った在庫",
  cup_emergency_stock_usages: "淹れ直しで減った在庫",
  caos_client_logs: "CaOS の端末のログ",
  caos_operations: "CaOS の操作",
  caos_operation_cups: "CaOS の操作のカップ",
  square_checkouts: "Square の決済",
  square_actions: "Square の決済手段の選択",
  label_print_requests: "代理印刷の頼み",
  cashier_states: "レジの編集中の注文",
  master_states: "受付状態（オーダーストップ）の履歴",
  stock_events: "棚卸し・入荷の記録",
  dripper_assignees: "CaOS のドリッパーの担当者",
  dripper_assignee_changes: "担当者の交代の記録",
  item_types: "アイテムの種類",
  items: "アイテム",
  menus: "メニュー",
  menu_items: "メニューの構成",
  stock_resources: "在庫対象",
  stock_resource_item_types: "カップを使う種類",
  color_settings: "背景色",
  printer_settings: "プリンター",
  square_devices: "Square 端末",
};

const labelOf = (table: string) => tableLabels[table] ?? table;

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** ダウンロードしたバックアップ。SHA-256 をリセットのときに送る */
type Backup = Pick<DataResetBackupFile, "sha256" | "fileName"> & {
  size: number;
  at: Date;
};

// 本番では管理者だけが開ける
export default function DataResetRoute() {
  return (
    <AdminOnly>
      <DataResetPage />
    </AdminOnly>
  );
}

function DataResetPage() {
  const {
    data: status,
    error,
    mutate,
  } = useSWR("data-reset-status", dataResetRepository.getStatus, {
    // 別の端末でオーダーストップしたり、注文が入ったりするので、開いている間は読み直す
    refreshInterval: 5000,
  });
  const [backup, setBackup] = useState<Backup | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleted, setDeleted] = useState<DataResetTable[] | null>(null);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const file = await dataResetRepository.downloadBackup();
      saveBlob(file.blob, file.fileName);
      setBackup({
        sha256: file.sha256,
        fileName: file.fileName,
        size: file.blob.size,
        at: new Date(),
      });
    } catch (e) {
      toast.error("バックアップをダウンロードできませんでした", {
        description: errorText(e, "もう一度お試しください"),
      });
    } finally {
      setDownloading(false);
    }
  };

  const reset = async () => {
    if (resetting || !backup) return;
    setResetting(true);
    try {
      const tables = await dataResetRepository.reset(
        confirmation,
        backup.sha256,
      );
      setDeleted(tables);
      setBackup(null);
      setConfirmation("");
      toast.success("営業データを消しました");
    } catch (e) {
      // ダウンロードのあとにデータが変わったときは、もう一度ダウンロードしてもらう
      setBackup(null);
      toast.error("消せませんでした（何も消していません）", {
        description: errorText(e, "もう一度お試しください"),
      });
    } finally {
      setResetting(false);
      void mutate();
    }
  };

  const totalRows = status?.tables.reduce((sum, t) => sum + t.rows, 0) ?? 0;
  const stopped = status?.receptionStopped ?? false;
  const hasUnknown = (status?.unknownTables.length ?? 0) > 0;
  const confirmed =
    status !== undefined && confirmation === status.confirmation;
  const canReset =
    stopped && !hasUnknown && backup !== null && confirmed && !resetting;

  return (
    // 消すと戻せないので、ほかの設定の画面と見間違えないよう全面を赤にする。表と手順は白い面に載せる
    <div className="min-h-screen bg-red-700">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 font-noto">
        <AdminPageHeader
          group="settings"
          tone="danger"
          title="データのリセット"
          description="注文・CaOS の記録・Square の決済の記録・棚卸しと入荷の記録など、営業で溜まったデータを消します。メニュー・アイテム・在庫対象・背景色・プリンター・Square 端末の設定は残します。消したデータは元に戻せません。管理者だけが使えます（PR のプレビューでは誰でも使えます）。"
        />

        {error && (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-red-700 text-sm">
            {errorText(error, "状態を読めませんでした")}
            {errorText(error, "") === "forbidden" &&
              "（管理者だけが使えます。管理者は API の AUTH_ADMIN_EMAILS で決めます）"}
          </p>
        )}

        {deleted && (
          <section className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-4">
            <h2 className="font-bold text-green-800 text-xl">消しました</h2>
            <p className="text-green-800 text-sm">
              開いていたほかの端末（レジ・マスター・CaOS
              など）は自動で読み込み直します。営業を始める前に、在庫の棚卸しを入れ直してください。
            </p>
            <p className="text-green-800 text-sm">
              消した行:{" "}
              {deleted
                .filter((t) => t.rows > 0)
                .map((t) => `${labelOf(t.name)} ${t.rows}`)
                .join("、") || "なし"}
            </p>
          </section>
        )}

        {status && (
          <>
            {hasUnknown && (
              <p className="rounded border border-red-300 bg-red-50 p-3 text-red-700 text-sm">
                消すか残すか決めていない表があるので消せません:{" "}
                {status.unknownTables.join(", ")}
                。API のバージョンが DB より古い可能性があります。
              </p>
            )}

            <section className="space-y-3 rounded-lg bg-white p-4">
              <h2 className="font-bold text-xl">
                消すデータ（{totalRows} 行）
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>データ</TableHead>
                    <TableHead className="text-right">行数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.tables.map((table) => (
                    <TableRow key={table.name}>
                      <TableCell>
                        {labelOf(table.name)}
                        <span className="ml-2 font-mono text-muted-foreground text-xs">
                          {table.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {table.rows}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-muted-foreground text-sm">
                残すもの: {status.keptTables.map(labelOf).join("、")}
              </p>
            </section>

            <ol className="flex flex-col gap-6">
              <Step
                number={1}
                title="受付を止める"
                done={stopped}
                description="マスターの画面でオーダーストップにします。止めていないと消せません。"
              >
                <p
                  className={cn(
                    "text-sm",
                    stopped ? "text-green-700" : "text-red-700",
                  )}
                >
                  {stopped ? "受付を止めています" : "受付中です"}
                </p>
              </Step>

              <Step
                number={2}
                title="消すデータをダウンロードする"
                done={backup !== null}
                description="消すデータを全部 JSON で保存します。ダウンロードのあとにデータが 1 行でも変わると消せないので、そのときはもう一度ダウンロードしてください。"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void download()}
                    disabled={downloading}
                  >
                    {downloading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    {downloading ? "ダウンロード中…" : "ダウンロード"}
                  </Button>
                  {backup && (
                    <p className="text-sm">
                      {timeFormat.format(backup.at)} に {backup.fileName}（
                      {Math.ceil(backup.size / 1024)} KB）をダウンロードしました
                    </p>
                  )}
                </div>
              </Step>

              <Step
                number={3}
                title="確認の文字を入れる"
                done={confirmed}
                description={`「${status.confirmation}」と入力します。`}
              >
                <Input
                  aria-label="確認の文字"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder={status.confirmation}
                  className="max-w-xs"
                  autoComplete="off"
                />
              </Step>
            </ol>

            <div className="flex flex-col items-start gap-2">
              <Button
                type="button"
                // 赤い地に載せるので、白い面に赤い文字にする
                className="bg-white text-red-700 hover:bg-red-50"
                onClick={() => void reset()}
                disabled={!canReset}
              >
                {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                営業データを消す
              </Button>
              <p className="text-red-50 text-xs">
                消すと、開いているほかの端末は自動で読み込み直します。
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Step({
  number,
  title,
  done,
  description,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <li className="space-y-2 rounded-lg bg-white p-4">
      <h3 className="flex items-center font-bold text-lg">
        <span
          className={cn(
            "mr-2 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-sm text-white",
            done ? "bg-green-600" : "bg-stone-400",
          )}
        >
          {done ? "✓" : number}
        </span>
        {title}
      </h3>
      <p className="text-muted-foreground text-sm">{description}</p>
      {children}
    </li>
  );
}
