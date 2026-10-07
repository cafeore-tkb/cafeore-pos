// sohosai-shift（シフト作成ツール）が CaOS へ配信する担当者の予定（Firestore の caosFeeds/{合言葉}）を読む。
//
// sohosai-shift の管理者が「配信」を押すと、合言葉つきのドキュメントが書かれる。合言葉を知っていればログインなしで読める。
// CaOS はこれを「交代」のときの名前の候補と、上級生（限定を淹れられる人）の判定にだけ使う。
// 列の担当者を時刻どおりに自動で替えることはしない（交代は人が CaOS で行う。services/pos/app/caos/DESIGN_REQUIREMENTS.md）。
//
// 中身（Firestore の REST の形式で届くのを、ここで普通の値に直す）：
//   room：部屋の名前 / updatedAt：最後に配信した時刻
//   drippers：本番の 30 分ごとの枠。キーは枠の開始（日本時間 "YYYY-MM-DD HH:mm"）、値は 1st〜6th の氏名（空きは ""）
//   drills：オペ練の回ごと。ラウンド k の開始は start + (k-1)×(minutes+gap) 分、終わりは開始＋minutes 分。
//           drippers のキーはラウンドの番号（"1"〜）、値は 1st〜6th の氏名
//   seniors：上級生（限定を淹れられる人）の氏名

/** 合言葉の形（sohosai-shift が作るもの）。違う形のものは送らない */
export const CAOS_FEED_KEY_PATTERN = /^[A-Za-z0-9]{32,64}$/;

/** 本番の枠の長さ（分） */
export const SHIFT_SLOT_MINUTES = 30;

const LANE_COUNT = 6;

/** 列（ドリッパー 1〜6）の呼び方。1st〜6th */
export const laneOrdinal = (dripper: number) =>
  ["1st", "2nd", "3rd", "4th", "5th", "6th"][dripper - 1] ?? `${dripper}th`;

export const caosFeedUrl = (key: string) =>
  `https://firestore.googleapis.com/v1/projects/sohosai-shift/databases/(default)/documents/caosFeeds/${key}`;

export interface ShiftDrill {
  id: string;
  title: string;
  /** 日本時間の日付 YYYY-MM-DD */
  date: string;
  /** 日本時間の開始 HH:mm */
  start: string;
  minutes: number;
  gap: number;
  rounds: number;
  /** ラウンドの番号（1〜）→ 1st〜6th の氏名 */
  drippers: Record<string, string[]>;
}

export interface ShiftFeed {
  room: string;
  /** 最後に配信した時刻（ISO 8601）。分からなければ null */
  updatedAt: string | null;
  /** 本番の枠の開始（日本時間 "YYYY-MM-DD HH:mm"）→ 1st〜6th の氏名 */
  drippers: Record<string, string[]>;
  drills: ShiftDrill[];
  seniors: string[];
}

// ---------------------------------------------------------------- Firestore の REST の形式を読む

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreValue> };
  arrayValue?: { values?: FirestoreValue[] };
};

/** Firestore の REST の値（{"stringValue": "..."} など）を普通の値に直す */
export const decodeFirestoreValue = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return null;
  const v = value as FirestoreValue;
  if ("stringValue" in v) return v.stringValue ?? "";
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return Boolean(v.booleanValue);
  if ("timestampValue" in v) return v.timestampValue ?? null;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFirestoreFields(v.mapValue?.fields);
  if ("arrayValue" in v)
    return (v.arrayValue?.values ?? []).map(decodeFirestoreValue);
  return null;
};

const decodeFirestoreFields = (
  fields: Record<string, FirestoreValue> | undefined,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields ?? {}).map(([key, value]) => [
      key,
      decodeFirestoreValue(value),
    ]),
  );

const asString = (value: unknown) => (typeof value === "string" ? value : "");
const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** 1st〜6th の氏名（前後の空白を落とし、6 人分にそろえる） */
const asLaneNames = (value: unknown): string[] => {
  const names = Array.isArray(value) ? value : [];
  return Array.from({ length: LANE_COUNT }, (_, i) =>
    asString(names[i]).trim(),
  );
};

const asNameTable = (value: unknown): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, names]) => [
      key,
      asLaneNames(names),
    ]),
  );

