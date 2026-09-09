/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEBHOOK_URL: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PR_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
