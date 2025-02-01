import { type ItemEntity, type WithId, key2item } from "@cafeore/common";
import { Button } from "../ui/button";

type props = {
  items: WithId<ItemEntity>[];
  addItem: (item: WithId<ItemEntity>) => void;
};

export const ItemButtons = ({ items, addItem }: props) => {
  return (
    <div className="relative h-screen pr-[20px] pl-[20px]">
      <div
        key="hot"
        className="pt-[20px] pb-[15px] pl-[20px] font-medium text-2xl text-theme"
      >
        ブレンド
      </div>
      <div
        className="grid grid-cols-3 items-center justify-items-start gap-[30px]"
        style={{ gridTemplateRows: "auto" }}
      >
        <Button
          key="-"
          className="h-[50px] w-[150px] bg-theme text-lg hover:bg-theme hover:ring-4"
          onClick={() => {
            addItem(key2item("-"));
          }}
        >
          べっぴんブレンド
        </Button>
        <Button
          key="^"
          className="h-[50px] w-[150px] bg-theme text-lg hover:bg-theme hover:ring-4"
          onClick={() => {
            addItem(key2item("^"));
          }}
        >
          珈琲・俺ブレンド
        </Button>
      </div>
      <div
        key="hot"
        className="pt-[30px] pb-[15px] pl-[20px] font-medium text-2xl text-theme"
      >
        限定
      </div>
      <div
        className="grid grid-cols-3 items-center justify-items-start gap-[30px]"
        style={{ gridTemplateRows: "auto" }}
      >
        <Button
          key="/"
          className="h-[50px] w-[150px] bg-theme text-lg hover:bg-theme hover:ring-4"
          onClick={() => {
            addItem(key2item("/"));
          }}
        >
          限定
        </Button>
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
        <Button
          key=";"
          className="h-[50px] w-[150px] bg-hot text-lg hover:bg-theme hover:ring-4"
          onClick={() => {
            addItem(key2item(";"));
          }}
        >
          マンデリン
        </Button>
        <Button
          key=":"
          className="h-[50px] w-[150px] bg-hot text-lg hover:bg-theme hover:ring-4"
          onClick={() => {
            addItem(key2item(":"));
          }}
        >
          ピンクブルボン
        </Button>
        <Button
          key="]"
          className="h-[50px] w-[150px] bg-hot text-lg hover:bg-theme hover:ring-4"
          onClick={() => {
            addItem(key2item("]"));
          }}
        >
          コスタリカ
        </Button>
      </div>
      <div
        key="ice"
        className="pt-[30px] pb-[15px] pl-[20px] font-medium text-2xl"
      >
        others
      </div>
      <div
        className="grid grid-cols-3 items-center justify-items-start gap-[30px]"
        style={{ gridTemplateRows: "auto" }}
      >
        <Button
          key="@"
          className="h-[50px] w-[150px] bg-ore text-lg hover:bg-hot hover:ring-4"
          onClick={() => {
            addItem(key2item("@"));
          }}
        >
          ホットオレ
        </Button>
        <Button
          key="["
          className="h-[50px] w-[150px] bg-ore text-lg hover:bg-ice hover:ring-4"
          onClick={() => {
            addItem(key2item("["));
          }}
        >
          アイスオレ
        </Button>
        <Button
          key="\\"
          className="h-[50px] w-[150px] bg-ice text-lg hover:bg-theme hover:ring-4"
          onClick={() => {
            addItem(key2item("\\"));
          }}
        >
          アイスコーヒー
        </Button>
        <Button
          key="."
          className="h-[50px] w-[150px] bg-ice text-lg hover:bg-ice hover:ring-4"
          onClick={() => {
            addItem(key2item("."));
          }}
        >
          アイスミルク
        </Button>
        <Button
          key=","
          className="h-[50px] w-[150px] text-lg hover:ring-4"
          onClick={() => {
            addItem(key2item(","));
          }}
        >
          コースター
        </Button>
      </div>
    </div>
  );
};
