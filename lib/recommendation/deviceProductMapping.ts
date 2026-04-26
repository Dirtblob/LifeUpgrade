import type { AvailabilityProductModel } from "@/lib/availability";
import type { MongoCatalogDevice } from "@/lib/devices/mongoDeviceCatalog";
import type { DeviceTraitRatings } from "@/lib/devices/deviceTypes";
import { PRODUCT_CATEGORIES, type Product, type ProductCategory, type UserProblem } from "./types";

const productCategorySet = new Set<string>(PRODUCT_CATEGORIES);

const categoryProblemDefaults: Record<ProductCategory, UserProblem[]> = {
  laptop: ["slow_computer", "low_productivity"],
  monitor: ["eye_strain", "low_productivity", "poor_focus", "neck_pain"],
  laptop_stand: ["neck_pain", "back_pain", "clutter", "small_space"],
  keyboard: ["wrist_pain", "low_productivity", "clutter"],
  mouse: ["wrist_pain", "low_productivity"],
  chair: ["back_pain", "neck_pain", "poor_focus"],
  desk_lamp: ["bad_lighting", "eye_strain", "poor_focus"],
  headphones: ["poor_focus", "noise_sensitivity", "low_productivity"],
  webcam: ["low_productivity", "bad_lighting"],
  storage: ["clutter", "slow_computer", "low_productivity"],
  cable_management: ["clutter", "small_space", "poor_focus"],
};

const categoryEstimatedPriceCents: Record<ProductCategory, number> = {
  laptop: 99900,
  monitor: 29900,
  laptop_stand: 3999,
  keyboard: 8999,
  mouse: 6999,
  chair: 34900,
  desk_lamp: 5999,
  headphones: 19900,
  webcam: 7999,
  storage: 6999,
  cable_management: 4999,
};

function toProductCategory(category: string): ProductCategory | null {
  if (productCategorySet.has(category)) return category as ProductCategory;
  if (category === "earbuds") return "headphones";
  if (category === "external_storage") return "storage";
  if (category === "docking_station" || category === "monitor_arm") return "cable_management";
  return null;
}

