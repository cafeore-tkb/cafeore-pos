import { describe, expect, test } from "vitest";
import { deliverNotices, deliverTone } from "./deliver";

describe("[unit] deliverNotices", () => {
  test("one line per order, with the order number in three digits", () => {
    const notices = deliverNotices([
      { id: "a", order_id: 12, call: "called" },
      { id: "b", order_id: 13, call: "finishing" },
    ]);
    expect(notices.map(({ label, text }) => `${label}${text}`)).toEqual([
      "#012を呼び出しました",
      "#013は提供で仕上げます",
    ]);
  });

  test("asking serve for help is the strongest tone", () => {
    const tone = (
      ...calls: ("called" | "finishing" | "waiting" | "already")[]
    ) =>
      deliverTone(
        deliverNotices(
          calls.map((call, i) => ({ id: `${i}`, order_id: i, call })),
        ),
      );
    expect(tone("called", "finishing")).toBe("ask");
    expect(tone("called", "waiting")).toBe("good");
    expect(tone("waiting", "already")).toBe("info");
  });
});
