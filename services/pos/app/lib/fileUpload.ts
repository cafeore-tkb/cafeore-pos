import type { OrderEntity } from "@cafeore/common";
import { useState } from "react";

type UploadedOrderData = {
  orders: OrderEntity[];
};

/**
 * ファイルをアップロードしてcreatedAtでソートしたJSONを返す関数
 * @param file アップロードされたファイル
 * @returns Promise<OrderEntity[]> ソートされた注文データ
 */
export const uploadAndSortOrders = async (
  file: File,
): Promise<OrderEntity[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const jsonData = JSON.parse(
          e.target?.result as string,
        ) as UploadedOrderData;

        // createdAtでソート
        const sortedOrders = jsonData.orders.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

        resolve(sortedOrders);
      } catch (error) {
        console.error("JSONファイルの解析に失敗しました:", error);
        reject(
          new Error(
            "JSONファイルの解析に失敗しました。正しい形式のファイルをアップロードしてください。",
          ),
        );
      }
    };

    reader.onerror = () => {
      reject(new Error("ファイルの読み込みに失敗しました。"));
    };

    reader.readAsText(file);
  });
};

/**
 * ソートされたデータからFileオブジェクトを作成する関数
 * @param orders ソートされた注文データ
 * @param originalFileName 元のファイル名
 * @returns File ソートされたデータのFileオブジェクト
 */
const createSortedFile = (
  orders: OrderEntity[],
  originalFileName: string,
): File => {
  const sortedJsonData = { orders };
  const sortedJsonString = JSON.stringify(sortedJsonData, null, 2);
  const sortedBlob = new Blob([sortedJsonString], { type: "application/json" });
  return new File([sortedBlob], `sorted-${originalFileName}`, {
    type: "application/json",
  });
};

/**
 * ファイルアップロード用のフック
 * @param onUploadComplete アップロード完了時のコールバック
 * @returns アップロード関連の状態と関数
 */
export const useFileUpload = (
  onUploadComplete?: (orders: OrderEntity[], sortedFile: File) => void,
) => {
  const [fileName, setFileName] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [sortedFile, setSortedFile] = useState<File | undefined>(undefined);

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError("");
    setFileName(file.name);

    try {
      const sortedOrders = await uploadAndSortOrders(file);
      const sortedFile = createSortedFile(sortedOrders, file.name);

      setSortedFile(sortedFile);

      if (onUploadComplete) {
        onUploadComplete(sortedOrders, sortedFile);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "アップロードに失敗しました",
      );
      setFileName("");
      setSortedFile(undefined);
    } finally {
      setIsLoading(false);
    }
  };

  const resetUpload = () => {
    setFileName("");
    setError("");
    setSortedFile(undefined);
  };

  return {
    fileName,
    isLoading,
    error,
    sortedFile,
    handleFileUpload,
    resetUpload,
  };
};
