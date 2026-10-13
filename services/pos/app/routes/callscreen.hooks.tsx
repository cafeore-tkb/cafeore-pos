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
export function useOnAdded(
  ids: number[],
  onAdded: (id: number) => void,
  enabled: boolean,
) {
  const knownRef = useRef<Set<number> | null>(null);

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
/** 呼び出しの音声が鳴り終わるのを待つ上限 */
const VOICE_TIMEOUT_MS = 15_000;

/**
 * 呼び出しの音声の URL。Worker（worker/call-voice.ts）が ElevenLabs で作り、R2 に溜めたものを返す。
 * 文面は Worker が決めるので、ここでは番号と「順番が前後するか」だけを渡す
 */
const callVoiceUrl = (orderNo: number, reordered: boolean) =>
  `/call-voice/${orderNo}${reordered ? "?reordered=1" : ""}`;

/**
 * 音声を取りに行き、再生できる URL（blob:）にする。
 * 取れなければ null（ローカルの dev サーバーには Worker が無い、鍵が無い、ElevenLabs が落ちているなど）
 */
const loadCallVoice = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("audio/")) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
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

/**
 * 呼び出しを読み上げる。1 件ごとにチャイムを鳴らしてから番号を読み、何件も同時に呼んだときは順番に流す。
 * 音声は呼んだ時点で取りに行くので、チャイムの間に作り終わればすぐ続けて流れる。
 * 音声が取れなければチャイムだけ鳴らす
 */
export function useCallAnnouncer(
  chimeRef: React.RefObject<HTMLAudioElement>,
  voiceRef: React.RefObject<HTMLAudioElement>,
) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  return useCallback(
    (orderNo: number, reordered: boolean) => {
      const voice = loadCallVoice(callVoiceUrl(orderNo, reordered));
      queueRef.current = queueRef.current.then(async () => {
        const chime = chimeRef.current;
        if (chime) await playToEnd(chime, CHIME_TIMEOUT_MS);

        const url = await voice;
        if (url === null) return;
        const audio = voiceRef.current;
        if (audio) {
          audio.src = url;
          await playToEnd(audio, VOICE_TIMEOUT_MS);
        }
        URL.revokeObjectURL(url);
      });
    },
    [chimeRef, voiceRef],
  );
}
