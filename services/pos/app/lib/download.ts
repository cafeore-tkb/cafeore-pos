/** Blob をファイルとしてブラウザに保存させる */
export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // すぐ捨てると Safari やヘッドレスのブラウザでダウンロードが途中で止まるので、少しあとにする
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
