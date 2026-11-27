import { build } from "esbuild";
await build({
  entryPoints: { app: "src/main.jsx" },
  bundle: true, minify: true, format: "iife", target: ["es2019", "safari13"],
  outdir: ".", entryNames: "[name]", legalComments: "none",
  loader: { ".jsx": "jsx" }, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
console.log("build ok");
