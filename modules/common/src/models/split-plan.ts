import type { MenuEntity } from "./menu";

/**
 * 注文の明細を並べる順（レジが送る注文の明細を、この順に並べ替える。注文番号は分けない）
 *
 * 1 人の注文を注文番号ごとに分けていたときの組み合わせ方で明細を組み、組んだ順に並べる。以下の「番号」は
 * その組（並べる順の区切り）のこと。
 * 1 つの番号には、同じ商品の 2 杯か 1 杯を 2 つまで入れる（ドリッパー 2 人分）。番号をいちばん少なくし、
 * その中で同じ番号のコーヒーが同時に出せるようにする（抽出は 1 杯 300 秒・2 杯 360 秒）。指名は考えない。
 *   1. 同じ商品を 2 杯ずつまとめる。余った 1 杯は 1 杯のまま（2 杯のまとまりは別々の番号に分けない）
 *   2. 前の注文と同じ商品の 1 杯を、先頭の番号から 2 つずつ入れる（前の注文の近くに並び、CaOS で統合しやすい）。
 *      数が奇数なら、最後の 1 杯の相手は別の 1 杯（2 杯のまとまりが無い商品を先に）。無ければ 1 杯だけにし、
 *      1 杯だけだと番号が増えるときだけ 2 杯と組む
 *   3. 残りは 2 杯どうし・1 杯どうしで組み、1 つ余ったらそれだけで 1 つの番号にする。2 杯と 1 杯がどちらも
 *      奇数個のときだけ、2 杯 + 同じ商品の 1 杯の番号を 1 つ作る（この番号だけ仕上がりが 60 秒ずれる）
 *   4. 2 杯だけの番号を先、1 杯を入れた番号を後に並べる（手順 2 の番号が先頭。1 杯は次の注文とも隣り合わせる）
 */

/** 番号に入れるまとまり（同じ商品の 1 杯か 2 杯） */
export type SplitChunk = {
  /** 商品（同じ商品かを比べる値） */
  item: string;
  size: 1 | 2;
  /** 前の注文と同じ商品の 1 杯（手順 2） */
  merge: boolean;
};

/**
 * コーヒーの杯（cups。1 つが 1 杯の商品）を番号ごとのまとまりに分ける。prev は前の注文の 1 杯の商品。
 * 番号が 1 つで済む（まとまりが 2 つまで）なら、全部を 1 つの番号にして返す
 */
