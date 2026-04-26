import Link from "next/link";
import { InventoryForm } from "@/components/InventoryForm";
import { InventoryItemCard } from "@/components/InventoryItemCard";
import { ActionButton } from "@/components/ui/ActionButton";
import { getCurrentUserContext } from "@/lib/currentUser";
import { DEVICE_CATEGORIES } from "@/lib/devices/deviceTypes";
import { categoryLabels } from "@/lib/recommendation/scoring";
import { formatUsd } from "@/lib/ui/format";
import {
  addInventoryItemAction,
  deleteInventoryItemAction,
  generateRecommendationsAction,
  loadDemoInventoryAction,
  updateInventoryItemAction,
} from "./actions";

export const dynamic = "force-dynamic";

const quickAddCategories = [
  "laptop",
  "monitor",
  "keyboard",
  "mouse",
  "chair",
  "desk_lamp",
  "headphones",
  "webcam",
] as const;

const allCategoryOptions = [...DEVICE_CATEGORIES, "storage", "cable_management", "other", "unknown"] as const;

function normalizeCategoryParam(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "laptop";

  const normalized = value.toLowerCase().replaceAll("-", "_");
  return allCategoryOptions.includes(normalized as (typeof allCategoryOptions)[number]) ? normalized : "laptop";
}

interface InventoryPageProps {
  searchParams: Promise<{
    category?: string | string[];
    edit?: string | string[];
  }>;
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams;
  const selectedCategory = normalizeCategoryParam(params.category);
  const editingId = typeof params.edit === "string" ? params.edit : undefined;
  const context = await getCurrentUserContext();

  if (!context) {
    return (
      <div className="rounded-[2rem] border border-dashed border-ink/15 bg-white/85 p-10 text-center shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">Inventory</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">Create a profile before adding inventory.</h1>
        <p className="mx-auto mt-4 max-w-2xl leading-7 text-ink/65">
          Inventory belongs to your active profile. Complete onboarding or run demo mode from the landing page to create
          that profile first.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/onboarding" className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">
            Complete onboarding
          </Link>
          <Link href="/" className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
            Open landing page
          </Link>
        </div>
      </div>
    );
  }

  const { profile, inventory } = context;
  const editingItem = inventory.find((item) => item.id === editingId);
  const itemsWithExactModel = inventory.filter((item) => Boolean(item.exactModel?.trim())).length;

