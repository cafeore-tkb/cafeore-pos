import { useEffect, useState } from "react";
import {
  COMPARISON_STORAGE_KEY,
  type ComparisonSettings,
  comparisonSettingsSchema,
  emptyComparisonSettings,
} from "~/lib/analytics/yearComparison";

export function useYearComparisonSettings() {
  const [settings, setSettings] = useState(emptyComparisonSettings);
  const [storageMessage, setStorageMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const value = localStorage.getItem(COMPARISON_STORAGE_KEY);
        setSettings(
          value
            ? comparisonSettingsSchema.parse(JSON.parse(value))
            : emptyComparisonSettings(),
        );
        setStorageMessage("");
      } catch {
        setStorageMessage(
          "保存設定を読み込めません。この画面では変更できますが、保存されている設定を確認してください。",
        );
      }
      setLoaded(true);
    };
    read();
    const onStorage = (event: StorageEvent) => {
      if (event.key === COMPARISON_STORAGE_KEY || event.key === null) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const update = (next: ComparisonSettings) => {
    const checked = comparisonSettingsSchema.parse(next);
    setSettings(checked);
    try {
      localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(checked));
      setStorageMessage("");
    } catch {
      setStorageMessage(
        "ブラウザに保存できませんでした。変更はこの画面だけに反映されています。",
      );
    }
  };
  return { settings, update, loaded, storageMessage };
}
