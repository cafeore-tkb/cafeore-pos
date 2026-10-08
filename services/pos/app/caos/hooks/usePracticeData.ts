import { type PracticeDataset, readPracticeTexts } from "@cafeore/common";
import { useCallback, useState } from "react";

// 実データテストのデータ。利用者が画面で選んだ手元の JSON（sohosai-analysis の day*.json など）を、
// この端末のブラウザの中で読み、名前とコメントを落としてから使う（readPracticeTexts）。
// サーバー・API にも配信にも出さず、この画面を開いている間だけ覚えておく（開き直したら選び直す）。
export const usePracticeData = () => {
  const [dataset, setDataset] = useState<PracticeDataset | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  /** 選んだファイルを読む。1 件でも読めれば、今のデータと入れ替える */
  const readFiles = useCallback(async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setLoading(true);
    try {
      const texts = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          text: await file.text(),
        })),
      );
      const result = readPracticeTexts(texts);
      setProblems(result.problems);
      if (result.data) setDataset(result.data);
    } catch {
      setProblems(["読み込めませんでした"]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setDataset(null);
    setProblems([]);
  }, []);

  return { dataset, problems, loading, readFiles, clear };
};
