import createClient from "openapi-fetch";
import type { components, paths } from "../types/api";
import { API_BASE_URL } from "./item";

/** CaOS（ドリップ管制）の抽出カード。WebSocket の {"type":"drips"} で今日の分が全部届く */
export type CaosDrip = components["schemas"]["CaosDrip"];
/**
 * 列（ドリッパー 1〜6）の担当者。WebSocket の {"type":"drips"} で 6 列が全部届く（担当者がいない列は name が空）。
 * senior は交代したときに CaOS の画面が sohosai-shift の名簿で判定したもの
 */
export type CaosLane = components["schemas"]["CaosLane"];
/** 盤面への操作（割当・戻す・次へ・統合・入れ直し・列の担当者の交代と入れ替え・1つ戻す） */
export type CaosOp = components["schemas"]["CaosOp"];
export type CaosOpResult = components["schemas"]["CaosOpResult"];

const client = createClient<paths>({ baseUrl: API_BASE_URL });

/**
 * 盤面への操作を送る（POST /api/caos/ops）。結果のカードは WebSocket の drips で全部の画面に届く。
 * ルールに合わない操作は 422 で何も変えずに断られるので、その理由（error）を返す。画面にそのまま出す。
 */
export const postCaosOp = async (
  op: CaosOp,
): Promise<
  | { result: CaosOpResult; error?: undefined }
  | { result?: undefined; error: string }
> => {
  try {
    const { data, error, response } = await client.POST("/api/caos/ops", {
      body: op,
    });
    if (data) return { result: data };
    return {
      error: error?.error || `操作に失敗しました（${response.status}）`,
    };
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};

// ---------------------------------------------------------------- 練習用の盤面（実データテスト）
// 本番の盤面と同じルールで、本番とは別の盤面を動かす。WebSocket では届かないので、応答の盤面（state）をそのまま使う。
// 練習の時計は画面が持ち、操作と「進める」に練習の時刻（at）を付けて送る。

/** 練習用の盤面（カード・列の担当者・届いた注文・商品と、練習の時計） */
export type CaosPracticeState = components["schemas"]["CaosPracticeState"];
export type CaosPracticeOrder = components["schemas"]["CaosPracticeOrder"];
export type CaosPracticeItem = components["schemas"]["CaosPracticeItem"];
/** 練習を始めるときに送るもの（過去の注文と時間帯） */
export type CaosPracticeCreateRequest =
  components["schemas"]["CaosPracticeCreateRequest"];
export type CaosPracticeOrderInput =
  components["schemas"]["CaosPracticeOrderInput"];
export type CaosPracticeOpResult =
  components["schemas"]["CaosPracticeOpResult"];

/** 練習用の盤面の API の結果。失敗したら理由（画面にそのまま出す）と、盤面が無い（消えた）か */
export type CaosPracticeResult<T> =
  | { result: T; error?: undefined; notFound?: undefined }
  | { result?: undefined; error: string; notFound: boolean };

const practiceResult = <T>(
  data: T | undefined,
  error: { error?: string } | undefined,
  response: Response,
): CaosPracticeResult<T> =>
  data !== undefined
    ? { result: data }
    : {
        error: error?.error || `練習の盤面を使えません（${response.status}）`,
        notFound: response.status === 404,
      };

const unreachable = {
  error: "cafeore-pos につながりません",
  notFound: false,
} as const;

/** 練習用の盤面を作る（POST /api/caos/practice） */
export const createCaosPractice = async (
  body: CaosPracticeCreateRequest,
): Promise<CaosPracticeResult<CaosPracticeState>> => {
  try {
    const { data, error, response } = await client.POST("/api/caos/practice", {
      body,
    });
    return practiceResult(data, error, response);
  } catch {
    return unreachable;
  }
};

/** 練習用の盤面を読む（時計は進めない）。消えていれば notFound */
export const getCaosPractice = async (
  id: string,
): Promise<CaosPracticeResult<CaosPracticeState>> => {
  try {
    const { data, error, response } = await client.GET(
      "/api/caos/practice/{id}",
      { params: { path: { id } } },
    );
    return practiceResult(data, error, response);
  } catch {
    return unreachable;
  }
};

/** 練習の時計を at まで進め、それまでに来た注文を盤面に入れる */
export const advanceCaosPractice = async (
  id: string,
  at: string,
): Promise<CaosPracticeResult<CaosPracticeState>> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/caos/practice/{id}/advance",
      { params: { path: { id } }, body: { at } },
    );
    return practiceResult(data, error, response);
  } catch {
    return unreachable;
  }
};

/** 練習用の盤面への操作（本番の postCaosOp と同じ操作）。ルールに合わない操作は 422 で断られ、その理由を返す */
export const postCaosPracticeOp = async (
  id: string,
  at: string,
  op: CaosOp,
): Promise<CaosPracticeResult<CaosPracticeOpResult>> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/caos/practice/{id}/ops",
      { params: { path: { id } }, body: { at, op } },
    );
    return practiceResult(data, error, response);
  } catch {
    return unreachable;
  }
};

/** 練習用の盤面を消す（終わった・やめたとき）。失敗しても、放置された練習はサーバーが片付ける */
export const deleteCaosPractice = async (id: string): Promise<void> => {
  try {
    await client.DELETE("/api/caos/practice/{id}", {
      params: { path: { id } },
    });
  } catch {
    // 片付けはサーバーにも任せてある
  }
};
