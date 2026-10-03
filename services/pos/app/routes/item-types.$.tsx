import { redirect } from "react-router";

// 商品管理は /products にまとめた。古いブックマークのために転送だけ残す
export const clientLoader = () => redirect("/products?tab=item-types");

export default function Redirect() {
  return null;
}
