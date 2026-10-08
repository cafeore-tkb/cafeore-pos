// data/colorSettings.ts
import useSWR from "swr";
import { colorSettingRepository } from "../repositories";

const COLOR_SETTINGS_KEY = "color-settings";

const fetchColorSettings = async () => colorSettingRepository.findAll();

/**
 * 背景色設定を取得する
 * enabled が false のときは取得しない（背景色を使わない画面で無駄に叩かないため）
 */
export const useColorSettings = (enabled = true) => {
  const {
    data: colorSettings = [],
    error,
    isLoading,
    mutate,
  } = useSWR(enabled ? COLOR_SETTINGS_KEY : null, fetchColorSettings);

  return {
    colorSettings,
    error,
    isLoading,
    mutateColorSettings: mutate,
  };
};
