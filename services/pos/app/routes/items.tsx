import { Outlet } from "react-router";
import { ItemsPageHeader } from "../components/organisms/itemsPageHeader";

export default function ItemsLayout() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-4">
      <ItemsPageHeader />
      <Outlet />
    </div>
  );
}
