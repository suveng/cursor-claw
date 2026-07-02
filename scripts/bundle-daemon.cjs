const { build } = require("esbuild");
const path = require("path");

const fs = require("fs");
const pkg = require(path.resolve(__dirname, "../package.json"));
const pkgJson = JSON.stringify(pkg);

// 匹配 require("../package.json")、_require("../../package.json") 等相对路径变体
const PACKAGE_JSON_REQUIRE_RE =
  /\w+\(["'](?:\.\.\/)+package\.json["']\)/g;

const inlinePackageJson = {
  name: "inline-package-json",
  setup(b) {
    b.onLoad({ filter: /\.(js|ts)$/ }, async (args) => {
      const contents = fs.readFileSync(args.path, "utf8");
      const inlined = contents.replace(PACKAGE_JSON_REQUIRE_RE, pkgJson);
      if (inlined !== contents) {
        return { contents: inlined, loader: "js" };
      }
    });
  },
};

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  banner: {
    js: [
      "import { createRequire as _cr } from 'module';",
      "import { fileURLToPath as _f2p } from 'url';",
      "import { dirname as _dn } from 'path';",
      "const require = _cr(import.meta.url);",
      "const __filename = _f2p(import.meta.url);",
      "const __dirname = _dn(__filename);",
    ].join(" "),
  },
  plugins: [inlinePackageJson],
};

async function main() {
  await build({
    ...common,
    entryPoints: [path.resolve(__dirname, "../dist/daemon-entry.js")],
    outfile: path.resolve(__dirname, "../dist-bundle/daemon-entry.mjs"),
  });
  console.log("✓ daemon-entry.mjs bundled to dist-bundle/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
