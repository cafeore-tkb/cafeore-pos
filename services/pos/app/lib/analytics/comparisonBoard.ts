import type { ComparisonBoard, ComparisonSettings } from "./yearComparison";

export type CardSide = "current" | "historical";
export interface MappingCard {
  side: CardSide;
  key: string;
}
export type MappingTarget =
  | { type: "group"; id: string }
  | { type: "card"; side: CardSide; key: string }
  | { type: "pending"; side: CardSide };
const pendingKey = (side: CardSide) =>
  side === "current" ? "pendingCurrent" : "pendingHistorical";
const excludedKey = (side: CardSide) =>
  side === "current" ? "excludedCurrent" : "excludedHistorical";
const copy = (board: ComparisonBoard): ComparisonBoard => ({
  ...board,
  groups: board.groups.map((g) => ({
    ...g,
    current: [...g.current],
    historical: [...g.historical],
  })),
  pendingCurrent: [...board.pendingCurrent],
  pendingHistorical: [...board.pendingHistorical],
  excludedCurrent: [...board.excludedCurrent],
  excludedHistorical: [...board.excludedHistorical],
});
export const cardGroup = (board: ComparisonBoard, card: MappingCard) =>
  board.groups.find((g) => g[card.side].includes(card.key));

/** 旧形式の明示的な対応だけ移す。同名・並び順からの自動対応は作らない。 */
export function comparisonBoard(
  settings: ComparisonSettings,
  currentKeys: readonly string[],
  historicalKeys: readonly string[],
): ComparisonBoard {
  const catalog = {
    current: new Set(currentKeys),
    historical: new Set(historicalKeys),
  };
  const board: ComparisonBoard = settings.board
    ? copy(settings.board)
    : {
        groups: [],
        pendingCurrent: [],
        pendingHistorical: [],
        excludedCurrent: [],
        excludedHistorical: [],
      };
  if (!settings.board) {
    const names = [
      ...new Set(
        currentKeys
          .map((key) => settings.current[key]?.trim())
          .filter((v): v is string => !!v),
      ),
    ];
    for (const name of names) {
      const current = currentKeys.filter(
        (key) => settings.current[key]?.trim() === name,
      );
      const historical = historicalKeys.filter(
        (key) => settings.historical[key]?.trim() === name,
      );
      if (current.length && historical.length)
        board.groups.push({
          id: `legacy:${name}`,
          label: name,
          current,
          historical,
        });
    }
  }
  const used = { current: new Set<string>(), historical: new Set<string>() };
  board.groups = board.groups.flatMap((group) => {
    const current = group.current.filter((key) => catalog.current.has(key));
    const historical = group.historical.filter((key) =>
      catalog.historical.has(key),
    );
    if (!current.length || !historical.length) return [];
    for (const key of current) used.current.add(key);
    for (const key of historical) used.historical.add(key);
    return [{ ...group, current, historical }];
  });
  for (const side of ["current", "historical"] as const) {
    board[excludedKey(side)] = board[excludedKey(side)].filter(
      (key) => catalog[side].has(key) && !used[side].has(key),
    );
    for (const key of board[excludedKey(side)]) used[side].add(key);
    const pending = [
      ...board[pendingKey(side)],
      ...(side === "current" ? currentKeys : historicalKeys),
    ];
    board[pendingKey(side)] = pending.filter((key) => {
      if (!catalog[side].has(key) || used[side].has(key)) return false;
      used[side].add(key);
      return true;
    });
  }
  return board;
}

function detach(board: ComparisonBoard, card: MappingCard) {
  board[pendingKey(card.side)] = board[pendingKey(card.side)].filter(
    (key) => key !== card.key,
  );
  for (const group of board.groups)
    group[card.side] = group[card.side].filter((key) => key !== card.key);
  // 片側がなくなった行は解除し、相手のカードを対応待ちへ戻す。
  board.groups = board.groups.filter((group) => {
    if (group.current.length && group.historical.length) return true;
    board.pendingCurrent.push(...group.current);
    board.pendingHistorical.push(...group.historical);
    return false;
  });
}

