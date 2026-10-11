import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 固定のプリンタだけに中継する。リクエストから中継先を指定させない。
export function createHandler({ origin, printerHost, printerPort = 80 }) {
  return (req, res) => {
    const url = new URL(req.url, "https://127.0.0.1:18443");
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Printer relay running (printer connectivity not checked)");
      return;
    }
    if (req.headers.origin !== origin) {
      res.writeHead(403);
      res.end("Origin not allowed");
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (
      !["/cgi-bin/epos/service.cgi", "/cgi-bin/eposDisp/service.cgi"].includes(
        url.pathname,
      )
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, SOAPAction, If-Modified-Since",
        "Access-Control-Allow-Private-Network": "true",
      });
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    const upstream = http.request(
      {
        hostname: printerHost,
        port: printerPort,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type":
            req.headers["content-type"] || "text/xml; charset=utf-8",
          SOAPAction: req.headers.soapaction || '""',
        },
      },
      (reply) => {
        res.writeHead(reply.statusCode, {
          "Content-Type": reply.headers["content-type"] || "text/xml",
        });
        reply.on("error", () => res.destroy());
        reply.pipe(res);
      },
    );
    upstream.setTimeout(15000, () => upstream.destroy(new Error("Timeout")));
    upstream.on("error", () => {
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(502);
        res.end("Cannot reach printer");
      }
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const dir = new URL("./", import.meta.url);
    const config = JSON.parse(
      readFileSync(new URL("config.json", dir), "utf8"),
    );
    if (new URL(config.origin).origin !== config.origin) {
      throw new Error("origin must be the POS origin without a trailing slash");
    }
    const server = https.createServer(
      {
        cert: readFileSync(new URL("localhost.pem", dir)),
        key: readFileSync(new URL("localhost-key.pem", dir)),
      },
      createHandler(config),
    );
    server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(18443, "127.0.0.1", () => {
      console.log(
        `Relay: https://127.0.0.1:18443 -> http://${config.printerHost}`,
      );
      console.log(`Allowed POS: ${config.origin}. Keep this window open.`);
    });
  } catch (error) {
    console.error(`Setup error: ${error.message}`);
    process.exitCode = 1;
  }
}
