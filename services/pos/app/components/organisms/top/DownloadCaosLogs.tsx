import { apiClient, apiErrorReason } from "@cafeore/common";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";

export function DownloadCaosLogs() {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data, error, response } = await apiClient.GET(
        "/api/caos/logs/export",
        { parseAs: "blob" },
      );
      if (!response.ok || !data)
        throw new Error(apiErrorReason(response, error));
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `caos-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
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
    <Button type="button" onClick={() => void save()} disabled={saving}>
      {saving ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {saving ? "ログを取得中…" : "ログを保存"}
    </Button>
  );
}
