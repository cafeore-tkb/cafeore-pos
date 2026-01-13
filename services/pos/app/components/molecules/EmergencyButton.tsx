import type { ItemEntity, WithId } from "@cafeore/common";
import { AlertTriangle } from "lucide-react";
import { Button } from "~/components/ui/button";

type EmergencyButtonProps = {
  item: WithId<ItemEntity>;
  orderId: number;
  onEmergencyClick: (item: WithId<ItemEntity>, orderId: number) => void;
};

export const EmergencyButton = ({
  item,
  orderId,
  onEmergencyClick,
}: EmergencyButtonProps) => {
  return (
    <Button
      size="sm"
      variant="destructive"
      className="mt-2 w-full"
      onClick={() => onEmergencyClick(item, orderId)}
    >
      <AlertTriangle className="mr-1 h-4 w-4" />
      緊急
    </Button>
  );
};
