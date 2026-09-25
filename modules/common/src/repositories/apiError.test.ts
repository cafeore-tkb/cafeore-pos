import { describe, expect, test } from "vitest";
import { throwApiError } from "./item";

describe("[unit] throwApiError", () => {
  test("openapi-fetch が読んだ error を優先する", async () => {
    // openapi-fetch は本文を読み終えているので、response からはもう読めない
    const response = new Response(null, { status: 400 });
    await expect(
      throwApiError(response, "fallback", { error: "invalid order menus" }),
    ).rejects.toThrow("invalid order menus");
  });

  test("error が渡されなければ本文の error を使う", async () => {
    const response = new Response(
      JSON.stringify({ error: "invalid order menus" }),
      { status: 400 },
    );
    await expect(throwApiError(response, "fallback")).rejects.toThrow(
      "invalid order menus",
    );
  });

  test("本文に error が無ければ fallback を使う", async () => {
    const response = new Response(JSON.stringify({}), { status: 500 });
    await expect(throwApiError(response, "fallback", {})).rejects.toThrow(
      "fallback",
    );
  });

  test("本文が JSON でなければ fallback を使う", async () => {
    const response = new Response("<html>Bad Gateway</html>", {
      status: 502,
    });
    await expect(
      throwApiError(response, "fallback", "<html>Bad Gateway</html>"),
    ).rejects.toThrow("fallback");
  });
});
