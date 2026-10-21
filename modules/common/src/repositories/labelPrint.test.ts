import { describe, expect, test } from "vitest";
import { labelPrintRequestResult } from "./labelPrint";

describe("[unit] labelPrintRequestResult", () => {
  test("受け取ってもらえたら requested", () => {
    expect(labelPrintRequestResult(204)).toBe("requested");
    expect(labelPrintRequestResult(200)).toBe("requested");
  });

  test("淹れ直しが消えていたら（410）gone。端末はシールを捨てる", () => {
    expect(labelPrintRequestResult(410)).toBe("gone");
  });

  test("つながらない・断られた・ルートが無い（404）なら retry。間をあけて頼み直す", () => {
    for (const status of [
      undefined,
      0,
      400,
      401,
      403,
      404,
      409,
      429,
      500,
      502,
      503,
    ]) {
      expect(labelPrintRequestResult(status)).toBe("retry");
    }
  });
});