export function moveMappingCard(
  input: ComparisonBoard,
  card: MappingCard,
  target: MappingTarget,
): ComparisonBoard {
  if (input[excludedKey(card.side)].includes(card.key)) return input;
  if (
    !input[pendingKey(card.side)].includes(card.key) &&
    !cardGroup(input, card)
  )
    return input;
  if (
    target.type === "card" &&
    target.side === card.side &&
    target.key === card.key
  )
    return input;
  const destination =
    target.type === "group"
      ? input.groups.find((g) => g.id === target.id)
      : target.type === "card"
        ? cardGroup(input, target)
        : null;
  if (destination && destination.id === cardGroup(input, card)?.id) {
    if (target.type !== "card" || target.side !== card.side) return input;
    const board = copy(input);
    const group = board.groups.find((g) => g.id === destination.id);
    if (!group) return input;
    group[card.side] = group[card.side].filter((key) => key !== card.key);
    group[card.side].splice(group[card.side].indexOf(target.key), 0, card.key);
    return board;
  }
  if (target.type === "group" && !destination) return input;
  if (target.type === "pending" && target.side !== card.side) return input;
  if (
    target.type === "card" &&
    !destination &&
    !input[pendingKey(target.side)].includes(target.key)
  )
    return input;
  const board = copy(input);
  detach(board, card);
  if (destination) {
    board.groups
      .find((g) => g.id === destination.id)
      ?.[card.side].push(card.key);
  } else if (target.type === "pending") {
    board[pendingKey(card.side)].push(card.key);
  } else if (target.type === "card" && target.side === card.side) {
    const pending = board[pendingKey(card.side)];
    pending.splice(pending.indexOf(target.key), 0, card.key);
  } else if (target.type === "card") {
    board[pendingKey(target.side)] = board[pendingKey(target.side)].filter(
      (key) => key !== target.key,
    );
    let index = 1;
    while (board.groups.some((g) => g.id === `mapping-${index}`)) index++;
    board.groups.push({
      id: `mapping-${index}`,
      current: [card.side === "current" ? card.key : target.key],
      historical: [card.side === "historical" ? card.key : target.key],
    });
  }
  return board;
}

export function excludeMappingCard(
  input: ComparisonBoard,
  card: MappingCard,
): ComparisonBoard {
  if (input[excludedKey(card.side)].includes(card.key)) return input;
  const board = copy(input);
  detach(board, card);
  board[excludedKey(card.side)].push(card.key);
  return board;
}

export function restoreMappingCard(
  input: ComparisonBoard,
  card: MappingCard,
): ComparisonBoard {
  const board = copy(input);
  if (!board[excludedKey(card.side)].includes(card.key)) return input;
  board[excludedKey(card.side)] = board[excludedKey(card.side)].filter(
    (key) => key !== card.key,
  );
  board[pendingKey(card.side)].push(card.key);
  return board;
}

export function settingsFromBoard(
  settings: ComparisonSettings,
  board: ComparisonBoard,
  currentProducts: readonly { key: string; name: string }[],
  historicalProducts: readonly string[],
): ComparisonSettings {
  const next: ComparisonSettings = {
    ...settings,
    version: 2,
    board,
    current: { ...settings.current },
    historical: { ...settings.historical },
  };
  for (const product of currentProducts) delete next.current[product.key];
  for (const key of historicalProducts) delete next.historical[key];
  const names = new Map(
    currentProducts.map((product) => [product.key, product.name]),
  );
  const used = new Set<string>();
  for (const group of board.groups) {
    const base = (
      group.label ||
      group.current.map((key) => names.get(key) ?? key).join("＋")
    ).slice(0, 68);
    let label = base;
    let index = 2;
    while (used.has(label)) label = `${base}（${index++}）`;
    used.add(label);
    for (const key of group.current) next.current[key] = label;
    for (const key of group.historical) next.historical[key] = label;
  }
  return next;
}
