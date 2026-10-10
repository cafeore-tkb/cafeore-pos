import { redirect } from "react-router";

// 在庫対象と使用量の設定は商品管理の「在庫」タブにまとめた。古いブックマークのために転送だけ残す
export const clientLoader = () => redirect("/products?tab=stock");

export default function Redirect() {
  return null;
}
