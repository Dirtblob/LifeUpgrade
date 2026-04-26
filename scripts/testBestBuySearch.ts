import { existsSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import process from "node:process";
import { config } from "dotenv";
import type { ProductSearchResult } from "@/lib/product-search/types";

type EnvSource = ".env" | ".env.local";
type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;

const QUERIES = [
  "Logitech MX Master 4",
  "Logitech MX Master 3S",
  "Sony WH-1000XM5",
  "Keychron Q5 Max",
  "Herman Miller Aeron",
];

function loadEnvVars(): EnvSource[] {
  const projectRoot = path.resolve(__dirname, "..");
  const envFiles: Array<{ source: EnvSource; filePath: string; override: boolean }> = [
    { source: ".env", filePath: path.join(projectRoot, ".env"), override: false },
    { source: ".env.local", filePath: path.join(projectRoot, ".env.local"), override: true },
  ];
  const loadedFiles: EnvSource[] = [];

  for (const envFile of envFiles) {
    if (!existsSync(envFile.filePath)) continue;

    config({ path: envFile.filePath, override: envFile.override });
    loadedFiles.push(envFile.source);
  }

  return loadedFiles;
}

function definedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function allowServerOnlyMarkerInScript(): void {
  const moduleWithLoad = Module as typeof Module & { _load: ModuleLoad };
  const originalLoad = moduleWithLoad._load;

  // Next aliases this marker on the server; this script runs directly under tsx.
  moduleWithLoad._load = function patchedServerOnlyLoad(this: unknown, request, parent, isMain) {
    if (request === "server-only") return {};
    return Reflect.apply(originalLoad, this, [request, parent, isMain]) as unknown;
  };
}

function displayResult(result: ProductSearchResult) {
  return {
    title: result.title,
    brand: result.brand ?? null,
    model: result.model ?? null,
    priceCents: result.priceCents ?? null,
    productUrl: result.productUrl ?? null,
  };
}

async function main() {
  const loadedFiles = loadEnvVars();
  const apiKey = definedText(process.env.BESTBUY_API_KEY);

  console.log(`Loaded env files: ${loadedFiles.length > 0 ? loadedFiles.join(", ") : "none"}`);
  console.log(`BESTBUY_API_KEY exists: ${Boolean(apiKey)}`);

  if (!apiKey) {
    console.error("Best Buy API is not configured. Add BESTBUY_API_KEY to .env.local or .env.");
    process.exitCode = 1;
    return;
  }

  allowServerOnlyMarkerInScript();

  const { createBestBuyProductSearchProvider } = await import("@/lib/product-search/bestBuyProvider");
  const provider = createBestBuyProductSearchProvider({
    apiKey,
    env: process.env,
    useCache: false,
  });

  for (let i = 0; i < QUERIES.length; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1200));

    const query = QUERIES[i];
    const { status, results } = await provider.searchProductsWithStatus(query, { limit: 20 });

    console.log("");
    console.log(`Query: ${query}`);
    console.log(`Status: ${status}`);
    console.log(`Result count: ${results.length}`);
    if (results.length > 0) {
      console.log("First 5 normalized results:");
      console.log(JSON.stringify(results.slice(0, 5).map(displayResult), null, 2));
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
