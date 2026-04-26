import type { InventoryItem, Product, UserProfile, UserProblem } from "@/lib/recommendation/types";
import { catalogDevices } from "./deviceCatalog";
import type { CatalogDevice, DeviceCategory, DeviceDelta, DeviceTraitRatings, RawCatalogDevice } from "./deviceTypes";
import { isDeviceCategory } from "./deviceTypes";
import {
  getBaselineTraitRatings,
  getRelevantTraitsForProblems,
  humanizeTrait,
  isBadDirectionTrait,
  normalizeTraitRatings,
  traitDelta,
} from "./deviceTraits";
import { findBestDeviceMatch } from "./deviceSearch";
import { enrichCatalogDevice } from "./traitPrecompute";

type DeviceLike = CatalogDevice | Product | InventoryItem | null | undefined;

const productCategoryToDeviceCategory: Record<string, DeviceCategory> = {
  laptop: "laptop",
  monitor: "monitor",
  laptop_stand: "laptop_stand",
  keyboard: "keyboard",
  mouse: "mouse",
  chair: "chair",
  desk_lamp: "desk_lamp",
  headphones: "headphones",
  webcam: "webcam",
  storage: "external_storage",
  cable_management: "docking_station",
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isCatalogDevice(value: DeviceLike): value is CatalogDevice {
  return Boolean(value && "traitRatings" in value && "normalizedSpecs" in value && "displayName" in value);
}

function isInventoryItem(value: DeviceLike): value is InventoryItem {
  return Boolean(value && "condition" in value && "painPoints" in value);
}

function isProduct(value: DeviceLike): value is Product {
  return Boolean(value && "priceUsd" in value && "scoreHints" in value);
}

function deviceCategory(category: string): DeviceCategory {
  return isDeviceCategory(category) ? category : productCategoryToDeviceCategory[category] ?? "accessibility_device";
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function nestedTraitRatings(specs: Record<string, unknown> | undefined): DeviceTraitRatings | undefined {
  const ratings = objectValue(specs?.traitRatings);
  if (!ratings) return undefined;

  return normalizeTraitRatings(
    Object.fromEntries(
      Object.entries(ratings)
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => [key, value as number]),
    ),
  );
}

function inventoryCatalogDeviceId(item: InventoryItem): string | undefined {
  const specs = item.specs ?? {};
  const id = item.deviceCatalogId ?? item.catalogProductId ?? specs.catalogDeviceId;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : undefined;
}

function hasCatalogRatings(item: InventoryItem): boolean {
  if (item.source === "bestbuy" || item.source === "custom" || item.hasCatalogRatings === false) return false;
  return true;
}

function unratedInventorySpecs(item: InventoryItem): Record<string, unknown> {
  return {
    category: item.category,
    brand: item.brand ?? undefined,
    model: item.model ?? undefined,
    rawProductTitle: item.rawProductTitle ?? item.name,
    source: item.source,
    priceCents: item.priceCents ?? undefined,
    condition: item.condition,
  };
}

function catalogDeviceFromProduct(product: Product): CatalogDevice {
  const productRecord = product as Product & { features?: Record<string, unknown>; estimatedPriceCents?: number };

  if (product.traitRatings) {
    const rawDevice: RawCatalogDevice = {
      id: product.catalogDeviceId ?? `candidate-${product.id}`,
      category: deviceCategory(product.category),
      brand: product.brand,
      model: product.name,
      displayName: product.name,
      estimatedPriceCents: productRecord.estimatedPriceCents ?? Math.round(product.priceUsd * 100),
      specs: {
        ...(product.normalizedSpecs ?? {}),
        ...(productRecord.features ?? {}),
        brand: product.brand,
        model: product.name,
        category: product.category,
        quiet: product.constraints.quiet,
        portable: product.constraints.portable,
        widthInches: product.constraints.minDeskWidthInches,
      },
      ergonomicSpecs: product.ergonomicSpecs,
      normalizedSpecs: product.normalizedSpecs,
      traitRatings: product.traitRatings,
      traitConfidence: product.traitConfidence ?? 0.78,
      aliases: [product.name, product.id],
    };

    return enrichCatalogDevice(rawDevice);
  }

  const existing = findBestDeviceMatch({
    category: product.category,
    brand: product.brand,
    model: product.name,
    exactModel: product.name,
    text: `${product.brand} ${product.name}`,
  });

  if (existing && existing.category === deviceCategory(product.category)) return existing;

  const specs = {
    ...(productRecord.features ?? {}),
    brand: product.brand,
    model: product.name,
    category: product.category,
    quiet: product.constraints.quiet,
    portable: product.constraints.portable,
    widthInches: product.constraints.minDeskWidthInches,
  };
  const rawDevice: RawCatalogDevice = {
    id: `candidate-${product.id}`,
    category: deviceCategory(product.category),
    brand: product.brand,
    model: product.name,
    displayName: product.name,
    estimatedPriceCents: productRecord.estimatedPriceCents ?? Math.round(product.priceUsd * 100),
    specs,
    aliases: [product.name, product.id],
    traitConfidence: 0.62,
  };

  return enrichCatalogDevice(rawDevice);
}

function catalogDeviceFromInventory(item: InventoryItem): CatalogDevice | undefined {
  const catalogDeviceId = inventoryCatalogDeviceId(item);

  const matched = catalogDeviceId
    ? findBestDeviceMatch({
        catalogDeviceId,
        category: item.category,
        brand: typeof item.specs?.brand === "string" ? item.specs.brand : undefined,
        model: item.name,
        exactModel: item.name,
        text: item.name,
      })
    : findBestDeviceMatch({
        category: item.category,
        brand: typeof item.specs?.brand === "string" ? item.specs.brand : undefined,
        model: item.name,
        exactModel: item.name,
        text: item.name,
      });

  if (matched) return matched;

  const ratings = nestedTraitRatings(item.specs);
  if (!ratings) return undefined;

  const rawDevice: RawCatalogDevice = {
    id: `inventory-${item.id}`,
    category: deviceCategory(item.category),
    brand: String(item.specs?.brand ?? item.brand ?? item.name.split(" ")[0] ?? "Unknown"),
    model: item.model ?? item.name,
    displayName: item.name,
    estimatedPriceCents: 0,
    specs: {
      ...(item.specs ?? {}),
      name: item.name,
      condition: item.condition,
      painPoints: item.painPoints,
    },
    traitRatings: ratings,
    traitConfidence: 0.78,
  };

  return enrichCatalogDevice(rawDevice);
}

function traitProfile(value: DeviceLike, category: DeviceCategory): {
  label: string;
  traits: DeviceTraitRatings;
  confidence: number;
  specs?: Record<string, unknown>;
  missing: boolean;
} {
  if (!value) {
    return {
      label: `baseline ${category.replaceAll("_", " ")}`,
      traits: getBaselineTraitRatings(category),
      confidence: 0.58,
      missing: true,
    };
  }

  if (isCatalogDevice(value)) {
    return {
      label: value.displayName,
      traits: value.traitRatings,
      confidence: value.traitConfidence,
      specs: value.normalizedSpecs,
      missing: false,
    };
  }

  if (isProduct(value)) {
    const device = catalogDeviceFromProduct(value);
    return {
      label: device.displayName,
      traits: device.traitRatings,
      confidence: device.traitConfidence,
      specs: device.normalizedSpecs,
      missing: false,
    };
  }

  if (isInventoryItem(value)) {
    if (!hasCatalogRatings(value)) {
      return {
        label: value.rawProductTitle ?? value.name,
        traits: getBaselineTraitRatings(category),
        confidence: 0.28,
        specs: unratedInventorySpecs(value),
        missing: false,
      };
    }

    const device = catalogDeviceFromInventory(value);
    if (device) {
      return {
        label: value.name,
        traits: device.traitRatings,
        confidence: device.traitConfidence,
        specs: { ...(value.specs ?? {}), ...device.normalizedSpecs },
        missing: false,
      };
    }
  }

  return {
    label: `baseline ${category.replaceAll("_", " ")}`,
    traits: getBaselineTraitRatings(category),
    confidence: 0.5,
    missing: true,
  };
}

function profileHasProblem(profile: UserProfile | undefined, problem: UserProblem): boolean {
  return profile?.problems.includes(problem) ?? false;
}

function hasSmallDesk(profile: UserProfile | undefined): boolean {
  return Boolean(
    profile &&
      (profile.problems.includes("small_space") ||
        profile.roomConstraints?.includes("small_space") ||
        profile.roomConstraints?.includes("limited_desk_width") ||
        profile.constraints.deskWidthInches <= 36),
  );
}

function hasNoiseSensitivity(profile: UserProfile | undefined): boolean {
  return Boolean(
    profile &&
      (profile.problems.includes("noise_sensitivity") ||
        profile.roomConstraints?.includes("needs_quiet") ||
        [...profile.preferences, ...profile.accessibilityNeeds].some((value) =>
          value.toLowerCase().includes("quiet") || value.toLowerCase().includes("noise"),
        )),
  );
}

function hardConstraintRegressions(
  category: DeviceCategory,
  candidate: ReturnType<typeof traitProfile>,
  profile: UserProfile | undefined,
): string[] {
  const regressions: string[] = [];
  const specs = candidate.specs ?? {};
  const size = Number(specs.sizeInches ?? 0);
  const widthPixels = Number(specs.widthPixels ?? 0);
  const heightPixels = Number(specs.heightPixels ?? 1);
  const ultrawide = category === "monitor" && (size >= 34 || widthPixels / heightPixels > 2);
  const priceCents = Number(specs.priceCents ?? 0);

  if (hasSmallDesk(profile) && ultrawide) {
    regressions.push(`${candidate.label} is large for a ${profile?.constraints.deskWidthInches ?? "small"}-inch desk.`);
  }

  if (hasNoiseSensitivity(profile)) {
    const quietness = candidate.traits.noiseQuietness ?? candidate.traits.quietness ?? 100 - (candidate.traits.noise ?? 40);
    if (quietness < 52) regressions.push(`${candidate.label} may be too loud for a quiet or shared space.`);
  }

  if (profile && priceCents > profile.budgetUsd * 100 * 1.2) {
    regressions.push(`${candidate.label} is meaningfully above the current budget.`);
  }

  return regressions;
}

function improvementLabel(trait: string, delta: number): string {
  const direction = isBadDirectionTrait(trait) ? "lower" : "higher";
  return `${humanizeTrait(trait)} ${direction} by ${Math.abs(Math.round(delta))} points`;
}

export function computeDeviceDelta(
  currentDevice: DeviceLike,
  candidateDevice: DeviceLike,
  userProfile?: UserProfile,
): DeviceDelta {
  const candidateCategory =
    candidateDevice && "category" in candidateDevice
      ? deviceCategory(String(candidateDevice.category))
      : currentDevice && "category" in currentDevice
        ? deviceCategory(String(currentDevice.category))
        : "accessibility_device";
  const current = traitProfile(currentDevice, candidateCategory);
  const candidate = traitProfile(candidateDevice, candidateCategory);
  const relevantTraits = getRelevantTraitsForProblems(userProfile?.problems ?? [], candidateCategory);
  const allTraits = new Set([...Object.keys(candidate.traits), ...Object.keys(current.traits), ...relevantTraits]);
  const traitDeltas: Record<string, number> = {};

  for (const trait of allTraits) {
    const candidateValue = candidate.traits[trait] ?? 50;
    const currentValue = current.traits[trait] ?? getBaselineTraitRatings(candidateCategory)[trait] ?? 40;
    traitDeltas[trait] = Math.round(traitDelta(candidateValue, currentValue, trait));
  }

  const weightedDeltas = relevantTraits.map((trait) => traitDeltas[trait] ?? 0);
  const positiveAverage =
    weightedDeltas.filter((delta) => delta > 0).reduce((total, delta) => total + delta, 0) /
    Math.max(1, weightedDeltas.filter((delta) => delta > 0).length);
  const negativeAverage =
    Math.abs(weightedDeltas.filter((delta) => delta < 0).reduce((total, delta) => total + delta, 0)) /
    Math.max(1, weightedDeltas.filter((delta) => delta < 0).length);
  const hardRegressions = hardConstraintRegressions(candidateCategory, candidate, userProfile);
  let totalImprovementScore = 50 + positiveAverage * 1.25 - negativeAverage * 1.1 - hardRegressions.length * 9;

  if (current.missing) totalImprovementScore += 10;
  if (profileHasProblem(userProfile, "small_space") && (traitDeltas.deskSpaceFit ?? traitDeltas.sizeEfficiency ?? 0) < -15) {
    totalImprovementScore -= 12;
  }
  if (profileHasProblem(userProfile, "wrist_pain") && candidateCategory === "mouse" && (traitDeltas.wristComfort ?? 0) > 20) {
    totalImprovementScore += 8;
  }
  if (profileHasProblem(userProfile, "back_pain") && candidateCategory === "chair" && (traitDeltas.lumbarSupport ?? 0) > 20) {
    totalImprovementScore += 8;
  }
  if (profileHasProblem(userProfile, "noise_sensitivity") && (traitDeltas.noiseQuietness ?? traitDeltas.quietness ?? 0) < -10) {
    totalImprovementScore -= 16;
  }

  const strongestImprovements = Object.entries(traitDeltas)
    .filter(([trait, delta]) => relevantTraits.includes(trait) && delta >= 10)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
  const regressions = [
    ...Object.entries(traitDeltas)
      .filter(([trait, delta]) => relevantTraits.includes(trait) && delta <= -10)
      .sort((left, right) => left[1] - right[1])
      .slice(0, 4)
      .map(([trait, delta]) => `${humanizeTrait(trait)} drops by ${Math.abs(Math.round(delta))} points.`),
    ...hardRegressions,
  ];
  const problemSpecificImprovements = strongestImprovements.map(([trait, delta]) => improvementLabel(trait, delta));
  const explanationFacts = [
    isInventoryItem(currentDevice) && !hasCatalogRatings(currentDevice)
      ? "This item is not rated yet, so fit scoring is limited."
      : null,
    current.missing
      ? `Better than your current setup because you do not have a dedicated ${candidateCategory.replaceAll("_", " ")} yet.`
      : `Better than ${current.label}: ${problemSpecificImprovements[0] ?? "overall trait fit improves"}.`,
    ...problemSpecificImprovements.slice(1, 4),
  ].filter((fact): fact is string => Boolean(fact));
  const confidence = clampScore(((candidate.confidence + current.confidence) / 2) * 100);

  return {
    currentDevice: {
      label: current.label,
      category: candidateCategory,
      missing: current.missing,
      confidence: clampScore(current.confidence * 100),
    },
    candidateDevice: {
      label: candidate.label,
      category: candidateCategory,
      missing: candidate.missing,
      confidence: clampScore(candidate.confidence * 100),
    },
    traitDeltas,
    totalImprovementScore: clampScore(totalImprovementScore),
    problemSpecificImprovements,
    regressions,
    explanationFacts,
    confidence,
  };
}

export function deviceForProduct(product: Product): CatalogDevice {
  return catalogDeviceFromProduct(product);
}

export function findCurrentDeviceForProduct(product: Product, inventory: InventoryItem[]): InventoryItem | undefined {
  return inventory.find((item) => item.category === product.category);
}

export function findCatalogDeviceByName(category: string, text: string): CatalogDevice | undefined {
  return findBestDeviceMatch({ category, text }) ?? catalogDevices.find((device) => device.displayName === text);
}
