/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOHOSAI_VOTE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
