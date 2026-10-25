import { redirect } from "react-router";

// 商品のキーは商品管理のメニューの「キーをキャプチャ」に移した。古いブックマークのために転送だけ残す
export const clientLoader = () => redirect("/products?tab=menus");

export default function Redirect() {
  return null;
}
