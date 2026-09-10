import type { OrderEntity, WithId } from "@cafeore/common";
import dayjs from "dayjs";
import { cn } from "~/lib/utils";
import { useCurrentTime } from "../functional/useCurrentTime";

export const RealtimeElapsedTime = ({
  order,
  compact = false,
}: { order: WithId<OrderEntity>; compact?: boolean }) => {
  const currentTime = useCurrentTime(1000);
  const createdAt = dayjs(order.createdAt);
  const getDiffTime = (order: WithId<OrderEntity>) => {
    const now = currentTime;
    return dayjs(dayjs(now).diff(dayjs(order.createdAt)));
  };
  const diffTime = getDiffTime(order);

  return (
    <div
      className={cn(
        "grid rounded-md",
        compact ? "px-1" : "px-2",
        dayjs(currentTime).isAfter(createdAt.add(15, "minutes")) &&
          "bg-red-500 text-white",
      )}
    >
      <div className={compact ? "text-[10px]" : "text-sm"}>経過時間</div>
      <div className={cn("font-bold", compact ? "text-lg" : "text-3xl")}>
        {diffTime.format("m分")}
      </div>
    </div>
  );
};
