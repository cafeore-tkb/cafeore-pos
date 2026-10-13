import { describe, expect, test } from "vitest";
import { connectionIssues } from "./connectionIssues";

const online = {
  isBackendOnline: true,
  isDatabaseOnline: true,
  isDeviceOnline: true,
  isInternetConnectionRequired: true,
  isWsDisconnected: false,
};

const keys = (status: Partial<typeof online>) =>
  connectionIssues({ ...online, ...status }).map((issue) => issue.key);

describe("[unit] connectionIssues", () => {
  test("つながっていれば何も出さない", () => {
    expect(keys({})).toEqual([]);
  });

  test("バックエンドに届かなければ、データベースは分からないので出さない", () => {
    expect(keys({ isBackendOnline: false, isDatabaseOnline: null })).toEqual([
      "backend",
    ]);
    expect(keys({ isDatabaseOnline: false })).toEqual(["database"]);
  });

  test("インターネットは、要るときだけ見る", () => {
    expect(keys({ isDeviceOnline: false })).toEqual(["internet"]);
    expect(
      keys({ isDeviceOnline: false, isInternetConnectionRequired: false }),
    ).toEqual([]);
  });

  test("WebSocket が切れているときは橙で出す", () => {
    const [issue] = connectionIssues({ ...online, isWsDisconnected: true });
    expect(issue.label).toBe("サーバー再接続中");
    expect(issue.tone).toBe("warning");
  });
});
