import type { WithId } from "common/lib/typeguard";
import type { OrderEntity } from "common/models/order";
import dayjs from "dayjs";
import { cn } from "~/lib/utils";
import { useCurrentTime } from "../functional/useCurrentTime";

export const RealtimeElapsedTime = ({
  order,
}: { order: WithId<OrderEntity> }) => {
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
        "rounded-md px-2",
        dayjs(currentTime).isAfter(createdAt.add(15, "minutes")) &&
          "bg-red-500 text-white",
      )}
    >
      <div>経過時間 {diffTime.format("m分")}</div>
    </div>
  );
};
