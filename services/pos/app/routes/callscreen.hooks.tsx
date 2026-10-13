import { useCallback, useEffect, useRef, useState } from "react";

/** 点滅 1 コマの長さ */
const FLASH_STEP_MS = 280;
/** 1 つの番号が点滅するコマ数 */
const FLASH_STEPS = 8;

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

type FlashState = {
  beat: number;
  /** 番号 → 点滅が終わるビート */
  until: Record<number, number>;
};

/**
 * 点滅を共通の 1 本のビートで駆動する。
 * 番号ごとに終わりのビートだけを持つので、何件同時に光ってもタイミングが揃い、
 * どの番号も同じ長さだけ点滅する。
 */
export function useFlash() {
  const [state, setState] = useState<FlashState>({ beat: 0, until: {} });
  const running = Object.keys(state.until).length > 0;

  useEffect(() => {
    if (!running) return;

    const timer = setInterval(() => {
      setState((prev) => {
        const beat = prev.beat + 1;
        const until: Record<number, number> = {};
        for (const [id, end] of Object.entries(prev.until)) {
          if (end > beat) until[Number(id)] = end;
        }
        return { beat, until };
      });
    }, FLASH_STEP_MS);

    return () => clearInterval(timer);
  }, [running]);

  const startFlash = useCallback((id: number) => {
    setState((prev) => {
      // 既に回っているビートには合わせる。止まっていれば点灯から始める
      const isRunning = Object.keys(prev.until).length > 0;
      const beat = isRunning ? prev.beat : prev.beat + (prev.beat % 2);
      return { beat, until: { ...prev.until, [id]: beat + FLASH_STEPS } };
    });
  }, []);

  const isFlashing = useCallback(
    (id: number) => state.until[id] !== undefined && state.beat % 2 === 0,
    [state],
  );

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

/**
 * 呼び出し中は CM を止め、それ以外では流し続ける。
 * 戻り値は再生を促すコールバックで、再生が途切れたときに呼ぶ。
 */
export function useCmPlayback(
  videoRef: React.RefObject<HTMLVideoElement>,
  paused: boolean,
) {
  const resume = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.loop = true;
    void video.play().catch(() => {
      // 自動再生の制限やファイルが無いときに弾かれた場合は握りつぶす
    });
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (paused) {
      video.pause();
      return;
    }

    resume();
  }, [videoRef, paused, resume]);

  return resume;
}

/** チャイムが鳴り終わるのを待つ上限（ファイルは 2.6 秒） */
const CHIME_TIMEOUT_MS = 5_000;
/** 読み上げが鳴り終わるのを待つ上限 */
const VOICE_TIMEOUT_MS = 20_000;
/** 読み上げの音声を待つ上限。過ぎたら読み上げずに進む（呼び出しならチャイムだけ鳴らす） */
const VOICE_LOAD_TIMEOUT_MS = 8_000;
/** 先に作らせておくとき、ほかの画面と同時に作らないようにずらす幅 */
const WARM_JITTER_MS = 5_000;

// 読み上げの音声は Worker（worker/call-voice.ts）が ElevenLabs で作り、片ごとに R2 に溜めたものをつないで返す。
// 文は Worker が決めるので、ここでは番号・「順番が前後するか」・ドリッパーの番号だけを渡す。

/** 呼び出しの読み上げ */
export const callVoicePath = (orderNo: number, reordered: boolean) =>
  `/call-voice/call?order=${orderNo}${reordered ? "&reordered=1" : ""}`;

/** ドリップの案内の読み上げ */
export const dripVoicePath = (orderNos: readonly number[], dripper: number) =>
  `/call-voice/drip?${orderNos.map((no) => `order=${no}`).join("&")}&dripper=${dripper}`;

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
        // 本文まで読み切って、ブラウザのキャッシュに入れる
        .then(() => fetch(callVoicePath(no, false)))
        .then((res) => res.arrayBuffer())
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }, [orderNos, enabled]);
}
