import { parseWithZod } from "@conform-to/zod";
import { type ClientActionFunction, json } from "@remix-run/react";
import { ItemEntity, itemSchema } from "common/models/item";
import { itemRepository } from "common/repositories/item";
import { sendSlackMessage } from "~/lib/webhook";

// TODO(toririm): テストを書く
export const addItem: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const submission = parseWithZod(formData, {
    schema: itemSchema.omit({ assignee: true }),
  });

  if (submission.status !== "success") {
    console.error("Invalid form data", submission.reply());
    return json(submission.reply(), { status: 400 });
  }

  const newItem = ItemEntity.createNew(submission.value);
  const itemSavePromise = itemRepository.save(newItem);
  const webhookSendPromise = sendSlackMessage(
    `新しいアイテムが追加されました！\n${newItem.name}`,
  );
  const [savedItem] = await Promise.all([itemSavePromise, webhookSendPromise]);

  console.log("Document written with ID: ", savedItem.id);
  return json(submission.reply({ resetForm: true }), { status: 200 });
};
