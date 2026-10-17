import { useCallback, useEffect, useRef, useState } from "react";
import type { CmItem } from "~/lib/callscreen-cm";

type CmPlayerItem = Pick<CmItem, "id" | "kind" | "url">;

const fill: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
};

/**
 * 呼び出し画面の CM。items を順番に繰り返し流す（動画は最後まで、画像は imageSeconds 秒）。
 * 1 本だけなら繰り返す。paused の間（呼び出し画面を被せている間）は止めておく。
 * 読めないもの（壊れている・ブラウザが流せない形式・置いていない）は飛ばし、どれも流せなければ fallback を出す
 */
export function CmPlayer({
  items,
  imageSeconds,
  paused,
  fallback,
}: {
  items: readonly CmPlayerItem[];
  imageSeconds: number;
  paused: boolean;
  fallback: React.ReactNode;
}) {
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);

  const playable = items.filter((item) => !failed.has(item.id));
  const current =
    playable.length > 0 ? playable[position % playable.length] : null;
  const single = playable.length === 1;

  const next = useCallback(() => setPosition((p) => p + 1), []);
  const fail = useCallback((id: string) => {
    setFailed((prev) => new Set(prev).add(id));
  }, []);

  // 呼び出し画面を被せている間は動画を止め、外したら続きから流す。
  // 次の動画に移ると要素ごと作り直し、そちらは autoPlay で始まるので、ここは paused の切り替えだけを見る
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.pause();
      return;
    }
    void video.play().catch(() => {
      // 自動再生の制限で弾かれた場合は握りつぶす
    });
  }, [paused]);

  // 画像は決めた秒数だけ出して次へ。止めている間は数えない（外したら、その画像を出し直してから数える）
  useEffect(() => {
    if (!current || current.kind !== "image" || paused) return;
    const timer = setTimeout(next, imageSeconds * 1000);
    return () => clearTimeout(timer);
  }, [current, paused, imageSeconds, next]);

  if (!current) return <>{fallback}</>;

  if (current.kind === "image") {
    return (
      <img
        key={current.id}
        src={current.url}
        alt=""
        onError={() => fail(current.id)}
        style={{ ...fill, objectFit: "contain", background: "#000" }}
      />
    );
  }

  return (
    <video
      // 次の動画に移ったら作り直し、頭から流す
      key={`${current.id}:${position}`}
      ref={videoRef}
      src={current.url}
      autoPlay={!paused}
      muted
      loop={single}
      playsInline
      preload="auto"
      onEnded={next}
      onError={() => fail(current.id)}
      style={{ ...fill, objectFit: "cover" }}
    >
      <track kind="captions" />
    </video>
  );
}
