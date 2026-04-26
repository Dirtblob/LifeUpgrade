import { productCatalog } from "../../data/seeds/productCatalog";
import { getProductRecommendations } from "./productEngine";
import { getCategoryRecommendations } from "./categoryEngine";
import type {
  InventoryItem,
  ProductCategory,
  ProductRecommendation,
  RecommendationInput,
  UserProfile,
} from "./types";

export const HACKATHON_DEMO_SCENARIO_ID = "laptop-only-student-neck-pain";

export const HACKATHON_DEMO_EXPLANATION =
  "LifeUpgrade ranked cheap ergonomic/productivity upgrades above a new laptop because they solve the user's stated pain points at higher value.";

export const HACKATHON_DEMO_PRIORITY_ORDER: ProductCategory[] = [
  "laptop_stand",
  "monitor",
  "mouse",
  "desk_lamp",
  "laptop",
];

export const hackathonDemoProfile: UserProfile = {
  id: "demo-profile",
  name: "Avery",
  ageRange: "18-24",
  profession: "CS student",
  budgetUsd: 300,
  spendingStyle: "VALUE",
  preferences: ["quiet products", "minimalist", "value"],
  problems: ["neck_pain", "eye_strain", "low_productivity", "budget_limited"],
  accessibilityNeeds: [],
  roomConstraints: ["small_space", "portable_setup"],
  constraints: {
    deskWidthInches: 48,
    roomLighting: "low",
    sharesSpace: false,
    portableSetup: true,
  },
};

export const hackathonDemoInventory: InventoryItem[] = [
  {
    id: "demo-laptop",
    name: "Apple MacBook Air M1 8GB",
    category: "laptop",
    condition: "good",
    painPoints: ["low_productivity"],
  },
  {
    id: "demo-mouse",
    name: "Basic mouse",
    category: "mouse",
    condition: "fair",
    painPoints: ["wrist_pain", "low_productivity"],
  },
  {
    id: "demo-chair",
    name: "Basic chair",
    category: "chair",
    condition: "fair",
    painPoints: [],
  },
  {
    id: "demo-lighting",
    name: "Bad lighting",
    category: "other",
    condition: "poor",
    painPoints: ["eye_strain", "bad_lighting"],
  },
];

export const hackathonDemoInventoryRecords = [
  {
    id: "demo-laptop",
    category: "laptop",
    brand: "Apple",
    model: "MacBook Air M1",
    exactModel: "8GB RAM",
    condition: "GOOD",
    ageYears: 4,
    notes: "Laptop-only coding setup. Screen is too low for long study sessions and multitasking feels cramped.",
    source: "DEMO",
  },
  {
    id: "demo-mouse",
    category: "mouse",
    brand: "Generic",
    model: "Basic mouse",
    exactModel: null,
    condition: "FAIR",
    ageYears: 2,
    notes: "Cheap campus mouse that works, but long sessions feel uncomfortable and slow down navigation.",
    source: "DEMO",
  },
  {
    id: "demo-chair",
    category: "chair",
    brand: "Generic",
    model: "Basic chair",
    exactModel: null,
    condition: "FAIR",
    ageYears: 3,
    notes: "Basic student chair with limited support, but still usable for now.",
    source: "DEMO",
  },
  {
    id: "demo-lighting",
    category: "other",
    brand: null,
    model: "Bad lighting",
    exactModel: null,
    condition: "POOR",
    ageYears: 1,
    notes: "Desk lighting is dim at night and contributes to eye strain.",
    source: "DEMO",
  },
] as const;

export const hackathonDemoRoomConstraints = {
  demoScenarioId: HACKATHON_DEMO_SCENARIO_ID,
  deskWidthInches: hackathonDemoProfile.constraints.deskWidthInches,
  roomLighting: hackathonDemoProfile.constraints.roomLighting,
  sharesSpace: hackathonDemoProfile.constraints.sharesSpace,
  portableSetup: hackathonDemoProfile.constraints.portableSetup,
  laptopPorts: ["USB-C", "MagSafe", "3.5mm audio"],
  operatingSystem: "macos",
  roomConstraintTags: hackathonDemoProfile.roomConstraints,
} as const;

export interface DemoPriorityRecommendation {
  rank: number;
  category: ProductCategory;
  recommendation: ProductRecommendation | null;
}

export function serializeHackathonDemoProfile() {
  return {
    name: hackathonDemoProfile.name,
    ageRange: hackathonDemoProfile.ageRange,
    profession: hackathonDemoProfile.profession,
    budgetCents: hackathonDemoProfile.budgetUsd * 100,
    spendingStyle: hackathonDemoProfile.spendingStyle,
    usedItemsOkay: true,
    accessibilityNeeds: JSON.stringify(hackathonDemoProfile.accessibilityNeeds),
    preferences: JSON.stringify(hackathonDemoProfile.preferences),
    problems: JSON.stringify(hackathonDemoProfile.problems),
    roomConstraints: JSON.stringify(hackathonDemoRoomConstraints),
  };
}

export function buildHackathonDemoRecommendationInput(): RecommendationInput {
  return {
    profile: hackathonDemoProfile,
    inventory: hackathonDemoInventory,
    exactCurrentModelsProvided: true,
    deviceType: "laptop",
    ports: [...hackathonDemoRoomConstraints.laptopPorts],
    usedItemsOkay: true,
  };
}

export function buildHackathonDemoPriorityList(
  input: RecommendationInput = buildHackathonDemoRecommendationInput(),
): DemoPriorityRecommendation[] {
  const categoryRankings = new Map(
    getCategoryRecommendations(input).map((categoryRecommendation) => [
      categoryRecommendation.category,
      categoryRecommendation,
    ]),
  );

  return HACKATHON_DEMO_PRIORITY_ORDER.map((category, index) => ({
    rank: index + 1,
    category,
    recommendation: getProductRecommendations(
      input,
      categoryRankings.get(category) ?? { category, score: 0, reasons: [] },
      productCatalog,
    )[0] ?? null,
  }));
}
