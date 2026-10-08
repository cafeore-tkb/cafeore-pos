import {
  type OrderEntity,
  type WithId,
  elapsedSeconds,
  isOverdue,
} from "@cafeore/common";
import { minSec } from "~/lib/minSec";
import { cn } from "~/lib/utils";
import { useCurrentTime } from "../functional/useCurrentTime";

export const RealtimeElapsedTime = ({
  order,
}: { order: WithId<OrderEntity> }) => {
  const currentTime = useCurrentTime(1000);
  const seconds = elapsedSeconds(order.createdAt, currentTime);

  return (
    <div
      className={cn(
        "grid rounded-md px-2",
        isOverdue(seconds) && "bg-red-500 text-white",
      )}
    >
      <div className="text-sm">経過時間</div>
      <div className="font-bold text-3xl">{minSec(seconds).m}分</div>
    </div>
  );
};
