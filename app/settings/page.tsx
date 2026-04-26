import Link from "next/link";
import { ActionButton } from "@/components/ui/ActionButton";
import { MongoMigrationPanel } from "@/components/MongoMigrationPanel";
import { db } from "@/lib/db";
import { getCurrentMongoUser } from "@/lib/devUser";
import { countDevInventoryItems } from "@/lib/inventory/mongoInventory";
import { deleteLocalInventoryAction, deleteLocalProfileAction } from "./actions";

export const dynamic = "force-dynamic";

interface ProfileWithCounts {
  _count: {
    recommendations: number;
    savedProducts: number;
  };
}

const controlCards = [
  {
    title: "Private profile",
    body: "Edit fit measurements, comfort preferences, and recommendation privacy.",
    action: (
      <Link
        href="/profile"
        className="mt-4 inline-flex rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-moss"
      >
        Edit private profile
      </Link>
    ),
  },
  {
    title: "Onboarding profile",
    body: "Review demo budget, needs, constraints, and setup preferences.",
    action: (
      <Link
        href="/onboarding"
        className="mt-4 inline-flex rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink transition hover:border-moss/30 hover:text-moss"
      >
        Open onboarding
      </Link>
    ),
  },
  {
    title: "Delete profile",
    body: "Remove the local profile and all associated inventory, recommendations, and saved products.",
    action: (
      <form action={deleteLocalProfileAction} className="mt-4">
        <ActionButton pendingText="Deleting..." variant="danger" className="px-4 py-2">
          Delete profile
        </ActionButton>
      </form>
    ),
  },
  {
    title: "Delete inventory",
    body: "Clear owned items, generated recommendations, saved products, and alerts while keeping profile preferences.",
    action: (
      <form action={deleteLocalInventoryAction} className="mt-4">
        <ActionButton pendingText="Clearing..." variant="secondary" className="px-4 py-2">
          Delete inventory
        </ActionButton>
      </form>
    ),
  },
] as const;

export default async function SettingsPage() {
  const user = await getCurrentMongoUser();
  const profile = await db.userProfile.findUnique({
    where: { id: user.id },
    include: {
      _count: {
        select: {
          recommendations: true,
          savedProducts: true,
        },
      },
    },
  }) as ProfileWithCounts | null;
  const inventoryCount = await countDevInventoryItems();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-soft">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-moss">Settings</p>
        <h1 className="mt-3 text-3xl font-semibold">Privacy controls for your local setup.</h1>
        <p className="mt-3 max-w-2xl leading-7 text-ink/65">
          Sensitive profile fields stay in MongoDB instead of localStorage. These controls manage the active profile used by
          onboarding, inventory, and recommendations.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Inventory items", inventoryCount],
            ["Generated recs", profile?._count.recommendations ?? 0],
            ["Saved products", profile?._count.savedProducts ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-mist p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {controlCards.map(({ title, body, action }) => (
          <div key={title} className="rounded-2xl bg-white p-6 shadow-soft">
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-3 min-h-20 leading-7 text-ink/65">{body}</p>
            {action}
          </div>
        ))}
      </section>
      <MongoMigrationPanel />
    </div>
  );
}
