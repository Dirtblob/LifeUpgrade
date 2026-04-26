import { ObjectId, type Filter } from "mongodb";
import { NextResponse } from "next/server";
import { getMongoDatabase } from "@/lib/mongodb";
import { searchBestBuyProducts, type BestBuyDiscoveryProduct } from "@/lib/productDiscovery/bestBuyProducts";

interface DeviceCatalogDocument {
  _id: ObjectId | string;
  id?: unknown;
  slug?: unknown;
  category?: unknown;
  subcategory?: unknown;
  brand?: unknown;
  model?: unknown;
  variant?: unknown;
  aliases?: unknown;
  priceTier?: unknown;
  precomputedTraits?: unknown;
  ergonomicSpecs?: unknown;
  searchText?: unknown;
}

interface FrontendDeviceOption {
  id: string;
  slug: string;
  category: string;
  subcategory: string | null;
  brand: string;
  model: string;
  variant: string | null;
  aliases: string[];
  priceTier: string | null;
  precomputedTraits: Record<string, unknown> | null;
  ergonomicSpecs: Record<string, unknown> | null;
}

type FrontendDiscoveryProduct = BestBuyDiscoveryProduct;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeDevice(document: DeviceCatalogDocument): FrontendDeviceOption | null {
  const id = typeof document._id === "string" ? document._id : document._id.toHexString();
  const slug = stringValue(document.slug) ?? stringValue(document.id) ?? id;
  const category = stringValue(document.category);
  const brand = stringValue(document.brand);
  const model = stringValue(document.model);

  if (!category || !brand || !model) return null;

  return {
    id,
    slug,
    category,
    subcategory: stringValue(document.subcategory),
    brand,
    model,
    variant: stringValue(document.variant),
    aliases: stringArrayValue(document.aliases),
    priceTier: stringValue(document.priceTier),
    precomputedTraits: objectValue(document.precomputedTraits),
    ergonomicSpecs: objectValue(document.ergonomicSpecs),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q")?.trim() ?? "";
  const category = searchParams.get("category")?.trim() ?? "";
  const brand = searchParams.get("brand")?.trim() ?? "";
  const id = searchParams.get("id")?.trim() ?? "";
  const limit = clampLimit(searchParams.get("limit"));

  try {
    const database = await getMongoDatabase();
    const collection = database.collection<DeviceCatalogDocument>("device_catalog");
    const filter: Filter<DeviceCatalogDocument> = {};

    if (id) {
      const idFilters: Filter<DeviceCatalogDocument>[] = [{ _id: id }, { slug: id }, { id }];
      if (ObjectId.isValid(id)) {
        idFilters.push({ _id: new ObjectId(id) });
      }
      filter.$or = idFilters;
    } else {
      if (category) {
        filter.category = { $regex: `^${escapeRegex(category)}$`, $options: "i" };
      }

      if (brand) {
        filter.brand = { $regex: `^${escapeRegex(brand)}$`, $options: "i" };
      }

      if (query) {
        const tokens = query
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean);

        filter.$and = tokens.map((token) => {
          const regex = { $regex: escapeRegex(token), $options: "i" };
          return {
            $or: [
              { brand: regex },
              { model: regex },
              { variant: regex },
              { aliases: regex },
              { searchText: regex },
              { category: regex },
            ],
          };
        });
      }
    }

    const devices = (await collection.find(filter).sort({ brand: 1, model: 1, variant: 1 }).limit(limit).toArray())
      .map(serializeDevice)
      .filter((device): device is FrontendDeviceOption => Boolean(device));

    // Best Buy Products API is only for dropdown product discovery. MongoDB device_catalog remains
    // the rated/recommendable device source used by scoring and recommendation flows.
    const discoveryProducts: FrontendDiscoveryProduct[] =
      !id && query
        ? await searchBestBuyProducts({
            query,
            category,
            limit: Math.min(12, limit),
          })
        : [];

    return NextResponse.json({ devices, discoveryProducts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load devices.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
