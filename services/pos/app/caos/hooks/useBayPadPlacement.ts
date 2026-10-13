import { useLayoutEffect, useRef, useState } from "react";

// 1〜6 のボタン（OrderCard の BayPad）の 2 段の置き場所。段の高さと、カードの縁・段どうしの間を空けて、カードの上の縁・下の縁から並べる。
// ふだんは上に前半・下に後半。片方の段が押せないとき（ヘッダー・帯・ほかのカードの下になる、枠やスクロールバーで切れる）は
// 両方を下、それでも押せなければ両方を上に寄せる。どれも押せないボタンが残るなら、いちばん多く押せる置き場所にする
const ROW_PX = 34;
const STEP_PX = ROW_PX + 4;
const PLACEMENTS = [
  [{ top: -STEP_PX }, { bottom: -STEP_PX }],
  [{ bottom: -STEP_PX }, { bottom: -2 * STEP_PX }],
  [{ top: -2 * STEP_PX }, { top: -STEP_PX }],
].map((rows) => rows.map((row) => ({ ...row, height: ROW_PX })));

// ボタンが押せるか：上下の端の近くを指したときに、そのボタンに当たる（ほかのものの下・枠や画面の外なら当たらない）
const pressable = (button: Element) => {
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  return [rect.top + 4, rect.bottom - 4].every((y) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && button.contains(hit);
  });
};

/** 開いたときに置き場所を順に試して決める。ref は 2 段をまとめた要素、rows は段ごとの位置と高さ（style） */
export const useBayPadPlacement = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // 試した置き場所ごとの、押せるボタンの数
  const counts = useRef<number[]>([]);
  useLayoutEffect(() => {
    const buttons = Array.from(ref.current?.querySelectorAll("button") ?? []);
    const count = buttons.filter(pressable).length;
    counts.current[index] = count;
    // 全部押せればこの置き場所のまま
    if (count === buttons.length) return;
    // まだ試していない置き場所があれば次を試す
    if (counts.current.length < PLACEMENTS.length) {
      setIndex(counts.current.length);
      return;
    }
    // 全部試したら、いちばん多く押せる置き場所（今がそれなら何もしない）
    setIndex(counts.current.indexOf(Math.max(...counts.current)));
  }, [index]);
  return { ref, rows: PLACEMENTS[index] };
};
