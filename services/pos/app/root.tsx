import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import "./tailwind.css";
import { PrintQueueAlert } from "~/components/molecules/PrintQueueAlert";
import { Toaster } from "~/components/ui/sonner";
import { PrintStationProvider, usePrintStation } from "~/label/PrintStation";
import { OrdersWSProvider } from "./routes/context/OrdersWSContext";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        <Toaster />
        <script src="epos-2.27.0.js" />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <OrdersWSProvider>
      <PrintStationProvider>
        <Outlet />
        <PrintQueueNotice />
      </PrintStationProvider>
    </OrdersWSProvider>
  );
}

// 印刷キューの困りごとは、印刷する端末ではどの画面でも（呼び出し画面を除く）、ほかの端末ではレジとマスターの画面で出す
// （お客さんに見せる呼び出し画面には出さない）
const PrintQueueNotice = () => {
  const { pathname } = useLocation();
  const { enabled } = usePrintStation();
  const shown =
    !pathname.startsWith("/callscreen") &&
    (enabled || pathname === "/cashier" || pathname === "/master");
  return shown ? <PrintQueueAlert /> : null;
};

// TODO(toririm): もっとリッチなローディング画面を作る
export function HydrateFallback() {
  return <p>Loading...</p>;
}
