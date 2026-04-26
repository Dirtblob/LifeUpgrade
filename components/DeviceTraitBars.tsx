import type { DeviceTraitRatings } from "@/lib/devices/deviceTypes";
import { humanizeTrait, isBadDirectionTrait } from "@/lib/devices/deviceTraits";

type TraitScale = 10 | 100;
type TraitBarsTone = "light" | "dark";

const defaultTraits = [
  "productivity",
  "comfort",
  "ergonomics",
  "value",
  "compatibility",
  "confidence",
] as const;

const PRECOMPUTED_TRAITS_ON_TEN_SCALE = new Set([
  "productivity",
  "comfort",
  "ergonomics",
  "value",
  "gaming",
  "portability",
  "buildQuality",
  "noise",
  "quietness",
  "speed",
  "accessibility",
]);

const SCORES_ON_HUNDRED_SCALE = new Set([
  "compatibility",
  "confidence",
  "precision",
  "finalRecommendationScore",
  "fitScore",
  "traitDeltaScore",
  "budgetScore",
]);

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Some older/manual inputs use 0-10 trait values, while imported catalog ratings are normalized to 0-100.
// Prefer the value itself when it clearly identifies the scale so product input bars match the displayed score.
function getTraitScale(trait: string, value: number): TraitScale {
  if (SCORES_ON_HUNDRED_SCALE.has(trait)) return 100;
  if (Math.abs(value) > 10) return 100;
  if (PRECOMPUTED_TRAITS_ON_TEN_SCALE.has(trait)) return 10;
  return 10;
}

export function getBarPercent(value: number, scale: TraitScale): number {
  return clampPercent(scale === 10 ? value * 10 : value);
}

function formatDisplayValue(value: number, scale: TraitScale): string {
  if (scale === 10) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  }

  return String(clampPercent(value));
}

function fillClass(value: number): string {
  if (value >= 80) return "bg-moss";
  if (value >= 60) return "bg-gold";
  return "bg-clay";
}

function qualityPercentForTrait(trait: string, barPercent: number): number {
  return isBadDirectionTrait(trait) ? 100 - barPercent : barPercent;
}

export function DeviceTraitBars({
  ratings,
  traits = defaultTraits,
  compact = false,
  tone = "light",
}: {
  ratings: DeviceTraitRatings;
  traits?: readonly string[];
  compact?: boolean;
  tone?: TraitBarsTone;
}) {
  const visibleTraits = traits.filter((trait) => typeof ratings[trait] === "number");

  if (visibleTraits.length === 0) return null;

  const labelClassName = tone === "dark" ? "text-slate-300" : "text-ink/58";
  const valueClassName = tone === "dark" ? "text-slate-100" : "text-ink/72";
  const trackClassName = tone === "dark" ? "bg-white/12" : "bg-ink/8";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {visibleTraits.map((trait) => {
        const rawValue = ratings[trait];
        const scale = getTraitScale(trait, rawValue);
        const barPercent = getBarPercent(rawValue, scale);
        const qualityPercent = qualityPercentForTrait(trait, barPercent);
        const label = isBadDirectionTrait(trait) ? `${humanizeTrait(trait)} cost` : humanizeTrait(trait);

        return (
          <div key={trait} className="space-y-1.5">
            <div className={`flex items-center justify-between gap-3 text-xs font-medium ${labelClassName}`}>
              <span>{label}</span>
              <span className={`font-semibold ${valueClassName}`}>{formatDisplayValue(rawValue, scale)}</span>
            </div>
            <div className={`h-2 overflow-hidden rounded-full ${trackClassName}`}>
              <div
                className={`h-full rounded-full ${fillClass(qualityPercent)}`}
                style={{ width: `${Math.max(6, barPercent)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
