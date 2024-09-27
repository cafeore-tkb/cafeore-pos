import { parseWithZod } from "@conform-to/zod";
import { AlertDialogCancel } from "@radix-ui/react-alert-dialog";
import { TrashIcon } from "@radix-ui/react-icons";
import { type ClientActionFunction, json } from "@remix-run/react";
import { useState } from "react";
import useSWRSubscription from "swr/subscription";
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
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { itemConverter } from "~/firebase/converter";
import { collectionSub } from "~/firebase/subscription";
import type { WithId } from "~/lib/typeguard";
import { type Item, itemSchema } from "~/models/item";
import { ItemEntity } from "~/models/item";
import type { Order } from "~/models/order";
import { itemRepository } from "~/repositories/item";

const mockOrder: Order = {
  orderId: 1,
  createdAt: new Date(),
  servedAt: null,
  items: [
    // {
    //   id: "1",
    //   type: "ice",
    //   name: "珈琲・俺ブレンド",
    //   price: 300,
    // },
  ],
  total: 0,
  orderReady: false,
  description: "",
  discountInfo: {
    previousOrderId: null,
    validCups: 0,
    discount: 0,
  },
  received: 0,
  billingAmount: 0,
};

export default function Casher() {
  // const total = mockOrder.items.reduce((acc, cur) => acc + cur.price, 0);
  const { data: items } = useSWRSubscription(
    "items",
    collectionSub({ converter: itemConverter }),
  );
  const [recieved, setText] = useState(0);
  const [total, setTotal] = useState(0);
  const [queue, setQueue] = useState<WithId<Item>[]>([]);

  // console.log(mockOrder);
  // console.log(items?.[0]);
  return (
    <div>
      <div className="flex h-screen flex-row flex-wrap">
        <div className="w-2/3">
          <div className="grid h-screen grid-cols-2">
            {items?.map((item) => (
              <div key={item.id}>
                <Button
                  onClick={async () => {
                    mockOrder.items.push(item);
                    mockOrder.total = mockOrder.items.reduce(
                      (acc, cur) => acc + cur.price,
                      0,
                    );
                    setQueue(mockOrder.items);
                    setTotal(mockOrder.total);
                    console.log(mockOrder);
                  }}
                >
                  {item.name}
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="w-1/3">
          <div>
            <Table>
              <TableCaption />
              <TableHeader>
                <TableRow>
                  <TableHead className="w-500">
                    No. {mockOrder.orderId}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue?.map((item) => (
                  <TableRow
                    key={mockOrder.items.indexOf(item)}
                    className="relative h-[50px]"
                  >
                    <TableCell className="relative font-medium">
                      <div className="absolute left-[50px]">{item.name}</div>
                      <Button // ここで削除ボタンを押すと、mockOrder.itemsから削除する
                        type="button"
                        className="absolute right-[50px] h-[30px] w-[25px]"
                        onClick={() => {
                          mockOrder.items.splice(
                            mockOrder.items.indexOf(item),
                            1,
                          );
                          mockOrder.total = mockOrder.items.reduce(
                            (acc, cur) => acc + cur.price,
                            0,
                          );
                          setQueue(mockOrder.items);
                          setTotal(mockOrder.total);
                          console.log(mockOrder);
                        }}
                      >
                        {trashIcon()}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul>
              <li>
                <h2 className="relative">合計金額：{total} 円</h2>
                {/* <h3>{mockOrder.reduce}</h3> */}
              </li>
              <li>
                {/* <h2>受領金額：</h2> */}
                <form>
                  {/* <Input
                type="number"
                placeholder="受け取った金額を入力してください"
                value={recieved}
                onChange={(event) => setText(parseInt(event.target.value))}
              /> */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button className="absolute right-[100px]">確定</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          金額を確認してください
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {/* <p>受領額： {recieved} 円</p> */}
                          <p>
                            受領額：
                            <Input
                              type="number"
                              placeholder="受け取った金額を入力してください"
                              value={recieved}
                              onChange={(event) =>
                                setText(Number.parseInt(event.target.value))
                              }
                            />
                          </p>
                          <p>合計： {mockOrder.total} 円</p>
                          <p>
                            お釣り： {recieved - mockOrder.total < 0 && 0}
                            {recieved - mockOrder.total >= 0 &&
                              recieved - mockOrder.total}{" "}
                            円
                          </p>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel type="button">
                          戻る
                        </AlertDialogCancel>
                        <AlertDialogAction
                          type="submit"
                          onClick={() => mockOrderInitialize()}
                        >
                          送信
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </form>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema: itemSchema });

  if (submission.status !== "success") {
    return json(submission.reply());
  }

  const newItem = submission.value;
  // あとでマシなエラーハンドリングにする
  const savedItem = await itemRepository.save(
    ItemEntity.createNew({
      name: newItem.name,
      price: newItem.price,
      type: newItem.type,
    }),
  );

  console.log("Document written with ID: ", savedItem.id);
  return new Response(null, { status: 204 });
};

function trashIcon() {
  return (
    <div>
      <TrashIcon />
    </div>
  );
}

function mockOrderInitialize() {
  mockOrder.items = [];
  mockOrder.total = 0;
  console.log(mockOrder);
}
