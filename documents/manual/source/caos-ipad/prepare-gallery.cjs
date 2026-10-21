const fs = require("node:fs");
const path = require("node:path");
const repo = path.resolve(__dirname, "../../../..");
const pos = path.join(repo, "services/pos");
const out = process.env.GALLERY_DIR || "/tmp/cafeore-manual-gallery";
const esbuild = require(
  require.resolve("esbuild", {
    paths: [require.resolve("vite", { paths: [pos] })],
  }),
);
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(pos, "build/client/assets"), path.join(out, "assets"), {
  recursive: true,
});
fs.cpSync(
  path.resolve(__dirname, "../../images/caos-ipad/icon-uses"),
  path.join(out, "icon-uses"),
  { recursive: true },
);
fs.cpSync(path.join(pos, "app/caos/icons"), path.join(out, "svg"), {
  recursive: true,
});
let html = fs.readFileSync(path.join(__dirname, "gallery.html"), "utf8");
for (const prefix of ["root-", "useFixedViewport-"]) {
  const css = fs
    .readdirSync(path.join(out, "assets"))
    .find((f) => f.startsWith(prefix) && f.endsWith(".css"));
  if (!css) throw Error(`CSS not found: ${prefix}`);
  html = html.replace(
    new RegExp(`/assets/${prefix}[^" ]+\\.css`, "g"),
    `/assets/${css}`,
  );
}
fs.writeFileSync(path.join(out, "gallery.html"), html);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "gallery.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: {
    react: path.join(pos, "node_modules/react"),
    "react-dom": path.join(pos, "node_modules/react-dom"),
    "lucide-react": path.join(pos, "node_modules/lucide-react"),
  },
  loader: { ".svg": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  outfile: path.join(out, "gallery.js"),
  tsconfig: path.join(pos, "tsconfig.json"),
});
console.log(`Gallery ready: ${out}`);
