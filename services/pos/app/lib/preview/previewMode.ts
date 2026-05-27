const PREVIEW_MOCK_ENV_KEY = "VITE_POS_PREVIEW_MOCK";

const isPagesPreviewHost = (hostname: string) => {
  return hostname.endsWith(".pages.dev");
};

/**
 * Preview 用のローカルモックモード判定
 *
 * 優先順位:
 * 1. VITE_POS_PREVIEW_MOCK=true/false
 * 2. Cloudflare Pages の preview host かつ production build
 */
export const isPreviewMockEnabled = (): boolean => {
  const raw = import.meta.env[PREVIEW_MOCK_ENV_KEY];
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return import.meta.env.PROD && isPagesPreviewHost(window.location.hostname);
};
