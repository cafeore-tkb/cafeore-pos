import { type ClientLoaderFunction, useLoaderData } from "@remix-run/react";

/**
 * clientLoader のデータを JSON にシリアライズせずに直接取得する関数
 */
export const useClientLoaderData = <T extends ClientLoaderFunction>() =>
  useLoaderData<T>() as Awaited<ReturnType<T>>;