/** Firestore の REST で読んだドキュメント（{"fields": {...}, "updateTime": "..."}）を ShiftFeed にする */
export const parseShiftFeed = (doc: unknown): ShiftFeed => {
  const record = asRecord(doc);
  const fields = decodeFirestoreFields(
    record.fields as Record<string, FirestoreValue> | undefined,
  );
  const drills = Object.entries(asRecord(fields.drills)).map(
    ([id, value]): ShiftDrill => {
      const drill = asRecord(value);
      return {
        id,
        title: asString(drill.title),
        date: asString(drill.date),
        start: asString(drill.start),
        minutes: asNumber(drill.minutes),
        gap: asNumber(drill.gap),
        rounds: asNumber(drill.rounds),
        drippers: asNameTable(drill.drippers),
      };
    },
  );
  const seniors = Array.isArray(fields.seniors)
    ? fields.seniors.map((name) => asString(name).trim()).filter(Boolean)
    : [];
  return {
    room: asString(fields.room),
    updatedAt:
      asString(fields.updatedAt) || asString(record.updateTime) || null,
    drippers: asNameTable(fields.drippers),
    drills,
    seniors,
  };
};

/**
 * 合言葉の feed を読む。読めなければ理由を Error で投げる（画面にそのまま出す）。
 * fetch は差し替えられる（テスト用）。
 */
