/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAFEORE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
