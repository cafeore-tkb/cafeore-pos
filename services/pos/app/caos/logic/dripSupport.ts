import { type CaosCard, type ShiftFeed, cupNeedsBrew } from "@cafeore/common";
const normalize = (name: string) => name.normalize("NFKC").trim();

/** 未登録と対応なしを分ける。名前の推測や学年からの能力推定はしない。 */
export const memberDrips = (feed: ShiftFeed | null, name: string) => {
  if (!name.trim()) return undefined;
  return Object.entries(feed?.drips ?? {}).find(
    ([key]) => normalize(key) === normalize(name),
  )?.[1];
};

export const dripWarnings = (feed: ShiftFeed | null, name: string) => {
  const drips = memberDrips(feed, name);
  if (!drips) return [];
  return ["ホット", "アイス"].flatMap((kind) => {
    const one = !drips.includes(`1杯${kind}`);
    const two = !drips.includes(`2杯${kind}`);
    return one && two
      ? [`${kind}×`]
      : one
        ? [`${kind}1×`]
        : two
          ? [`${kind}2×`]
          : [];
  });
};

export const unsupportedDrip = (
  feed: ShiftFeed | null,
  name: string,
  card: CaosCard,
) => {
  const drips = memberDrips(feed, name);
  if (!drips) return false;
  const cups = card.cups.filter(cupNeedsBrew);
  // 盤面は最大2杯。不正なカードから存在しない「3杯」の能力を推測しない。
  if (cups.length > 2) return false;
  const iced = cups.filter((cup) => cup.item.item_type.iced_brew).length;
  const hot = cups.length - iced;
  return (
    (hot > 0 && !drips.includes(`${hot}杯ホット`)) ||
    (iced > 0 && !drips.includes(`${iced}杯アイス`))
  );
};

/** 学年の候補は名簿全体。配信が古い場合は予定の名前を学年未登録として残す。 */
export const gradeMembers = (feed: ShiftFeed | null, current: string) => {
  if (!feed) return [];
  const names = new Map<string, { name: string; grade: string }>();
  for (const name of [
    ...Object.values(feed.drippers).flat(),
    ...feed.drills.flatMap((drill) => Object.values(drill.drippers).flat()),
    ...feed.seniors,
  ]) {
    if (name.trim()) names.set(normalize(name), { name, grade: "学年未登録" });
  }
  for (const member of feed.members ?? [])
    names.set(normalize(member.name), {
      ...member,
      grade: member.grade || "学年未登録",
    });
  return [...names.values()]
    .filter((member) => normalize(member.name) !== normalize(current))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
};
