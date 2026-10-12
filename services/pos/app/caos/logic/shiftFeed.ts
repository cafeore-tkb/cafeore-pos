import type { ShiftFeed } from "@cafeore/common";

// sohosai-shift の予定（hooks/useShiftFeed）の読み込みの様子を、交代の画面と合言葉の設定に出す文にする。

/** 読み込みの様子（useShiftFeed の値のうち使うもの） */
export interface ShiftFeedProgress {
  feedKey: string;
  feed: ShiftFeed | null;
  loading: boolean;
  error: string | null;
}

/** 読み込みの様子の区分。ok は読めた、error は読めなかった、none は合言葉が無い・読んでいる途中 */
export type ShiftFeedTone = "ok" | "error" | "none";

/** 合言葉の設定に出す、読み込みの様子 */
export const shiftFeedStatus = ({
  feedKey,
  feed,
  loading,
  error,
}: ShiftFeedProgress): { tone: ShiftFeedTone; text: string } => {
  if (!feedKey)
    return {
      tone: "none",
      text: "合言葉を入れていません（名前の候補は出ません）",
    };
  if (loading && !feed) return { tone: "none", text: "読んでいます…" };
  if (error && feed)
    return {
      tone: "error",
      text: `読み直せません：${error}（前に読んだ予定を使っています）`,
    };
  if (error) return { tone: "error", text: `読めません：${error}` };
  if (feed) return { tone: "ok", text: "読めました" };
  return { tone: "none", text: "まだ読んでいません" };
};

/** 交代の画面で、名前の候補が無いときに出す理由 */
export const noCandidateReason = ({
  feedKey,
  feed,
  loading,
  error,
}: ShiftFeedProgress) => {
  if (!feedKey)
    return "この端末に sohosai-shift の合言葉が入っていないので、候補は出ません（名前を入れて交代できます）";
  if (feed) return "今の枠・次の枠・オペ練に、この番目の人がいません";
  if (loading) return "予定を読んでいます…";
  return `予定を読めません${error ? `：${error}` : ""}`;
};

/** 見出しの「交代」ですぐ替える次の人（@cafeore/common の nextLaneCandidate）がいないときの理由 */
export const noNextReason = (
  progress: ShiftFeedProgress,
  next: "already-in" | null,
) =>
  next === "already-in"
    ? "予定の人がもう入っています"
    : noCandidateReason(progress);

/** 入れた名前が上級生か（名簿が無ければそう書く） */
export const typedSeniorNote = (senior: boolean, feed: ShiftFeed | null) => {
  if (senior) return "上級生です（上級生のみのカードを淹れられます）";
  if (feed)
    return "sohosai-shift の上級生の名簿にありません（上級生のみのカードを淹れられません）";
  return "上級生の名簿が無いので、上級生のみのカードを淹れられない人として扱います";
};