export const planCupSplit = (
  cups: readonly string[],
  prev: readonly string[],
): SplitChunk[][] => {
  // 1. 同じ商品を 2 杯ずつまとめる。余りの 1 杯は 1 杯のまま
  const counts = new Map<string, number>();
  for (const item of cups) counts.set(item, (counts.get(item) ?? 0) + 1);
  const all: SplitChunk[] = [];
  for (const [item, n] of counts) {
    for (let i = 0; i < Math.floor(n / 2); i++) {
      all.push({ item, size: 2, merge: false });
    }
    if (n % 2 === 1) all.push({ item, size: 1, merge: false });
  }
  if (all.length <= 2) return [all];

  // 1 つの番号には 2 つまで
  const fewest = Math.ceil(all.length / 2);
  const twos = all.filter((chunk) => chunk.size === 2);
  let ones = all.filter((chunk) => chunk.size === 1);
  const groups: SplitChunk[][] = [];

  // 2. 前の注文と同じ商品の 1 杯を、先頭の番号から 2 つずつ
  const left = [...prev];
  const fit = ones.filter((chunk) => {
    const i = left.indexOf(chunk.item);
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
  for (const chunk of fit) chunk.merge = true;
  ones = ones.filter((chunk) => !fit.includes(chunk));
  for (let i = 0; i < fit.length; i += 2) groups.push(fit.slice(i, i + 2));
  const last = groups.at(-1);
  if (last && last.length === 1) {
    // 奇数なら、最後の 1 杯の相手は別の 1 杯（2 杯のまとまりが無い商品を先に）
    const twoItems = new Set(twos.map((pair) => pair.item));
    const partner = ones.find((chunk) => !twoItems.has(chunk.item)) ?? ones[0];
    if (partner) {
      last.push(partner);
      ones = ones.filter((chunk) => chunk !== partner);
    } else if (Math.ceil(twos.length / 2) > fewest - groups.length) {
      // 1 杯だけだと番号が増えるときだけ 2 杯と組む
      const pair = twos.shift();
      if (pair) last.push(pair);
    }
  }

  // 3. 残りは 2 杯どうし・1 杯どうし
  const rest: SplitChunk[][] = [];
  const odd = twos.length % 2 === 1 && ones.length % 2 === 1;
  const pair = odd ? twos.pop() : undefined;
  if (pair) {
    // どちらも奇数個のときだけ、2 杯 + 同じ商品の 1 杯
    const i = Math.max(
      ones.findIndex((chunk) => chunk.item === pair.item),
      0,
    );
    rest.push([pair, ...ones.splice(i, 1)]);
  }
  for (let i = 0; i < twos.length; i += 2) rest.push(twos.slice(i, i + 2));
  for (let i = 0; i < ones.length; i += 2) rest.push(ones.slice(i, i + 2));

  // 4. 2 杯だけの番号を先、1 杯を入れた番号を後に（並べ替えても同じ順位どうしの順は変えない）
  const hasOne = (group: SplitChunk[]) =>
    group.some((chunk) => chunk.size === 1);
  rest.sort((a, b) => Number(hasOne(a)) - Number(hasOne(b)));
  return [...groups, ...rest];
};

/** 商品の印（CaOS の統合と同じく、ID が無ければ名前） */
export const splitItemKey = (item: { id?: string; name: string }) =>
  item.id ?? item.name;

/** 分けるときの明細 1 行。key は行の印 */
export type SplitLine<K> = { key: K; menu: MenuEntity };

/** 行の、抽出が要るコーヒーの杯（商品の印。セットメニューは中のコーヒーで数え、ミルク・グッズは数えない） */
const brewCups = (menu: MenuEntity) =>
  menu.items.flatMap(({ item, quantity }) =>
    item.item_type.needs_brew
      ? Array<string>(quantity).fill(splitItemKey(item))
      : [],
  );

/**
 * 明細の行を注文番号に割り振る（planCupSplit を行に当てはめる）。分けなくてよければ null。
 * 返すのは番号ごとの行の key（番号の順。番号の中は明細の順）。prev は前の注文の 1 杯の商品の印（splitItemKey）。
 *   - コーヒー 1 杯の行と、同じ商品 2 杯の行（セットなど）は、planCupSplit の 1 杯・2 杯のまとまりに当てる
 *     （2 杯のまとまりには 2 杯の行を先に当て、足りなければ 1 杯の行を 2 つ当てる）
 *   - それ以外のコーヒーの行（違う商品の組み合わせ・3 杯以上）は分けられないので、それだけで 1 つの番号にして後ろに足す
 *   - コーヒーの無い行（ミルク・グッズ）は 1 つ目の番号に入れる
 */
export const planOrderSplit = <K>(
  lines: readonly SplitLine<K>[],
  prev: readonly string[],
): K[][] | null => {
  const singles = new Map<string, number[]>();
  const pairs = new Map<string, number[]>();
  const fixed: number[] = [];
  const extras: number[] = [];
  const cups: string[] = [];
  const push = (map: Map<string, number[]>, item: string, index: number) =>
    map.set(item, [...(map.get(item) ?? []), index]);
  for (const [index, line] of lines.entries()) {
    const brew = brewCups(line.menu);
    if (brew.length === 0) {
      extras.push(index);
    } else if (brew.length === 1) {
      push(singles, brew[0], index);
      cups.push(...brew);
    } else if (brew.length === 2 && brew[0] === brew[1]) {
      push(pairs, brew[0], index);
      cups.push(...brew);
    } else {
      fixed.push(index);
    }
  }

  const take = (map: Map<string, number[]>, item: string) =>
    map.get(item)?.shift();
  const groups = planCupSplit(cups, prev).map((group) =>
    group.flatMap((chunk) => {
      if (chunk.size === 1) return [take(singles, chunk.item)];
      const pair = take(pairs, chunk.item);
      return pair !== undefined
        ? [pair]
        : [take(singles, chunk.item), take(singles, chunk.item)];
    }),
  );
  groups[0] = [...(groups[0] ?? []), ...extras];
  const result = [...groups, ...fixed.map((index) => [index])]
    .map((group) =>
      group
        .filter((index): index is number => index !== undefined)
        .sort((a, b) => a - b),
    )
    .filter((group) => group.length > 0);
  if (result.length <= 1) return null;
  return result.map((group) => group.map((index) => lines[index].key));
};

/**
 * 明細の行を並べる順（planOrderSplit の番号の順に、番号の中は明細の順）の key。分けなくてよい（番号が 1 つで済む）
 * 注文は入れた順のまま。prev は前の注文の 1 杯の商品の印（splitItemKey）
 */
export const sortOrderLines = <K>(
  lines: readonly SplitLine<K>[],
  prev: readonly string[],
): K[] => planOrderSplit(lines, prev)?.flat() ?? lines.map((line) => line.key);
