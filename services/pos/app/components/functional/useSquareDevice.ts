import { type SquareDevice, squareRepository } from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

/** このレジで使う Square 端末の device_id を覚えておくキー */
const STORAGE_KEY = "cafeore:square-device-id";

const loadDeviceId = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const storeDeviceId = (deviceId: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    // 覚えておけなくても、このページを開いている間は使える
  }
};

/** ペアリング済みで、決済に使える端末 */
export type PairedSquareDevice = SquareDevice & { device_id: string };

const isPaired = (device: SquareDevice): device is PairedSquareDevice =>
  device.status === "PAIRED" && typeof device.device_id === "string";

export type SquareDeviceSelection = {
  /** 選べる端末（ペアリング済みのもの） */
  devices: PairedSquareDevice[];
  /** このレジで使う端末。決まっていなければ null で、Square のボタンを出さない */
  device: PairedSquareDevice | null;
  /** 選んでいた端末が一覧から外されている */
  missing: boolean;
  select: (deviceId: string) => void;
};

/**
 * このレジで使う Square 端末
 *
 * 端末はレジごとに固定する。選んだ端末の device_id をブラウザに覚えておき、
 * 決済のたびには選ばない。まだ選んでいなくて、端末が 1 台しか無ければその端末を使う。
 *
 * 選んでいた端末が一覧から外されたら、残りが 1 台でもその端末は使わない
 * （別のレジの端末に決済画面を出さないため）。選び直してもらう。
 */
export const useSquareDevice = (enabled: boolean): SquareDeviceSelection => {
  const { data } = useSWR(
    enabled ? "square-devices" : null,
    squareRepository.listDevices,
  );
  const [selectedId, setSelectedId] = useState<string | null>(loadDeviceId);

  const devices = useMemo(() => (data ?? []).filter(isPaired), [data]);

  const selected =
    selectedId === null
      ? null
      : (devices.find((device) => device.device_id === selectedId) ?? null);
  const fallback =
    selectedId === null && devices.length === 1 ? devices[0] : null;

  const select = useCallback((deviceId: string) => {
    storeDeviceId(deviceId);
    setSelectedId(deviceId);
  }, []);

  return {
    devices,
    device: selected ?? fallback,
    // 一覧を取れるまでは、外されたかどうか分からない
    missing: data !== undefined && selectedId !== null && selected === null,
    select,
  };
};
