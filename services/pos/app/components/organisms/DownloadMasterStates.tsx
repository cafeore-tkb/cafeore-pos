import { apiClient, apiErrorReason } from "@cafeore/common";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";

export function DownloadMasterStates() {
  const [saving, setSaving] = useState(false);
  const download = async (format: "json" | "csv") => {
    if (saving) return;
    setSaving(true);
    try {
      const { data, error, response } =
        await apiClient.GET("/api/master-status");
      if (!response.ok || !data)
        throw new Error(apiErrorReason(response, error));
      const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const content =
        format === "json"
          ? JSON.stringify(data, null, 2)
          : [
              "created_at,type",
              ...data.map((state) =>
                [state.created_at, state.type].map(csvCell).join(","),
              ),
            ].join("\r\n");
      const blob = new Blob([content], {
        type:
          format === "json" ? "application/json" : "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `order-stop-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error("オーダーストップ記録を書き出せませんでした", {
        description:
          error instanceof Error ? error.message : "もう一度お試しください",
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        disabled={saving}
        onClick={() => void download("json")}
      >
        JSONファイル
      </Button>
      <Button
        type="button"
        disabled={saving}
        onClick={() => void download("csv")}
      >
        CSVファイル
      </Button>
    </div>
  );
}
