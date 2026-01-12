import { itemResponseRepository, itemResponseSchema } from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { redirect } from "@remix-run/react";
import { type ClientActionFunction, json } from "@remix-run/react";

export const addItem: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const submission = parseWithZod(formData, { schema: itemResponseSchema });

  if (submission.status !== "success") {
    console.error("Invalid form data", submission.reply());
    return json(submission.reply(), { status: 400 });
  }

  const newItem = itemResponseSchema.parse({
    name: submission.value.name,
    abbr: submission.value.abbr,
    key: submission.value.key,
    item_type_id: submission.value.item_type_id,
  });
  const itemSavePromise = itemResponseRepository.save(newItem);
  // // // const webhookSendPromise = sendSlackMessage(
  // // //   `新しいアイテムが追加されました！\n${newItem.name}`,
  // // // );
  // // const [savedItem] = await Promise.all([itemSavePromise, webhookSendPromise]);

  // console.log("Document written with ID: ", savedItem.id);

  return redirect("/items/");
};