  return (
    <div className="space-y-8">
      <section className="grid gap-5 xl:grid-cols-[1.14fr_0.86fr]">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_70px_rgba(2,6,23,0.55)] backdrop-blur-xl md:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Inventory</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-white md:text-5xl">{profile.name}&rsquo;s current setup</h1>
          <p className="mt-4 max-w-3xl leading-7 text-slate-300">
            Track what the user already owns before scoring upgrades. Exact model and configuration details make the
            recommendation engine more confident about fit, value, and compatibility.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Items tracked</p>
              <p className="mt-2 font-display text-3xl font-semibold text-slate-100">{inventory.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Exact configs added</p>
              <p className="mt-2 font-display text-3xl font-semibold text-slate-100">{itemsWithExactModel}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Budget context</p>
              <p className="mt-2 font-display text-3xl font-semibold text-slate-100">{formatUsd(profile.budgetUsd)}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-[auto_auto_1fr] lg:items-center">
            <form action={generateRecommendationsAction}>
              <ActionButton pendingText="Scoring..." variant="primary">
                Generate recommendations
              </ActionButton>
            </form>
            <Link
              href="/recommendations"
              className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/35 hover:bg-white/10"
            >
              View current ranking
            </Link>
            <div className="rounded-[1.5rem] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(8,47,73,0.9))] px-4 py-3 text-sm leading-6 text-slate-200/85">
              Best live-demo move: load demo inventory, then generate recommendations so the score jumps are obvious.
            </div>
          </div>
        </div>

        <aside className="rounded-[2rem] border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(8,47,73,0.96)_0%,rgba(6,78,59,0.92)_100%)] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.55)] md:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-100">Demo inventory</p>
          <h2 className="mt-3 font-display text-2xl font-semibold">One-click hackathon scenario</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-200/85">
            <li>MacBook Air M1 with 8GB RAM</li>
            <li>No external monitor</li>
            <li>Basic mouse</li>
            <li>No laptop stand</li>
            <li>Cheap chair</li>
            <li>Poor lighting</li>
          </ul>
          <form action={loadDemoInventoryAction} className="mt-6">
            <ActionButton pendingText="Loading demo..." variant="accent">
              Load demo inventory
            </ActionButton>
          </form>
          <p className="mt-3 text-xs leading-5 text-slate-300/75">
            This replaces the current inventory so the recommendations page can demo obvious upgrade gaps immediately.
          </p>
        </aside>
      </section>

      <section id="manual-entry" className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_70px_rgba(2,6,23,0.55)] backdrop-blur-xl md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/75">Manual entry</p>
            <h2 className="mt-3 font-display text-2xl font-semibold text-white">
              {editingItem ? "Edit inventory item" : "Add inventory item"}
            </h2>
            <p className="mt-3 max-w-3xl leading-7 text-slate-300">
              Manual entry comes first. Quick-add a category, then capture brand, model, config, and notes so the
              scoring stays explainable.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickAddCategories.map((category) => (
              <Link
                key={category}
                href={`/inventory?category=${category}#manual-entry`}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  selectedCategory === category
                    ? "border border-cyan-300/45 bg-cyan-400/20 text-cyan-100"
                    : "border border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/35 hover:bg-white/10"
                }`}
              >
                {categoryLabels[category]}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-[1.4rem] border border-cyan-300/25 bg-cyan-500/8 p-4 text-sm leading-6 text-slate-200">
          Confidence tip: the more specific the current setup is, the better the engine can tell whether a monitor,
          stand, webcam, or chair is truly the right next purchase.
        </div>

        <div className="mt-6">
          {editingItem ? (
            <InventoryForm
              action={updateInventoryItemAction}
              submitLabel="Save changes"
              submitTone="bg-moss hover:bg-ink"
              selectedCategory={selectedCategory}
              item={editingItem}
            />
          ) : (
            <InventoryForm
              action={addInventoryItemAction}
              submitLabel="Add item"
              submitTone="bg-ink hover:bg-moss"
              selectedCategory={selectedCategory}
            />
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Current inventory</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-white">What the engine sees right now</h2>
          </div>
          {inventory.length > 0 ? (
            <form action={generateRecommendationsAction}>
              <ActionButton pendingText="Scoring..." variant="primary">
                Generate recommendations
              </ActionButton>
            </form>
          ) : null}
        </div>

        {inventory.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-ink/15 bg-white/85 p-8 shadow-panel">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">Empty state</p>
              <h3 className="mt-3 font-display text-3xl font-semibold">No inventory items yet</h3>
              <p className="mt-3 leading-7 text-ink/66">
                Add a few current items or load the demo inventory to make upgrade gaps obvious. Missing categories are
                still useful, but exact current models give the best confidence.
              </p>
              <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="#manual-entry"
                  className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-moss"
                >
                  Add first item
                </Link>
                <form action={loadDemoInventoryAction}>
                  <ActionButton pendingText="Loading demo..." variant="accent">
                    Use demo inventory
                  </ActionButton>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {inventory.map((item) => (
              <InventoryItemCard
                key={item.id}
                item={item}
                footer={
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/inventory?edit=${item.id}&category=${item.category}#manual-entry`}
                      className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/35 hover:bg-white/10"
                    >
                      Edit
                    </Link>
                    <form action={deleteInventoryItemAction}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <ActionButton pendingText="Deleting..." variant="danger" className="px-4 py-2">
                        Delete
                      </ActionButton>
                    </form>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
