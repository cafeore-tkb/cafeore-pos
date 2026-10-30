import { dataResetRepository } from "@cafeore/common";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { adminPageAccess } from "~/components/functional/adminPageAccess";
import {
  SHOULD_FETCH_PERMISSION,
  usePermission,
} from "~/components/functional/usePermission";
import { Button } from "~/components/ui/button";
import { saveBlob } from "~/lib/saveBlob";

/**
 * 営業中に溜まる表（注文・CaOS の記録・Square の決済・在庫の記録など）を全部 JSON で保存する。
 * データのリセットの前に取るバックアップと同じもの（GET /api/admin/data-reset/backup）。管理者だけが使える
 */
export function DownloadOperationalBackup() {
  const permission = usePermission({
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const access = adminPageAccess({
    shouldFetch: SHOULD_FETCH_PERMISSION,
    permission: permission.data,
    error: permission.error,
  });

  if (access === "checking") {
    return (
      <p className="flex items-center text-muted-foreground text-sm">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        権限を確認中…
      </p>
    );
  }
  if (access === "error" || access === "expired") {
    return (
      <p className="text-muted-foreground text-sm">
        {access === "error"
          ? "権限を確認できませんでした。"
          : "ログインが切れています。"}
        ページを読み込み直してください
      </p>
    );
  }
  if (access === "deny") {
    return (
      <p className="text-muted-foreground text-sm">管理者だけが書き出せます</p>
    );
  }
  return <BackupButton />;
}

function BackupButton() {
  // 表の名前と行数は DB から読む（表を足しても書き出す側を直さなくてよい）
  const { data: status, error } = useSWR(
    "data-reset-status",
    dataResetRepository.getStatus,
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const file = await dataResetRepository.downloadBackup();
      saveBlob(file.blob, file.fileName);
    } catch (e) {
      toast.error("バックアップを保存できませんでした", {
        description: e instanceof Error ? e.message : "もう一度お試しください",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {status ? (
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {status.tables.map((table) => (
            <li
              key={table.name}
              className="rounded border bg-muted/40 px-2 py-0.5 font-mono"
            >
              {table.name}{" "}
              <span className="text-muted-foreground">
                {table.rows.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      ) : error ? (
        <p className="text-muted-foreground text-sm">
          表の一覧を読めませんでした（保存はできます）
        </p>
      ) : null}
      <Button type="button" onClick={() => void save()} disabled={saving}>
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {saving ? "書き出し中…" : "JSONファイル"}
      </Button>
    </div>
  );
}
