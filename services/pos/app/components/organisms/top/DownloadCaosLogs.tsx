import { apiClient, apiErrorReason } from "@cafeore/common";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";

export function DownloadCaosLogs() {
  const [format, setFormat] = useState<"human" | "system" | "mixed">("human");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data, error, response } = await apiClient.GET(
        "/api/caos/logs/export",
        { parseAs: "blob", params: { query: { format } } },
      );
      if (!response.ok || !data)
        throw new Error(apiErrorReason(response, error));
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `caos-logs-${format}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      // ブラウザがダウンロードを開始してから解放する。
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error("ログを保存できませんでした", {
        description:
          error instanceof Error ? error.message : "もう一度お試しください",
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        ログの種類
        <select
          aria-label="ログの種類"
          disabled={saving}
          value={format}
          onChange={(event) => setFormat(event.target.value as typeof format)}
          className="rounded-md border bg-background px-3 py-2"
        >
          <option value="human">人間のみ</option>
          <option value="system">システムのみ</option>
          <option value="mixed">混合</option>
        </select>
      </label>
      <Button type="button" onClick={() => void save()} disabled={saving}>
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {saving ? "ログを取得中…" : "ログを保存"}
      </Button>
    </div>
  );
}
