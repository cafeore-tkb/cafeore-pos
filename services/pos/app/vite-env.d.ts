/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEBHOOK_URL: string;
  readonly VITE_API_BASE_URL?: string;
  // どの PR・コミットのビルドか。デプロイの workflow が入れる。ローカルでは無い
  readonly VITE_BUILD_PR?: string;
  readonly VITE_BUILD_COMMIT?: string;
  // PR のプレビューのビルドなら "true"。pos-deploy-workers.yml が入れる。本番とローカルでは無い
  readonly VITE_BUILD_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
