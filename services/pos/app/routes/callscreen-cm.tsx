import { redirect } from "react-router";

// 呼び出し画面の CM と音の設定は、呼び出し画面（/callscreen）を開いたときの設定の画面に移した。古いブックマークのために転送だけ残す
export const clientLoader = () => redirect("/callscreen");

export default function Redirect() {
  return null;
}
