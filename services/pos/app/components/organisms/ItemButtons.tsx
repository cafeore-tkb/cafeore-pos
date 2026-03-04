import type { ItemEntity, WithId } from "@cafeore/common";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

type props = {
  items: WithId<ItemEntity>[];
  addItem: (item: WithId<ItemEntity>) => void;
};

export const ItemButtons = ({ items, addItem }: props) => {
  const bgColor: Record<string, string> = {
    iceOre: "bg-ore hover:bg-ore/70",
    ice: "bg-ice hover:bg-ice/70",
    milk: "bg-ice hover:bg-ice/70",
    other: "bg-gray-500 hover:bg-gray-500/70",
  };
  return (
    <div className="relative h-screen pr-5 pl-5">
      <div
        key="hot"
        className="pt-5 pb-3.75 pl-5 font-medium text-2xl text-theme"
      >
        ブレンド
      </div>
      <div
        className="grid grid-cols-3 items-center justify-items-start gap-7.5"
        style={{ gridTemplateRows: "auto" }}
      >
        {items.map(
          (item) =>
            item.item_type.name === "hot" && (
              <Button
                key={item.id}
                className="h-12.5 w-37.5 bg-theme-primary text-lg hover:bg-theme-primary/70 hover:ring-4"
                onClick={() => {
                  addItem(item);
                }}
              >
                {item.abbr}
              </Button>
            ),
        )}
      </div>
      {/* imte_typeにサブタイプみたいなフィールド用意してブレンド、限定、グルメを区別したい */}
      {/* <div
        key="hot"
        className="pt-[30px] pb-[15px] pl-[20px] font-medium text-2xl text-theme-primary"
      >
        限定
      </div>
      <div
        className="grid grid-cols-3 items-center justify-items-start gap-[30px]"
        style={{ gridTemplateRows: "auto" }}
      >
        {items.map(
          (item) =>
            item.item_type.name === "hot" && (
              <Button
                key={item.id}
                className="h-12.5 w-37.5 bg-theme-primary text-lg hover:bg-theme-primary hover:ring-4"
                onClick={() => {
                  addItem(item);
                }}
              >
                {item.abbr}
              </Button>
            ),
        )}
      </div>
      <div
        key="hot"
        className="pt-[30px] pb-[15px] pl-[20px] font-medium text-2xl text-hot"
      >
        グルメ
      </div>
      <div
        className="grid grid-cols-3 items-center justify-items-start gap-[30px]"
        style={{ gridTemplateRows: "auto" }}
      >
        {items.map(
          (item) =>
            item.item_type.name === "hot" && (
              <Button
                key={item.id}
                className="h-12.5 w-37.5 bg-theme-primary text-lg hover:bg-theme-primary hover:ring-4"
                onClick={() => {
                  addItem(item);
                }}
              >
                {item.abbr}
              </Button>
            ),
        )}
      </div> */}
      <div key="ice" className="pt-7.5 pb-3.75 pl-5 font-medium text-2xl">
        others
      </div>
      <div
        className="grid grid-cols-3 items-center justify-items-start gap-7.5"
        style={{ gridTemplateRows: "auto" }}
      >
        {items.map(
          (item) =>
            item.item_type.name !== "hot" && (
              <Button
                key={item.id}
                className={cn(
                  "h-12.5 w-37.5 hover:ring-4",
                  bgColor[item.item_type.name],
                )}
                onClick={() => {
                  addItem(item);
                }}
              >
                {item.abbr}
              </Button>
            ),
        )}
      </div>
    </div>
  );
};
