import { jstDate } from "./jstDay";

// sohosai-shift（シフト作成ツール）が CaOS へ配信する担当者の予定（Firestore の caosFeeds/{合言葉}）を読む。
// 合言葉を知っていればログインなしで読める（Firestore の REST）。合言葉はビルドに入れず、各 iPad の CaOS の設定で入れて端末に覚える。
// CaOS はこれを「交代」のときの名前の候補と、上級生（限定を淹れられる人）の判定にだけ使う。予定の時刻どおりに自動で替えることはしない。
//
// 中身（Firestore の REST の形で届くのを、ここで普通の値に直す）：
//   drippers：本番の 30 分ごとの枠。キーは枠の開始（日本時間 "YYYY-MM-DD HH:MM"）、値は 1st〜6th の氏名（空きは ""）
//   drills：オペ練の回ごと（回 id → {title, date, start, minutes, gap, rounds, drippers}）。
//           ラウンド k の開始は start + (k-1)×(minutes+gap) 分、終わりは開始＋minutes 分。drippers のキーはラウンドの番号（"1"〜）
//   seniors：上級生（限定を淹れられる人）の氏名

/** 本番の枠の長さ（分） */
export const SHIFT_SLOT_MINUTES = 30;

const LANE_COUNT = 6;
const MINUTE_MS = 60_000;

/** 合言葉を URL に入れられる形にする。使えない形（空・空白や / を含む）なら null */
export const normalizeFeedKey = (key: string): string | null => {
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 200 || /[\s/?#]/.test(trimmed)) return null;
  return trimmed;
};

export const caosFeedUrl = (key: string) =>
  `https://firestore.googleapis.com/v1/projects/sohosai-shift/databases/(default)/documents/caosFeeds/${encodeURIComponent(key)}`;

export interface ShiftDrill {
  id: string;
  title: string;
  /** 日本時間の日付 YYYY-MM-DD */
  date: string;
  /** 日本時間の開始 HH:MM */
  start: string;
  minutes: number;
  gap: number;
  rounds: number;
  /** ラウンドの番号（"1"〜）→ 1st〜6th の氏名 */
  drippers: Record<string, string[]>;
}

export interface ShiftFeed {
  /** 本番の枠の開始（日本時間 "YYYY-MM-DD HH:MM"）→ 1st〜6th の氏名 */
  drippers: Record<string, string[]>;
  drills: ShiftDrill[];
  seniors: string[];
  /** ドキュメントを最後に書いた時刻（Firestore の updateTime）。分からなければ null */
  updatedAt: string | null;
}

// ---------------------------------------------------------------- Firestore の REST の形を読む

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
    drippers: asNameTable(fields.drippers),
    drills,
    seniors,
    updatedAt: asString(record.updateTime) || null,
  };
};

/**
 * 合言葉の予定を読む。読めなければ理由を Error で投げる（画面にそのまま出す）。
 * fetch は差し替えられる（テスト用）
 */
export const fetchShiftFeed = async (
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ShiftFeed> => {
  const normalized = normalizeFeedKey(key);
  if (!normalized) throw new Error("合言葉の形が違います");
  let response: Response;
  try {
    response = await fetchImpl(caosFeedUrl(normalized), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new Error("sohosai-shift につながりません");
  }
  if (response.status === 404) {
    throw new Error("合言葉が違うか、まだ配信されていません");
  }
  if (response.status === 401 || response.status === 403) {
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

// ---------------------------------------------------------------- 候補と上級生

const normalizeName = (name: string) => name.normalize("NFKC").trim();

/** 上級生（限定を淹れられる人）か。予定の seniors に名前があれば上級生。予定が無ければ false */
export const isSeniorName = (feed: ShiftFeed | null, name: string) => {
  const target = normalizeName(name);
  if (!feed || !target) return false;
  return feed.seniors.some((senior) => normalizeName(senior) === target);
};

/** 日本時間の "YYYY-MM-DD" と "HH:MM" のエポックミリ秒。読めなければ NaN */
const jstMs = (date: string, time: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}$/.test(time)
    ? Date.parse(`${date}T${time.padStart(5, "0")}:00+09:00`)
    : Number.NaN;

/** 日本時間の時刻 HH:MM */
const clockOf = (ms: number) =>
  new Date(ms + 9 * 60 * MINUTE_MS).toISOString().slice(11, 16);

/** 予定の 1 つ（本番の枠か、オペ練のラウンド） */
export interface ShiftPeriod {
  /** 画面に出す呼び方（例「今の枠 11:00〜11:30」「第2回オペ練 次のR2 13:25〜13:45」） */
  label: string;
  startMs: number;
  endMs: number;
  /** 1st〜6th の氏名 */
  names: string[];
}

/** 今の枠・次の枠・オペ練の今のラウンド・次のラウンド（今日のものだけ）。並びは候補に出す順 */
export const currentShiftPeriods = (
  feed: ShiftFeed,
  nowMs: number,
): ShiftPeriod[] => {
  const today = jstDate(nowMs);
  const range = (startMs: number, endMs: number) =>
    `${clockOf(startMs)}〜${clockOf(endMs)}`;

  const slots = Object.entries(feed.drippers)
    .map(([key, names]) => {
      const [date = "", time = ""] = key.trim().split(/\s+/);
      const startMs = jstMs(date, time);
      return {
        date,
        startMs,
        endMs: startMs + SHIFT_SLOT_MINUTES * MINUTE_MS,
        names,
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
  const push = (
    label: string,
    p: { startMs: number; endMs: number; names: string[] },
  ) =>
    periods.push({
      label: `${label} ${range(p.startMs, p.endMs)}`,
      startMs: p.startMs,
      endMs: p.endMs,
      names: p.names,
    });
  if (currentSlot) push("今の枠", currentSlot);
  if (nextSlot) push("次の枠", nextSlot);
  if (currentRound)
    push(`${currentRound.title} 今のR${currentRound.round}`, currentRound);
  if (nextRound) push(`${nextRound.title} 次のR${nextRound.round}`, nextRound);
  return periods;
};

export interface LaneCandidate {
  name: string;
  senior: boolean;
  /** どの予定の人か（例「今の枠 11:00〜11:30」） */
  reasons: string[];
}

/**
 * 「交代」の名前の候補。今の枠・次の枠・オペ練の今と次のラウンドの、そのドリッパーの番目（1st なら 1 人目）の人。
 * 同じ人は 1 つにまとめる。空きと、今そのドリッパーにいる人（current）は出さない。
 * 候補に無い人は画面で自由に入れる
 */
export const laneCandidates = (
  feed: ShiftFeed | null,
  dripper: number,
  nowMs: number,
  current = "",
): LaneCandidate[] => {
  if (!feed) return [];
  const byName = new Map<string, LaneCandidate>();
  for (const period of currentShiftPeriods(feed, nowMs)) {
    const name = (period.names[dripper - 1] ?? "").trim();
    if (!name || normalizeName(name) === normalizeName(current)) continue;
    const key = normalizeName(name);
    const candidate = byName.get(key) ?? {
      name,
      senior: isSeniorName(feed, name),
      reasons: [],
    };
    candidate.reasons.push(period.label);
    byName.set(key, candidate);
  }
  return [...byName.values()];
};
