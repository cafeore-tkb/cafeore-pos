import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import "./tailwind.css";
import { Toaster } from "~/components/ui/sonner";
import { AuthProvider } from "./components/functional/AuthProvider";

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
        <AuthProvider>{children}</AuthProvider>
        <ScrollRestoration />
        <Scripts />
        <Toaster />
        <script src="/epos-2.27.0.js" />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// TODO(toririm): もっとリッチなローディング画面を作る
export function HydrateFallback() {
  return <p>Loading...</p>;
}
