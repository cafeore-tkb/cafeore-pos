import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

// 左側カード表示コンポーネント
export function CurrentOrderCard({
  orderId,
  cardRef,
}: {
  orderId: number;
  cardRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <Card
      ref={cardRef}
      className="flex w-full max-w-[360px] items-center justify-center rounded-2xl px-8 py-6"
      style={{
        boxShadow:
          "8px 8px 16px rgba(0, 0, 0, 0.3), -8px -8px 16px rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
      }}
    >
      <div className="bg-gradient-to-br from-theme2025 via-teal-600 to-theme2025 bg-clip-text font-extrabold text-7xl text-transparent">
        {orderId}
      </div>
    </Card>
  );
}

// 右側呼び出し中カードコンポーネント
export function CallingOrderCard({
  orderId,
  isNewlyAdded,
  isAnimated,
  onCardRef,
  onTextRef,
}: {
  orderId: number;
  isNewlyAdded: boolean;
  isAnimated: boolean;
  onCardRef: (el: HTMLDivElement | null) => void;
  onTextRef: (el: HTMLDivElement | null) => void;
}) {
  // アニメーションが開始されるまで（isNewlyAddedがtrueでisAnimatedがfalse）は非表示にする
  const shouldHide = isNewlyAdded && !isAnimated;
  return (
    <Card
      ref={onCardRef}
      className={cn(
        "flex items-center justify-center rounded-2xl px-8 py-3",
        shouldHide && "opacity-0",
      )}
      style={{
        boxShadow:
          "8px 8px 16px rgba(0, 0, 0, 0.3), -8px -8px 16px rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
      }}
    >
      <div
        ref={onTextRef}
        className="pointer-events-none bg-clip-text font-bold text-7xl text-transparent"
        style={{
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          backgroundImage:
            "linear-gradient(135deg, var(--grad-start, #14b8a6), var(--grad-mid, #0d9488), var(--grad-end, #14b8a6))",
        }}
      >
        {orderId}
      </div>
    </Card>
  );
}

// 準備中カードコンポーネント
export function PreparingOrderCard({ orderId }: { orderId: number }) {
  return (
    <Card
      className="flex items-center justify-center rounded-xl px-4 py-2"
      style={{
        boxShadow:
          "8px 8px 16px rgba(0, 0, 0, 0.3), -8px -8px 16px rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
      }}
    >
      <div
        className="pointer-events-none bg-clip-text font-bold text-5xl text-transparent"
        style={{
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          backgroundImage: "linear-gradient(135deg, #007d79, #006763, #00524f)",
        }}
      >
        {orderId}
      </div>
    </Card>
  );
}
