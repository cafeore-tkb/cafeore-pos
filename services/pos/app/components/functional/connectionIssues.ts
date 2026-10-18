/**
 * つながっていないもの。画面の上のバーの文言と、レジのヘッダーの短い表示に使う
 */
export type ConnectionIssue = {
  key: "backend" | "database" | "internet" | "websocket";
  /** レジのヘッダーに出す短い表示 */
  label: string;
  /** バーに出す文 */
  message: string;
  /** error は操作が反映されない（赤）、warning は画面が古いかもしれない（橙） */
  tone: "error" | "warning";
};

type Status = {
  isBackendOnline: boolean | null;
  isDatabaseOnline: boolean | null;
  isDeviceOnline: boolean;
  isInternetConnectionRequired: boolean;
  /** つながっているのに WebSocket が切れている */
  isWsDisconnected: boolean;
};

export const connectionIssues = ({
  isBackendOnline,
  isDatabaseOnline,
  isDeviceOnline,
  isInternetConnectionRequired,
  isWsDisconnected,
}: Status): ConnectionIssue[] => {
  const issues: ConnectionIssue[] = [];
  if (isBackendOnline === false) {
    issues.push({
      key: "backend",
      label: "バックエンド未接続",
      message: "バックエンドに接続できません。操作は反映されません",
      tone: "error",
    });
  }
  if (isBackendOnline && isDatabaseOnline === false) {
    issues.push({
      key: "database",
      label: "データベース未接続",
      message: "データベースに接続できません。操作は反映されません",
      tone: "error",
    });
  }
  if (isInternetConnectionRequired && !isDeviceOnline) {
    issues.push({
      key: "internet",
      label: "インターネット未接続",
      message: "インターネットに接続されていません。操作は反映されません",
      tone: "error",
    });
  }
  if (isWsDisconnected) {
    issues.push({
      key: "websocket",
      label: "サーバー再接続中",
      message: "サーバーと再接続中です。画面が最新でない可能性があります",
      tone: "warning",
    });
  }
  return issues;
};

/** 子のルートが handle に付けると、バーを細いまま色だけにし、文言は出さない（その画面が自分で出す） */
export type StatusBarHandle = { compactStatusBar?: boolean };

/** _header が子のルートに渡すもの（useOutletContext） */
export type HeaderOutletContext = { connectionIssues: ConnectionIssue[] };
