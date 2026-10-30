/** blob をファイルとして保存させる */
export const saveBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // ブラウザがダウンロードを開始してから解放する。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
