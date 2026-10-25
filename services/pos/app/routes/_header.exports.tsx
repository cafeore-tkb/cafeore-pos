import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";
import { DownloadButton } from "~/components/organisms/DownloadData";
import { DownloadMasterStates } from "~/components/organisms/DownloadMasterStates";
import { MasterDataExport } from "~/components/organisms/products/MasterDataExport";
import { DownloadCaosLogs } from "~/components/organisms/top/DownloadCaosLogs";

export const meta: MetaFunction = () => [
  { title: "各種データ書き出し / 珈琲・俺POS" },
];

export default function ExportsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 font-noto">
      <AdminPageHeader
        group="exports"
        title="各種データ書き出し"
        description="必要なデータを選んでダウンロードしてください。"
      />
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-bold text-xl">オーダーデータ</h2>
        <p className="text-muted-foreground text-sm">
          全注文を JSON / CSV でダウンロードします。
        </p>
        <DownloadButton />
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-bold text-xl">商品マスタ</h2>
        <p className="text-muted-foreground text-sm">
          メニュー・構成アイテム・タイプ・背景色・在庫の設定を書き出します。
        </p>
        <MasterDataExport />
        <Link
          to="/products?tab=master-data"
          className="inline-block text-sm underline"
        >
          商品管理で取り込み・書き出し
        </Link>
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-bold text-xl">オーダーストップ記録</h2>
        <p className="text-muted-foreground text-sm">
          オーダーストップ・再開の全記録を JSON / CSV でダウンロードします。
        </p>
        <DownloadMasterStates />
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-bold text-xl">CaOS 操作ログ</h2>
        <p className="text-muted-foreground text-sm">
          人間の操作・システムの処理・両方を選んでJSONに保存します。
        </p>
        <DownloadCaosLogs />
      </section>
    </main>
  );
}
