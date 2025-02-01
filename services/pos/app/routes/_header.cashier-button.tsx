import { parseWithZod } from "@conform-to/zod";
import { AlertDialogCancel } from "@radix-ui/react-alert-dialog";
import { TrashIcon } from "@radix-ui/react-icons";
import { type ClientActionFunction, useSubmit } from "@remix-run/react";
import { itemSource } from "common/data/items";
import { orderConverter } from "common/firebase-utils/converter";
import { collectionSub } from "common/firebase-utils/subscription";
import { stringToJSONSchema } from "common/lib/custom-zod";
import type { WithId } from "common/lib/typeguard";
import type { ItemEntity } from "common/models/item";
import { OrderEntity, orderSchema } from "common/models/order";
import { orderRepository } from "common/repositories/order";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useState } from "react";
import useSWRSubscription from "swr/subscription";
import { z } from "zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export default function Casher() {
  const items = itemSource;
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }),
  );
  const curOrderId =
    orders?.reduce((acc, cur) => Math.max(acc, cur.orderId), 0) ?? 0;
  const nextOrderId = curOrderId + 1;
  const submit = useSubmit();
  const order = OrderEntity.createNew({ orderId: nextOrderId });
  const [recieved, setReceived] = useState(0);
  const [queue, setQueue] = useState<WithId<ItemEntity>[]>([]);
  order.items = queue;
  const charge = recieved - order.total;
  // const [description, setDescription] = useState("");
  // order.description = description;

  const [discountNo, setDiscountNo] = useState("");

  const submitOrder = () => {
    console.log(charge);
    if (charge < 0) {
      return;
    }
    if (queue.length === 0) {
      return;
    }
    submit({ newOrder: JSON.stringify(order.toOrder()) }, { method: "POST" });
    console.log("送信");
    setQueue([]);
    setReceived(0);
    // setDescription("");
  };

  const findByOrderId = (
    orders: WithId<OrderEntity>[] | undefined,
    orderId: number,
  ): WithId<OrderEntity> | undefined => {
    return orders?.find((order) => order.orderId === orderId);
  };

  function justPayed() {
    order.received = order.billingAmount;
    submitOrder();
  }

  return (
    <div className="p-[20px]">
      <div className="flex flex-row flex-wrap ">
        <div className="relative w-2/3 pr-[20px] pl-[20px]">
          <div
            key="hot"
            className="pb-[15px] pl-[20px] font-medium text-2xl text-hot"
          >
            ホット
          </div>
          <div
            className="grid grid-cols-3 items-center justify-items-center gap-[30px]"
            style={{ gridTemplateRows: "auto" }}
          >
            {items.map(
              (item) =>
                item.type === "hot" && (
                  <Button
                    key={item.id}
                    className="h-[50px] w-[200px] bg-hot text-lg hover:bg-theme hover:ring-4 hover:ring-theme"
                    onClick={async () => {
                      setQueue([...queue, item]);
                    }}
                  >
                    {item.name}
                  </Button>
                ),
            )}
          </div>
          <div
            key="ice"
            className="pt-[30px] pb-[15px] pl-[20px] font-medium text-2xl text-ice"
          >
            アイス
          </div>
          <div
            className="grid grid-cols-3 items-center justify-items-center gap-[30px]"
            style={{ gridTemplateRows: "auto" }}
          >
            {items.map(
              (item) =>
                (item.type === "ice" || item.type === "milk") && (
                  <Button
                    key={item.id}
                    className="h-[50px] w-[200px] bg-ice text-lg hover:bg-theme hover:ring-4 hover:ring-theme"
                    onClick={async () => {
                      setQueue([...queue, item]);
                    }}
                  >
                    {item.name}
                  </Button>
                ),
            )}
          </div>
          <div
            key="ore"
            className="pt-[30px] pb-[15px] pl-[20px] font-medium text-2xl text-ore"
          >
            オレ
          </div>
          <div
            className="grid grid-cols-3 items-center justify-items-center gap-[30px]"
            style={{ gridTemplateRows: "auto" }}
          >
            {items.map(
              (item) =>
                (item.type === "hotOre" || item.type === "iceOre") && (
                  <Button
                    key={item.id}
                    className="h-[50px] w-[200px] bg-ore text-lg hover:bg-theme hover:ring-4 hover:ring-theme"
                    onClick={async () => {
                      setQueue([...queue, item]);
                    }}
                  >
                    {item.name}
                  </Button>
                ),
            )}
          </div>
          <div
            key="others"
            className="pt-[30px] pb-[15px] pl-[20px] font-medium text-2xl"
          >
            その他
          </div>
          <div
            className="grid grid-cols-3 items-center justify-items-center gap-[30px]"
            style={{ gridTemplateRows: "auto" }}
          >
            {items.map(
              (item) =>
                item.type === "others" && (
                  <Button
                    key={item.id}
                    className="h-[50px] w-[200px] text-lg hover:bg-theme hover:ring-4 hover:ring-theme"
                    onClick={async () => {
                      setQueue([...queue, item]);
                    }}
                  >
                    {item.name}
                  </Button>
                ),
            )}
          </div>
        </div>
        <div className="relative w-1/3 pl-[20px]">
          <Table>
            <TableCaption />
            <TableHeader>
              <TableRow>
                <TableHead className="w-500 pb-[15px] font-medium text-4xl text-theme">
                  No. {nextOrderId}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue?.map((item, index) => (
                <TableRow key={`${index}-${item.id}`} className="h-[50px]">
                  <TableCell className="flex flex-row items-center gap-[20px] font-medium">
                    <div className="w-[250px] flex-none justify-start pl-[40px] text-xl">
                      {item.name}
                    </div>
                    <div>
                      <Select
                        onValueChange={(value) => {
                          setQueue((prev) => {
                            const newItems = [...prev];
                            let newValue = value;
                            if (newValue === "null") {
                              newValue = "";
                            }
                            newItems[index].assignee = newValue;
                            return newItems;
                          });
                        }}
                      >
                        <SelectTrigger className="w-[100px] justify-center">
                          <SelectValue placeholder="指名欄" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>指名</SelectLabel>
                            <SelectItem value="first">1st</SelectItem>
                            <SelectItem value="second">2nd</SelectItem>
                            <SelectItem value="third">3rd</SelectItem>
                            <SelectItem value="fourth">4th</SelectItem>
                            <SelectItem value="fifth">5th</SelectItem>
                            <SelectItem value="null">指名なし</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Button
                        type="button"
                        className="justify-center"
                        onClick={() => {
                          setQueue((prev) => {
                            const newItems = [...prev];
                            newItems.splice(index, 1);
                            return newItems;
                          });
                        }}
                      >
                        <div>
                          <TrashIcon />
                        </div>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Input
            id="description"
            name="description"
            type="string"
            placeholder="備考欄"
            // value={description}
            // onChange={(e) => setDescription(e.target.value)}
          />
          <div>割引No.</div>
          <InputOTP
            maxLength={3}
            pattern={REGEXP_ONLY_DIGITS}
            value={discountNo}
            onChange={(value: string) => {
              setDiscountNo(value);
            }}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} className="font-mono text-3xl" />
              <InputOTPSlot index={1} className="font-mono text-3xl" />
              <InputOTPSlot index={2} className="font-mono text-3xl" />
            </InputOTPGroup>
          </InputOTP>
          <div className="relative pt-[20px] pl-[20px] font-medium text-3xl">
            合計金額：{order.billingAmount} 円
          </div>
          <form>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  className="absolute right-[30px] h-[50px] w-[150px] text-xl hover:bg-theme hover:ring-4 hover:ring-theme"
                  disabled={queue.length === 0}
                  onClick={() => {
                    const discountOrder = findByOrderId(
                      orders,
                      Number(discountNo),
                    );
                    console.log(discountOrder);
                    if (discountNo !== null && discountOrder !== undefined) {
                      order.applyDiscount(discountOrder);
                      console.log(order);
                    } else {
                      order.removeDiscount();
                    }
                  }}
                >
                  確定
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    備考欄・金額を確認してください
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {/* <div>備考欄： {order.description}</div> */}
                    <div>小計： {order.total} 円</div>
                    <div>割引： {order.discount} 円</div>
                    <div>合計： {order.billingAmount} 円</div>
                    <div>
                      受領額：
                      <Input
                        id="recieved"
                        name="recieved"
                        type="number"
                        placeholder="受け取った金額を入力してください"
                        value={recieved}
                        onChange={(e) => {
                          setReceived(Number.parseInt(e.target.value)); // NaN のチェック
                        }}
                      />
                    </div>
                    <div>
                      お釣り： {Number.isNaN(charge) || charge < 0 ? 0 : charge}{" "}
                      円
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>戻る</AlertDialogCancel>
                  <AlertDialogAction onClick={justPayed}>
                    丁度
                  </AlertDialogAction>
                  <AlertDialogAction onClick={submitOrder}>
                    送信
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </form>
        </div>
      </div>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const schema = z.object({
    newOrder: stringToJSONSchema.pipe(orderSchema),
  });
  const submission = parseWithZod(formData, {
    schema,
  });
  if (submission.status !== "success") {
    console.error(submission.error);
    return submission.reply();
  }

  const { newOrder } = submission.value;
  const order = OrderEntity.fromOrder(newOrder);

  const savedOrder = await orderRepository.save(order);

  console.log("savedOrder", savedOrder);

  return new Response("ok");
};
