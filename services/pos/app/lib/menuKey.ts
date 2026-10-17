/**
 * メニューのキー（レジで押すと商品を足すキー）
 *
 * キーは KeyboardEvent.key の文字（「^」「a」「F1」など）。「a+s」のように + でつなぐと、
 * そのキーを同時に押したときに足す（同時押し）。+ そのものも「+」「a++」のように使える。
 */

/** 同時押しのキーをつなぐ記号 */
const SEPARATOR = "+";

/** 修飾キー。押しても覚えない（Shift は * # などの記号を打つのに使う）ので、同時押しには使えない */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "CapsLock",
  "Fn",
]);

/**
 * レジの操作に使うキー（数字・Enter・Space・Esc・Backspace・矢印）。押した時点で操作してしまうので、
 * 同時押しには使えない（同時押しがそろったときに取り消せるのは、足した商品だけ）
 */
const REGISTER_KEYS: ReadonlySet<string> = new Set([
  ..."0123456789",
  " ",
  "Enter",
  "Escape",
  "Backspace",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export const isModifierKey = (key: string): boolean => MODIFIER_KEYS.has(key);

/**
 * キーを同時に押すキーに分ける（「a+s」は a と s）。+ で始まる部分は + そのもの。
 * つなぎ方がおかしい（空・+ で終わる）ときは null
 */
export const menuKeyParts = (key: string): string[] | null => {
  const parts: string[] = [];
  let start = 0;
  while (start < key.length) {
    const separator = key.indexOf(SEPARATOR, start);
    const end =
      key[start] === SEPARATOR
        ? start + 1
        : separator === -1
          ? key.length
          : separator;
    parts.push(key.slice(start, end));
    if (end === key.length) return parts;
    if (key[end] !== SEPARATOR) return null;
    start = end + 1;
  }
  return null;
};

/** 同時押しのキー（2 つ以上）。1 つだけ・つなぎ方がおかしいときは null */
export const menuKeyChord = (key: string): string[] | null => {
  const parts = menuKeyParts(key);
  return parts !== null && parts.length >= 2 ? parts : null;
};

/** 押す順に関わらず同じキーか（「a+s」と「s+a」は同じ） */
export const isSameMenuKey = (a: string, b: string): boolean => {
  const chordA = menuKeyChord(a);
  const chordB = menuKeyChord(b);
  if (chordA === null || chordB === null) return a === b;
  return isSameKeySet(chordA, chordB);
};

/** 押しているキーの組がちょうど同じか（同じキーが 2 つあっても 1 つと見る） */
export const isSameKeySet = (
  a: readonly string[],
  b: readonly string[],
): boolean => {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((key) => setB.has(key));
};

/** 入力したキーを整える。同時押しは + のまわりの空白を消す（「a + s」→「a+s」） */
export const normalizeMenuKey = (key: string): string =>
  key.length > 1 && key.includes(SEPARATOR)
    ? key.replace(/\s*\+\s*/g, SEPARATOR).trim()
    : key;

/** レジで使えないキーなら、その理由 */
export const menuKeyError = (key: string): string | null => {
  const parts = menuKeyParts(key);
  if (parts === null) {
    return "同時押しは「a+s」のように + でつないでください";
  }
  if (parts.length < 2) return null;
  if (new Set(parts).size !== parts.length) {
    return "同時押しに同じキーが 2 回入っています";
  }
  if (parts.some((part) => isModifierKey(part) || REGISTER_KEYS.has(part))) {
    return "数字・Enter・Space・Esc・Backspace・矢印・Shift などは同時押しに使えません";
  }
  return null;
};
