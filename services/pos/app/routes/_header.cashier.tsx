import {
  OrderEntity,
  cashierRepository,
  orderRepository,
  orderSchema,
  stringToJSONSchema,
  useItemMaster,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { useCallback, useMemo } from "react";
import type { ClientActionFunction, MetaFunction } from "react-router";
import { z } from "zod";
import { useAuth } from "~/components/functional/AuthProvider";
import { useFlaggedSubmit } from "~/components/functional/useFlaggedSubmit";
import { CashierV2 } from "~/components/pages/CashierV2";
import { getPreviewSeedItems } from "~/lib/preview/itemSeeds";
import {
  savePreviewSubmittedOrder,
  syncPreviewEditingOrder,
} from "~/lib/preview/localOrderStore";
import { isPreviewMockEnabled } from "~/lib/preview/previewMode";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "レジ / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function Cashier() {
  const user = useAuth();
  const disableFirebase = useMemo(() => user == null, [user]);
  const previewMockEnabled = useMemo(() => isPreviewMockEnabled(), []);
  const { items } = useItemMaster();
  const effectiveItems = useMemo(() => {
    if (previewMockEnabled && items.length === 0) {
      return getPreviewSeedItems();
    }
    return items;
  }, [previewMockEnabled, items]);
  const { orders, status } = useOrdersWSContext();
  const submit = useFlaggedSubmit({ disableFirebase });

  const submitPayload = useCallback(
    (newOrder: OrderEntity) => {
      if (previewMockEnabled) {
        savePreviewSubmittedOrder(newOrder);
        return;
      }
      submit(
        { newOrder: JSON.stringify(newOrder.toOrder()) },
        { method: "POST" },
      );
    },
    [previewMockEnabled, submit],
  );

  const syncOrder = useCallback(
    (order: OrderEntity) => {
      if (previewMockEnabled) {
        syncPreviewEditingOrder(order);
        return;
      }
      submit({ syncOrder: JSON.stringify(order.toOrder()) }, { method: "PUT" });
    },
    [previewMockEnabled, submit],
  );

  return (
    <CashierV2
      items={effectiveItems}
      orders={orders}
      wsStatus={status}
      submitPayload={submitPayload}
      syncOrder={syncOrder}
    />
  );
}

// TODO(toririm): リファクタリングするときにファイルを切り出す
export const clientAction: ClientActionFunction = async (args) => {
  const method = args.request.method;
  switch (method) {
    case "POST":
      return submitOrderAction(args);
    case "PUT":
      return syncOrderAction(args);
    default:
      return new Response("Method not allowed", { status: 405 });
  }
};

export const submitOrderAction: ClientActionFunction = async ({ request }) => {
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

  const cashierState = await cashierRepository.get();
  if (cashierState == null) {
    return console.log("cashierState is null");
  }
  await cashierRepository.set({
    ...cashierState,
    submittedOrderId: savedOrder.id,
  });

  return new Response("ok");
};

export const syncOrderAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const schema = z.object({
    syncOrder: stringToJSONSchema.pipe(orderSchema),
  });
  const submission = parseWithZod(formData, {
    schema,
  });
  if (submission.status !== "success") {
    console.error(submission.error);
    return submission.reply();
  }

  const { syncOrder } = submission.value;

  cashierRepository.set({
    id: "cashier-state",
    edittingOrder: OrderEntity.fromOrder(syncOrder),
    submittedOrderId: null,
  });

  return new Response("ok");
};
