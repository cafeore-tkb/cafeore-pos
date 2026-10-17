import { useCallback, useEffect, useRef, useState } from "react";

/** 新しく入った番号を光らせる長さ（以前の点滅 280ms × 8 コマと同じ） */
export const FLASH_MS = 2240;

/**
 * 固定サイズのステージを画面に収める倍率を返す。
 * レイアウトは実寸のまま、拡大縮小だけで解像度差を吸収する。
 */
export function useStageScale(width: number, height: number) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      setScale(
        Math.min(window.innerWidth / width, window.innerHeight / height),
      );
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [width, height]);

  return scale;
}

/**
 * 新しく入った番号を FLASH_MS だけ光らせる。
 * 光り方（地が浮かび、プリズムの光が抜けて消える）は CSS のアニメーションに任せ、ここでは光らせる番号だけを持つ。
 */
export function useFlash() {
  const [flashing, setFlashing] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const startFlash = useCallback((id: number) => {
    // 光っている最中にもう一度来たら、そこから数え直す
    clearTimeout(timersRef.current.get(id));
    timersRef.current.set(
      id,
      setTimeout(() => {
        timersRef.current.delete(id);
        setFlashing((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, FLASH_MS),
    );
    setFlashing((prev) => new Set(prev).add(id));
  }, []);

  const isFlashing = useCallback((id: number) => flashing.has(id), [flashing]);

  return { startFlash, isFlashing };
}

/**
 * 一覧に新しく入った番号だけを知らせる。
 *
 * enabled（最初の一覧を受け取ったか）が false の間は控えを取らず、true になった最初の一覧は
 * 「既にあったもの」として黙って覚える。画面を開き直したときに
 * 前からの呼び出しで鳴らしたり光らせたりしないため。
 */
export function useOnAdded<T>(
  ids: readonly T[],
  onAdded: (id: T) => void,
  enabled: boolean,
) {
  const knownRef = useRef<Set<T> | null>(null);

  useEffect(() => {
    const known = knownRef.current;
    knownRef.current = enabled ? new Set(ids) : null;

    if (known === null) return;

    for (const id of ids) {
      if (!known.has(id)) onAdded(id);
    }
  }, [ids, onAdded, enabled]);
}

/**
 * 呼び出しがある間は呼び出し画面を出し、無くなってから delayMs 後に CM へ戻す。
 * 提供が途切れるたびに切り替わらないよう、少し待ってから戻す。
 */
export function useCallVisibility(hasCalling: boolean, delayMs: number) {
  const [showCall, setShowCall] = useState(false);

  useEffect(() => {
    if (hasCalling) {
      setShowCall(true);
      return;
    }

    const timer = setTimeout(() => setShowCall(false), delayMs);
    return () => clearTimeout(timer);
  }, [hasCalling, delayMs]);

  return showCall;
}

/** チャイムが鳴り終わるのを待つ上限（ファイルは 2.6 秒） */
const CHIME_TIMEOUT_MS = 5_000;
/** 読み上げが鳴り終わるのを待つ上限 */
const VOICE_TIMEOUT_MS = 20_000;
/** 読み上げの音声を待つ上限。過ぎたら読み上げずに進む（呼び出しならチャイムだけ鳴らす） */
const VOICE_LOAD_TIMEOUT_MS = 8_000;
/** 先に作らせておくとき、ほかの画面と同時に作らないようにずらす幅 */
const WARM_JITTER_MS = 5_000;
/** 先に作らせる 1 件を待つ上限。返事が来ないまま止まると、後ろの先読みが全部止まるので打ち切る */
const WARM_TIMEOUT_MS = 15_000;

// 読み上げの音声は Worker（worker/call-voice.ts）が ElevenLabs で作り、片ごとに R2 に溜めたものをつないで返す。
// 文は Worker が決めるので、ここでは番号・「順番が前後するか」・ドリッパーの番号だけを渡す。

/** 呼び出しの読み上げ */
export const callVoicePath = (orderNo: number, reordered: boolean) =>
  `/call-voice/call?order=${orderNo}${reordered ? "&reordered=1" : ""}`;

/** ドリップの案内の読み上げ。invite が false なら「よろしければぜひ、お近くでご覧ください。」を省く */
export const dripVoicePath = (
  orderNos: readonly number[],
  dripper: number,
  invite: boolean,
) =>
  `/call-voice/drip?${orderNos.map((no) => `order=${no}`).join("&")}&dripper=${dripper}${invite ? "" : "&invite=0"}`;

/**
 * 音声を取りに行き、再生できる URL（blob:）にする。
 * 取れなければ null（ローカルの dev サーバーには Worker が無い、鍵が無い、ElevenLabs が落ちている、待ちきれないなど）
 */
const loadVoice = async (path: string): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_LOAD_TIMEOUT_MS);
  try {
    const res = await fetch(path, { signal: controller.signal });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("audio/")) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** 最後まで鳴らす。鳴らせない・終わらないときも timeoutMs で先へ進む */
const playToEnd = (audio: HTMLAudioElement, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      audio.removeEventListener("ended", done);
      audio.removeEventListener("error", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    try {
      audio.currentTime = 0;
    } catch {
      // Safari など currentTime の操作に失敗する環境があるので握りつぶす
    }
    // 自動再生の制限で弾かれたら、待たずに次へ
    audio.play().catch(done);
  });

export type Announcement = {
  /** 読み上げの音声（callVoicePath・dripVoicePath） */
  path: string;
  /** 読み上げの前にチャイムを鳴らすか（呼び出しだけ鳴らす） */
  chime: boolean;
};

/**
 * 読み上げる。何件も重なったときは 1 件ずつ順に流す。
 * 音声は頼んだ時点で取りに行き、届いてからチャイムを鳴らして、間を空けずに続けて流す
 * （届く前にチャイムを鳴らすと、作っている間だけチャイムと声の間が空く）。
 * 音声が取れなければ、チャイムだけ鳴らす（チャイムの無い案内は何も鳴らさない）
 */
export function useAnnouncer(
  chimeRef: React.RefObject<HTMLAudioElement>,
  voiceRef: React.RefObject<HTMLAudioElement>,
) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  return useCallback(
    ({ path, chime }: Announcement) => {
      const voice = loadVoice(path);
      queueRef.current = queueRef.current.then(async () => {
        const url = await voice;
        const audio = voiceRef.current;
        // チャイムの間に読み込ませておき、鳴り終わったらすぐ流せるようにする
        if (url && audio) {
          audio.src = url;
          audio.load();
        }
        const chimeAudio = chimeRef.current;
        if (chime && chimeAudio) await playToEnd(chimeAudio, CHIME_TIMEOUT_MS);
        if (url && audio) await playToEnd(audio, VOICE_TIMEOUT_MS);
        if (url) URL.revokeObjectURL(url);
      });
    },
    [chimeRef, voiceRef],
  );
}

/**
 * 呼び出しの読み上げを先に作らせておく（Worker が R2 に溜め、ブラウザにも 1 時間持たせる）。呼ぶときに作るのを待たずに済む。
 * 番号の片はドリップの案内と同じものなので、そちらも速くなる。
 * 新しく見えた番号ごとに 1 回だけ、1 件ずつ頼む。開いたあとに入った注文は、呼び出し画面が何台もあると
 * 同時に頼んで二重に作りうるので、少しずらしてから頼む（開いたときにあった注文は、ほかの画面がもう作っているので、ずらさない）
 */
export function useWarmCallVoices(
  orderNos: readonly number[],
  enabled: boolean,
) {
  const warmedRef = useRef<Set<number> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!enabled) return;
    const initial = warmedRef.current === null;
    const warmed = warmedRef.current ?? new Set<number>();
    warmedRef.current = warmed;
    for (const no of orderNos) {
      if (warmed.has(no)) continue;
      warmed.add(no);
      const jitter = initial ? 0 : Math.random() * WARM_JITTER_MS;
      chainRef.current = chainRef.current
        .then(() => new Promise((resolve) => setTimeout(resolve, jitter)))
        // 本文まで読み切って、ブラウザのキャッシュに入れる（打ち切りは本文を読むところまで効く）
        .then(async () => {
          const res = await fetch(callVoicePath(no, false), {
            signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
          });
          await res.arrayBuffer();
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }, [orderNos, enabled]);
}
