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
 * enabled が false の間は控えを取らず、true になった最初の一覧は
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
 * 呼び出しがある間は呼び出し画面を出し、無くなってから delayMs 後に PV へ戻す。
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
 * 呼び出し中は PV を止め、それ以外では流し続ける。
 * 戻り値は再生を促すコールバックで、再生が途切れたときに呼ぶ。
 */
export function usePvPlayback(
  videoRef: React.RefObject<HTMLVideoElement>,
  paused: boolean,
) {
  const resume = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.loop = true;
    void video.play().catch(() => {
      // 自動再生の制限で弾かれた場合は握りつぶす
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
