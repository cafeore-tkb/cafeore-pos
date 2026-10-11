import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { createHandler } from "./server.mjs";

test("relay forwards XML and query, handles preflight, and rejects other origins/paths", async (t) => {
  const requests = [];
  const printer = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body, headers: req.headers });
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end('<response success="true"/>');
  });
  printer.listen(0, "127.0.0.1");
  await once(printer, "listening");
  t.after(() => printer.close());
  const origin = "https://pos.example.com";
  const relay = http.createServer(
    createHandler({
      origin,
      printerHost: "127.0.0.1",
      printerPort: printer.address().port,
    }),
  );
  relay.listen(0, "127.0.0.1");
  await once(relay, "listening");
  t.after(() => relay.close());
  const base = `http://127.0.0.1:${relay.address().port}`;
  const path = "/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000";
  const preflight = await fetch(base + path, {
    method: "OPTIONS",
    headers: { Origin: origin },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(
    preflight.headers.get("access-control-allow-headers"),
    /SOAPAction/,
  );
  assert.equal(requests.length, 0);
  const result = await fetch(base + path, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '""',
    },
    body: "<print>テスト</print>",
  });
  assert.equal(await result.text(), '<response success="true"/>');
  assert.equal(result.headers.get("access-control-allow-origin"), origin);
  assert.equal(requests[0].path, path);
  assert.equal(requests[0].body, "<print>テスト</print>");
  assert.equal(requests[0].headers.soapaction, '""');
  assert.equal(
    (
      await fetch(base + path, {
        method: "POST",
        headers: { Origin: "https://other.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/admin`, {
        method: "POST",
        headers: { Origin: origin },
      })
    ).status,
    404,
  );
  assert.equal(requests.length, 1);
  await new Promise((resolve) => printer.close(resolve));
  const failed = await fetch(base + path, {
    method: "POST",
    headers: { Origin: origin },
    body: "<print/>",
  });
  assert.equal(failed.status, 502);
});
