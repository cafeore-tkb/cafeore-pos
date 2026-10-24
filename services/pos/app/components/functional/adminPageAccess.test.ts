import { describe, expect, test } from "vitest";
import { adminPageAccess } from "./adminPageAccess";
import type { Permission } from "./usePermission";

type Me = Extract<Permission, { status: "ok" }>["me"];

/** API が弾く設定で、管理者として届いた結果。me の一部を変えて使う */
const ok = (me: Partial<Me> = {}): Permission => ({
  status: "ok",
  me: {
    enforcement: "enforce",
    email: "admin@example.com",
    role: "admin",
    ...me,
  },
});

const access = (
  permission: Permission | undefined,
  error: unknown = undefined,
  shouldFetch = true,
) => adminPageAccess({ shouldFetch, permission, error });

describe("[unit] adminPageAccess", () => {
  test("プレビューとローカルでは聞かずに開ける", () => {
    expect(access(undefined, undefined, false)).toBe("allow");
    expect(access(undefined, new Error("failed"), false)).toBe("allow");
    expect(access({ status: "forbidden" }, undefined, false)).toBe("allow");
    expect(access(ok({ role: "staff" }), undefined, false)).toBe("allow");
  });

  test("聞いている間は確認中、聞けなければエラー", () => {
    expect(access(undefined)).toBe("checking");
    expect(access(undefined, new Error("failed"))).toBe("error");
  });

  test("前に聞けた結果があれば、聞き直しに失敗してもそれで決める", () => {
    expect(access(ok(), new Error("failed"))).toBe("allow");
    expect(access(ok({ role: "staff" }), new Error("failed"))).toBe("deny");
  });

  test("ログインが切れていれば expired", () => {
    expect(access({ status: "expired" })).toBe("expired");
  });

  test("許可リストに無い（403）なら開けない", () => {
    expect(access({ status: "forbidden" })).toBe("deny");
  });

  test("API が弾かない設定（off・report-only）なら誰でも開ける", () => {
    expect(access(ok({ enforcement: "off", email: null, role: null }))).toBe(
      "allow",
    );
    for (const role of ["admin", "staff", "viewer", "none"] as const) {
      expect(access(ok({ enforcement: "report-only", role }))).toBe("allow");
    }
  });

  test("API が弾く設定では管理者だけが開ける", () => {
    expect(access(ok())).toBe("allow");
    for (const role of ["staff", "viewer", "none", null] as const) {
      expect(access(ok({ role }))).toBe("deny");
    }
  });
});
