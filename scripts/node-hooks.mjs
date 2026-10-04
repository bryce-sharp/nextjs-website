// Lets plain Node import the app's TypeScript modules, for checks and one-off
// scripts that exercise real app code (lib/plaid, lib/finance, queries) without
// the Next.js server. Resolves "@/..." aliases and extensionless imports,
// stubs "server-only", and maps "next/<subpath>" to its .js file.
//
//   node --env-file=.env.local --import ./scripts/node-hooks.mjs path/to/check.mts
//
// .env.local points at the Neon dev branch, so anything run this way touches
// dev data only.

import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROOT_URL = pathToFileURL(path.join(ROOT, "package.json")).href;

function withExtension(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const isBare = (s) => !/^(\.|\/|node:|data:|file:|@\/)/.test(s);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    const parent = context.parentURL?.startsWith("file://") ? fileURLToPath(context.parentURL) : null;
    let base = null;
    if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent?.startsWith(ROOT) && !parent.includes("/node_modules/")) {
      base = path.resolve(path.dirname(parent), specifier);
    }
    if (base) {
      const file = withExtension(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    // Checks kept outside the project still resolve its packages.
    const ctx = isBare(specifier) && parent && !parent.startsWith(ROOT) ? { ...context, parentURL: ROOT_URL } : context;
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, ctx);
    return nextResolve(specifier, ctx);
  },
});
