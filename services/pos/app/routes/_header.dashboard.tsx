import type { MetaFunction } from "react-router";
import { AdminOnly } from "~/components/functional/AdminOnly";
import { DashboardWorkspace } from "~/components/organisms/dashboard/DashboardWorkspace";

export const meta: MetaFunction = () => {
  return [{ title: "ダッシュボード / 珈琲・俺POS" }];
};

// 本番では管理者だけが開ける
export default function DashboardRoute() {
  return (
    <AdminOnly>
      <Dashboard />
    </AdminOnly>
  );
}

function Dashboard() {
  return <DashboardWorkspace />;
}
