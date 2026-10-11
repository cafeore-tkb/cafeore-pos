import { apiClient } from "@cafeore/common";
import useSWR from "swr";

type Build = {
  /** PR の番号。プレビューはその PR、本番はマージした PR */
  pr?: number;
  /** コミットの SHA */
  commit?: string;
};

// この画面のビルド。デプロイの workflow（pos-deploy-workers.yml）が焼き込む。
// ローカルの dev・build では両方とも空
const frontendBuild: Build = {
  pr: Number(import.meta.env.VITE_BUILD_PR) || undefined,
  commit: import.meta.env.VITE_BUILD_COMMIT || undefined,
};

/** API のビルド。この項目より前の API は build を返さないので null */
const fetchBackendBuild = async (): Promise<Build | null> => {
  const { data, response } = await apiClient.GET("/status", {
    cache: "no-store",
  });
  if (!data) {
    throw new Error(`Status check failed: ${response.status}`);
  }
  return data.build ?? null;
};

/** 「#889 · 90b89b2」。分からないものは省き、どちらも無ければ（ローカルのビルド）null */
const formatBuild = (build: Build): string | null => {
  const parts: string[] = [];
  if (build.pr) {
    parts.push(`#${build.pr}`);
  }
  if (build.commit) {
    parts.push(build.commit.slice(0, 7));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
};

const backendLabel = (
  build: Build | null | undefined,
  error: unknown,
): string => {
  if (error) {
    return "取得できません";
  }
  if (build === undefined) {
    return "確認中…";
  }
  if (build === null) {
    return "不明";
  }
  return formatBuild(build) ?? "ローカル";
};

/**
 * 画面と API がどの PR・コミットのビルドか。デプロイが反映されたかを確かめるのに使う
 */
export function BuildInfo() {
  const { data, error } = useSWR("status/build", fetchBackendBuild);

  const rows = [
    {
      label: "画面",
      value: formatBuild(frontendBuild) ?? "ローカル",
      commit: frontendBuild.commit,
    },
    {
      label: "API",
      value: backendLabel(data, error),
      commit: data?.commit,
    },
  ];

  return (
    <footer className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground text-xs">
      <span className="font-bold">ビルド</span>
      {rows.map((row) => (
        <span key={row.label}>
          {row.label}{" "}
          <span className="font-mono" title={row.commit}>
            {row.value}
          </span>
        </span>
      ))}
    </footer>
  );
}
