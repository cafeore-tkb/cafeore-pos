import type { MetaFunction } from "react-router";
import { DashboardWorkspace } from "~/components/organisms/dashboard/DashboardWorkspace";

export const meta: MetaFunction = () => {
  return [{ title: "ダッシュボード / 珈琲・俺POS" }];
};

export default function Dashboard() {
  return <DashboardWorkspace />;
}
