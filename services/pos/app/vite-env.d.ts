/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEBHOOK_URL: string;
  readonly VITE_API_BASE_URL?: string;
  // どの PR・コミットのビルドか。デプロイの workflow が入れる。ローカルでは無い
  readonly VITE_BUILD_PR?: string;
  readonly VITE_BUILD_COMMIT?: string;
  // どこに出したビルドか。本番は production、PR のプレビューは preview。
  // デプロイの workflow が入れる。ローカルでは無い
  readonly VITE_DEPLOY_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
