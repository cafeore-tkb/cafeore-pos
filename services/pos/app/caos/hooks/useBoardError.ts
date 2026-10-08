import { useEffect, useState } from "react";

// 操作を断られた理由（決まりに合わない・ほかの端末が先に書いた）。画面の下に少しのあいだ出して消す
const ERROR_SHOWN_MS = 5000;

export const useBoardError = () => {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [error]);
  return [error, setError] as const;
};
