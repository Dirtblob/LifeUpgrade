import type { ReactNode } from "react";
import { categoryLabels } from "@/lib/recommendation/scoring";
import type { InventoryListItem } from "@/lib/currentUser";

const conditionTone: Record<InventoryListItem["condition"], string> = {
  poor: "bg-clay text-white",
  fair: "bg-gold text-ink",
  good: "bg-moss text-white",
  excellent: "bg-ink text-white",
  unknown: "bg-ink/10 text-ink/70",
};

const sourceLabel: Record<InventoryListItem["source"], string> = {
  manual: "Manual entry",
  photo: "Photo import",
  demo: "Demo scenario",
  catalog: "Rated catalog",
  bestbuy: "Best Buy",
  custom: "Custom entry",
};

function formatCondition(value: InventoryListItem["condition"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSpecValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function humanizeSpecKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Gb$/, " GB")
    .replace(/^./, (value) => value.toUpperCase());
}

function humanizeCategory(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function InventoryItemCard({
  item,
  footer,
}: {
  item: InventoryListItem;
  footer?: ReactNode;
}) {
  const categoryLabel = item.category in categoryLabels ? categoryLabels[item.category as keyof typeof categoryLabels] : humanizeCategory(item.category);
  const importedSpecs = item.specs ? Object.entries(item.specs).filter(([, value]) => value !== undefined).slice(0, 5) : [];

  return (
    <article className="rounded-[1.75rem] border border-white/75 bg-white/92 p-5 shadow-panel backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-moss">{categoryLabel}</p>
          <h2 className="mt-3 font-display text-xl font-semibold">{item.displayName}</h2>
          <p className="mt-1 text-sm text-ink/55">{sourceLabel[item.source]}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${conditionTone[item.condition]}`}>
          {formatCondition(item.condition)}
        </span>
      </div>

      <dl className="mt-5 grid gap-3 text-sm text-ink/68 sm:grid-cols-2">
        <div className="rounded-2xl bg-mist/75 p-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Brand</dt>
          <dd className="mt-1">{item.brand ?? "Not specified"}</dd>
        </div>
        <div className="rounded-2xl bg-mist/75 p-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Model</dt>
          <dd className="mt-1">{item.model ?? "Not specified"}</dd>
        </div>
        <div className="rounded-2xl bg-mist/75 p-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Exact config</dt>
          <dd className="mt-1">{item.exactModel ?? "Add this to improve recommendation confidence"}</dd>
        </div>
        <div className="rounded-2xl bg-mist/75 p-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Age</dt>
          <dd className="mt-1">{item.ageYears !== null ? `${item.ageYears} year${item.ageYears === 1 ? "" : "s"}` : "Unknown"}</dd>
        </div>
      </dl>

      <div className="mt-4 rounded-2xl border border-ink/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Notes</p>
        <p className="mt-2 text-sm leading-6 text-ink/70">
          {item.notes?.trim() ? item.notes : "No notes yet. Add details like configuration, fit issues, or limitations."}
        </p>
      </div>

      {importedSpecs.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-moss/15 bg-[#f3f8f4] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-moss">Imported specs</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {importedSpecs.map(([key, value]) => (
              <span key={key} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ink/68">
                {humanizeSpecKey(key)}: {formatSpecValue(value)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {footer ? <div className="mt-4">{footer}</div> : null}
    </article>
  );
}