export const fetchShiftFeed = async (
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ShiftFeed> => {
  if (!CAOS_FEED_KEY_PATTERN.test(key)) {
    throw new Error("合言葉は英数字 32〜64 文字です");
  }
  let response: Response;
  try {
    response = await fetchImpl(caosFeedUrl(key), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new Error("sohosai-shift につながりません");
  }
  if (response.status === 404) {
    throw new Error("合言葉が違うか、まだ配信されていません");
  }
  if (response.status === 403 || response.status === 401) {
    throw new Error("読む権限がありません（合言葉を確かめてください）");
  }
  if (!response.ok) {
    throw new Error(`読めませんでした（${response.status}）`);
  }
  try {
    return parseShiftFeed(await response.json());
  } catch {
    throw new Error("配信の中身が読めません");
  }
};

// ---------------------------------------------------------------- 候補

const MINUTE_MS = 60_000;

const normalizeName = (name: string) => name.normalize("NFKC").trim();

/** 上級生（限定を淹れられる人）か。feed の seniors に名前があれば上級生。feed が無ければ false */
export const isSeniorName = (feed: ShiftFeed | null, name: string) => {
  const target = normalizeName(name);
  if (!feed || !target) return false;
  return feed.seniors.some((senior) => normalizeName(senior) === target);
};

/** 日本時間の "YYYY-MM-DD" と "HH:mm" のエポックミリ秒。読めなければ NaN */
const jstMs = (date: string, time: string) =>
  Date.parse(`${date}T${time.padStart(5, "0")}:00+09:00`);

const jstDateOf = (ms: number) =>
  new Date(ms + 9 * 60 * MINUTE_MS).toISOString().slice(0, 10);

const clockOf = (ms: number) =>
  new Date(ms + 9 * 60 * MINUTE_MS).toISOString().slice(11, 16);

/** 予定の 1 つ（本番の枠か、オペ練のラウンド） */
export interface ShiftPeriod {
  /** 画面に出す呼び方（例「今の枠 11:00〜11:30」「第2回オペ練 R2 13:25〜13:45」） */
  label: string;
  startMs: number;
  endMs: number;
  /** 1st〜6th の氏名 */
  names: string[];
}

/** 今の時刻の枠・次の枠・今のオペ練のラウンド・次のラウンド（同じ日のものだけ）。順番は候補に出す順 */
export const currentShiftPeriods = (
  feed: ShiftFeed,
  nowMs: number,
): ShiftPeriod[] => {
  const today = jstDateOf(nowMs);
  const range = (startMs: number, endMs: number) =>
    `${clockOf(startMs)}〜${clockOf(endMs)}`;

  const slots = Object.entries(feed.drippers)
    .map(([key, names]) => {
      const [date, time] = key.split(" ");
      const startMs = jstMs(date ?? "", time ?? "");
      return {
        startMs,
        endMs: startMs + SHIFT_SLOT_MINUTES * MINUTE_MS,
        names,
        date,
      };
    })
    .filter((slot) => Number.isFinite(slot.startMs) && slot.date === today)
    .sort((a, b) => a.startMs - b.startMs);
  const currentSlot = slots.find(
    (slot) => slot.startMs <= nowMs && nowMs < slot.endMs,
  );
  const nextSlot = slots.find((slot) => slot.startMs > nowMs);

  const rounds = feed.drills
    .filter((drill) => drill.date === today)
    .flatMap((drill) => {
      const firstMs = jstMs(drill.date, drill.start);
      if (!Number.isFinite(firstMs)) return [];
      return Array.from({ length: Math.max(0, drill.rounds) }, (_, i) => {
        const startMs = firstMs + i * (drill.minutes + drill.gap) * MINUTE_MS;
        return {
          title: drill.title || "オペ練",
          round: i + 1,
          startMs,
          endMs: startMs + drill.minutes * MINUTE_MS,
          names: drill.drippers[String(i + 1)] ?? asLaneNames([]),
        };
      });
    })
    .sort((a, b) => a.startMs - b.startMs);
  const currentRound = rounds.find(
    (round) => round.startMs <= nowMs && nowMs < round.endMs,
  );
  const nextRound = rounds.find((round) => round.startMs > nowMs);

  const periods: ShiftPeriod[] = [];
  if (currentSlot)
    periods.push({
      label: `今の枠 ${range(currentSlot.startMs, currentSlot.endMs)}`,
      ...currentSlot,
    });
  if (nextSlot)
    periods.push({
      label: `次の枠 ${range(nextSlot.startMs, nextSlot.endMs)}`,
      ...nextSlot,
    });
  if (currentRound)
    periods.push({
      label: `${currentRound.title} 今のR${currentRound.round} ${range(currentRound.startMs, currentRound.endMs)}`,
      ...currentRound,
    });
  if (nextRound)
    periods.push({
      label: `${nextRound.title} 次のR${nextRound.round} ${range(nextRound.startMs, nextRound.endMs)}`,
      ...nextRound,
    });
  return periods.map(({ label, startMs, endMs, names }) => ({
    label,
    startMs,
    endMs,
    names,
  }));
};

export interface LaneCandidate {
  name: string;
  senior: boolean;
  /** どの予定で、どの番目か（例「今の枠 11:00〜11:30 の 1st」） */
  reasons: string[];
  /** その列（番目）の予定の人か。上に出す */
  forThisLane: boolean;
}

/**
 * 「交代」のときの名前の候補。今の時刻の枠・次の枠・オペ練の今（次）のラウンドで、
 * その列（番目）の人を上に、同じ予定のほかの番目の人をその下に、今日の予定に出てくるほかの人を最後に並べる。
 * 今その列にいる人（current）は除く。
 */
export const laneCandidates = (
  feed: ShiftFeed | null,
  dripper: number,
  nowMs: number,
  current = "",
): LaneCandidate[] => {
  if (!feed) return [];
  const byName = new Map<string, LaneCandidate>();
  const add = (name: string, reason: string | null, forThisLane: boolean) => {
    const trimmed = name.trim();
    if (!trimmed || normalizeName(trimmed) === normalizeName(current)) return;
    const candidate = byName.get(trimmed) ?? {
      name: trimmed,
      senior: isSeniorName(feed, trimmed),
      reasons: [],
      forThisLane: false,
    };
    if (reason && !candidate.reasons.includes(reason))
      candidate.reasons.push(reason);
    candidate.forThisLane ||= forThisLane;
    byName.set(trimmed, candidate);
  };
  const periods = currentShiftPeriods(feed, nowMs);
  for (const period of periods) {
    add(
      period.names[dripper - 1] ?? "",
      `${period.label} の ${laneOrdinal(dripper)}`,
      true,
    );
  }
  for (const period of periods) {
    period.names.forEach((name, i) => {
      if (i !== dripper - 1)
        add(name, `${period.label} の ${laneOrdinal(i + 1)}`, false);
    });
  }
  // 今日の予定に出てくるほかの人（予定の時刻からずれて交代することもあるので）
  const today = jstDateOf(nowMs);
  const others = new Set<string>();
  for (const [key, names] of Object.entries(feed.drippers)) {
    if (key.startsWith(today)) for (const name of names) others.add(name);
  }
  for (const drill of feed.drills) {
    if (drill.date !== today) continue;
    for (const names of Object.values(drill.drippers))
      for (const name of names) others.add(name);
  }
  const rest = [...others]
    .map((name) => name.trim())
    .filter((name) => name && !byName.has(name))
    .sort((a, b) => a.localeCompare(b, "ja"));
  for (const name of rest) add(name, null, false);

  const list = [...byName.values()];
  return [
    ...list.filter((candidate) => candidate.forThisLane),
    ...list.filter(
      (candidate) => !candidate.forThisLane && candidate.reasons.length > 0,
    ),
    ...list.filter(
      (candidate) => !candidate.forThisLane && candidate.reasons.length === 0,
    ),
  ];
};