function maxTrait(traits: DeviceTraitRatings, names: string[], fallback = 50): number {
  const values = names.map((name) => traits[name]).filter((value): value is number => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : fallback;
}

function hintFromTraits(traits: DeviceTraitRatings, names: string[], fallback = 5): number {
  return Math.max(1, Math.min(10, Math.round(maxTrait(traits, names, fallback * 10) / 10)));
}

function traitDrivenProblems(device: MongoCatalogDevice, category: ProductCategory): UserProblem[] {
  const traits = device.traitRatings;
  const problems = new Set<UserProblem>(categoryProblemDefaults[category]);

  if (maxTrait(traits, ["eyeComfort", "textClarity", "displayQuality"], 0) >= 68) problems.add("eye_strain");
  if (maxTrait(traits, ["ergonomics", "ergonomicSupport", "adjustability", "deskSpaceFit"], 0) >= 68) {
    problems.add("neck_pain");
  }
  if (maxTrait(traits, ["wristComfort", "typingComfort", "ergonomicSupport"], 0) >= 68) problems.add("wrist_pain");
  if (maxTrait(traits, ["backSupport", "lumbarSupport", "longSessionComfort"], 0) >= 68) problems.add("back_pain");
  if (maxTrait(traits, ["cpuSpeed", "ramHeadroom", "storageHeadroom", "speed"], 0) >= 70) problems.add("slow_computer");
  if (maxTrait(traits, ["productivity", "screenWorkspace", "codingSuitability", "callQuality"], 0) >= 68) {
    problems.add("low_productivity");
  }
  if (maxTrait(traits, ["focusSupport", "noiseIsolation", "activeNoiseCanceling"], 0) >= 65) problems.add("poor_focus");
  if (maxTrait(traits, ["noiseIsolation", "activeNoiseCanceling", "noiseQuietness", "quietness"], 0) >= 65) {
    problems.add("noise_sensitivity");
  }
  if (maxTrait(traits, ["portConvenience", "setupSimplicity", "spaceEfficiency", "deskSpaceFit"], 0) >= 68) {
    problems.add("clutter");
  }
  if (maxTrait(traits, ["deskCoverage", "lowLightPerformance", "eyeComfort"], 0) >= 68) problems.add("bad_lighting");
  if (maxTrait(traits, ["sizeEfficiency", "spaceEfficiency", "deskSpaceFit", "portability"], 0) >= 72) {
    problems.add("small_space");
  }

  return [...problems];
}

function requiredDeskWidth(device: MongoCatalogDevice, category: ProductCategory): number | undefined {
  const width = Number(device.normalizedSpecs.widthInches ?? device.specs.widthInches);
  if (Number.isFinite(width) && width > 0) return Math.round(width);

  const size = Number(device.normalizedSpecs.sizeInches ?? device.specs.sizeInches);
  if (category === "monitor" && Number.isFinite(size) && size > 0) return Math.round(size * 1.45);
  if (category === "laptop_stand") return device.normalizedSpecs.portable ? 28 : 34;
  if (category === "keyboard") return device.normalizedSpecs.portable ? 28 : 40;
  if (category === "chair") return 30;

  return undefined;
}

function isQuiet(device: MongoCatalogDevice): boolean {
  const normalized = device.normalizedSpecs;
  if (normalized.quiet === true) return true;
  if (normalized.loud === true) return false;

  const traits = device.traitRatings;
  const quietness = maxTrait(traits, ["noiseQuietness", "quietness", "noiseIsolation"], 0);
  const noise = traits.noise;

  return quietness >= 62 || (Number.isFinite(noise) && noise <= 42);
}

export function deviceToRecommendationProduct(device: MongoCatalogDevice): Product | null {
  const category = toProductCategory(device.category);
  if (!category) return null;

  const traits = device.traitRatings;
  const estimatedPriceCents = device.estimatedPriceCents || device.typicalUsedPriceCents || categoryEstimatedPriceCents[category];
  const priceUsd = Math.round(estimatedPriceCents / 100);
  const strengths = device.strengths.length > 0 ? device.strengths : [`Strong ${category.replaceAll("_", " ")} trait fit`];

  return {
    id: device._id,
    name: device.displayName,
    brand: device.brand,
    category,
    priceUsd,
    estimatedPriceCents: device.estimatedPriceCents,
    typicalUsedPriceCents: device.typicalUsedPriceCents,
    shortDescription: strengths.join("; ") + ".",
    strengths,
    solves: traitDrivenProblems(device, category),
    aspirational: priceUsd >= 900,
    constraints: {
      minDeskWidthInches: requiredDeskWidth(device, category),
      portable: device.normalizedSpecs.portable === true || maxTrait(traits, ["portability"], 0) >= 72,
      quiet: isQuiet(device),
    },
    ergonomicSpecs: device.ergonomicSpecs,
    normalizedSpecs: device.normalizedSpecs,
    traitRatings: device.traitRatings,
    traitConfidence: device.traitConfidence,
    catalogDeviceId: device.id,
    scoreHints: {
      comfort: hintFromTraits(traits, [
        "comfort",
        "typingComfort",
        "wristComfort",
        "longSessionComfort",
        "eyeComfort",
        "backSupport",
      ]),
      productivity: hintFromTraits(traits, [
        "productivity",
        "screenWorkspace",
        "codingSuitability",
        "callQuality",
        "speed",
        "cpuSpeed",
      ]),
      accessibility: hintFromTraits(traits, [
        "accessibility",
        "ergonomics",
        "ergonomicSupport",
        "adjustability",
        "setupSimplicity",
      ]),
      value: hintFromTraits(traits, ["value", "usedMarketValue", "repairability"], 5),
    },
  };
}

export function recommendationProductToAvailabilityModel(
  product: Product,
  options: { allowUsed?: boolean } = {},
): AvailabilityProductModel {
  return {
    id: product.id,
    brand: product.brand,
    model: product.name,
    displayName: product.name,
    category: product.category,
    estimatedPriceCents: product.estimatedPriceCents ?? product.typicalUsedPriceCents ?? product.priceUsd * 100,
    searchQueries: [`${product.brand} ${product.name}`, product.name],
    allowUsed: options.allowUsed,
    deviceCatalogId: product.catalogDeviceId ?? product.id,
    slug: product.catalogDeviceId ?? product.id,
  };
}
