import type { CashierDraft } from "./cashierDraft";

/**
 * レジで押しているキー（同時押しの商品を足すため）
 *
 * 押したキー（keydown の event.key）を、離すまで event.code ごとに覚える。Shift を押したまま離すと
 * event.key が変わる（a → A）ので、離すときは event.code で探す。
 * 押しているキーで足した行も覚えておき、同時押しがそろったらその行を置き換える。
 * 行は、足したときに押していたキーのどれかを離したら忘れる
 */
export type HeldKeys = {
  /** event.code → event.key */
  keys: ReadonlyMap<string, string>;
  /** 押しているキーで足した行と、足したときに押していたキー（event.code） */
  lines: readonly { lineKey: number; codes: readonly string[] }[];
};

export const emptyHeldKeys = (): HeldKeys => ({ keys: new Map(), lines: [] });

export const pressKey = (
  held: HeldKeys,
  code: string,
  key: string,
): HeldKeys => ({ ...held, keys: new Map(held.keys).set(code, key) });

export const releaseKey = (held: HeldKeys, code: string): HeldKeys => {
  if (!held.keys.has(code)) return held;
  const keys = new Map(held.keys);
  keys.delete(code);
  return {
    keys,
    lines: held.lines.filter((line) => !line.codes.includes(code)),
  };
};

/** 押しているキー（event.key） */
export const heldKeyValues = (held: HeldKeys): string[] => [
  ...held.keys.values(),
];

/** 押しているキーで足した行（行の key） */
export const heldLineKeys = (held: HeldKeys): number[] =>
  held.lines.map((line) => line.lineKey);

/**
 * キーで下書きを変えたあと、足した行を覚える。同時押しで置き換えて消えた行と、
 * 前の下書きに無い番号の行（押したまま注文を送り、番号が 0 から振り直された）は忘れる
 */
export const rememberAddedLine = (
  held: HeldKeys,
  before: CashierDraft,
  after: CashierDraft,
): HeldKeys => {
  if (after.nextKey === before.nextKey) return held;
  const kept = held.lines.filter(
    (line) =>
      line.lineKey < before.nextKey &&
      after.lines.some(({ key }) => key === line.lineKey),
  );
  return {
    ...held,
    lines: [
      ...kept,
      { lineKey: after.nextKey - 1, codes: [...held.keys.keys()] },
    ],
  };
};
