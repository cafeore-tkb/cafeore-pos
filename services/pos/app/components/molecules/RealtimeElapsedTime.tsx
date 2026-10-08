import { type OrderEntity, type WithId, elapsedTime } from "@cafeore/common";
import { cn } from "~/lib/utils";
import { useCurrentTime } from "../functional/useCurrentTime";

export const RealtimeElapsedTime = ({
  order,
}: { order: WithId<OrderEntity> }) => {
  const currentTime = useCurrentTime(1000);
  const elapsed = elapsedTime(order.createdAt, currentTime);

  return (
    <div
      className={cn(
        "grid rounded-md px-2",
        elapsed.overdue && "bg-red-500 text-white",
      )}
    >
      <div className="text-sm">経過時間</div>
      <div className="font-bold text-3xl">{elapsed.minutes}分</div>
    </div>
  );
};
