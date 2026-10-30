import { useCallback, useEffect, useRef, useState } from "react";
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
  const [saveBlocked, setSaveBlocked] = useState(true);
  // storageイベント直後、再描画前の古いコールバックからも保存させない。
  const saveAllowedRef = useRef(false);
  const defaultsEligibleRef = useRef(false);
  const initialReadRef = useRef(true);
  useEffect(() => {
    const read = () => {
      saveAllowedRef.current = false;
      try {
        const value = localStorage.getItem(COMPARISON_STORAGE_KEY);
        setSettings(
          value === null
            ? emptyComparisonSettings()
            : comparisonSettingsSchema.parse(JSON.parse(value)),
        );
        if (initialReadRef.current)
          defaultsEligibleRef.current = value === null;
        saveAllowedRef.current = true;
        setSaveBlocked(false);
        setStorageMessage("");
      } catch {
        setSettings(emptyComparisonSettings());
        setSaveBlocked(true);
        setStorageMessage(
          "保存設定を読み込めないため、比較設定の編集・自動保存を停止しています。保存済みデータは変更していません。",
        );
      }
      initialReadRef.current = false;
      setLoaded(true);
    };
    read();
    const onStorage = (event: StorageEvent) => {
      if (event.key === COMPARISON_STORAGE_KEY || event.key === null) {
        defaultsEligibleRef.current = false;
        read();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const update = useCallback((next: ComparisonSettings) => {
    if (!saveAllowedRef.current) return;
    defaultsEligibleRef.current = false;
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
  }, []);
  const initializeDefaults = useCallback(
    (next: ComparisonSettings) => {
      if (!saveAllowedRef.current || !defaultsEligibleRef.current) return;
      defaultsEligibleRef.current = false;
      // 別タブが先に保存した値や、読めない保存値を初期値で上書きしない。
      try {
        if (localStorage.getItem(COMPARISON_STORAGE_KEY) !== null) return;
      } catch {
        return;
      }
      update(next);
    },
    [update],
  );
  return {
    settings,
    update,
    initializeDefaults,
    loaded,
    saveBlocked,
    storageMessage,
  };
}
