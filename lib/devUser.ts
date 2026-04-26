import "server-only";

import type { Collection } from "mongodb";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getMongoDatabase } from "@/lib/mongodb";

const CLERK_AUTH_PROVIDER = "clerk" as const;
const LOCAL_DEMO_AUTH_PROVIDER = "local_demo" as const;

// Legacy compatibility constant for older inventory helpers and scripts.
export const DEV_USER_ID = process.env.DEV_USER_ID?.trim() || "dev-user";

export interface MongoUser {
  _id: string;
  id: string;
  sourceKey: string;
  label: string;
  authProvider: typeof CLERK_AUTH_PROVIDER | typeof LOCAL_DEMO_AUTH_PROVIDER;
  authUserId: string;
  email: string | null;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class UnauthorizedMongoUserError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHORIZED";

  constructor() {
    super("Unauthorized.");
  }
}

function getDisplayName(input: {
  fullName?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const fullName = input.fullName?.trim();
  if (fullName) return fullName;

  const firstLast = [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(" ").trim();
  if (firstLast) return firstLast;

  const username = input.username?.trim();
  return username || null;
}

function getEmailAddress(input: {
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  emailAddresses?: Array<{ emailAddress?: string | null }> | null;
}): string | null {
  const primaryEmail = input.primaryEmailAddress?.emailAddress?.trim();
  if (primaryEmail) return primaryEmail;

  const fallbackEmail = input.emailAddresses?.find((email) => email.emailAddress?.trim())?.emailAddress?.trim();
  return fallbackEmail || null;
}

async function getOptionalClerkUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("can't detect usage of clerkMiddleware")) {
      console.warn("Falling back to local demo auth.", error);
    }

    return null;
  }
}

export async function getCurrentInventoryUserId(): Promise<string> {
  const user = await getCurrentMongoUser();
  return user.id;
}

async function getUsersCollection(): Promise<Collection<MongoUser>> {
  const database = await getMongoDatabase();
  return database.collection<MongoUser>("users");
}

export async function getCurrentMongoUser(): Promise<MongoUser> {
  const clerkUserId = await getOptionalClerkUserId();
  const users = await getUsersCollection();
  const now = new Date();

  if (!clerkUserId) {
    const sourceKey = `local:user:${DEV_USER_ID}`;
    const filter = {
      $or: [
        { _id: DEV_USER_ID },
        { id: DEV_USER_ID },
        {
          authProvider: LOCAL_DEMO_AUTH_PROVIDER,
          authUserId: DEV_USER_ID,
        },
      ],
    };

    await users.updateOne(
      filter,
      {
        $setOnInsert: {
          _id: DEV_USER_ID,
          createdAt: now,
        },
        $set: {
          id: DEV_USER_ID,
          sourceKey,
          label: "Local demo user",
          authProvider: LOCAL_DEMO_AUTH_PROVIDER,
          authUserId: DEV_USER_ID,
          email: null,
          displayName: "Local demo user",
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    const user = await users.findOne(filter);
    if (!user) {
      throw new Error("Failed to resolve local demo user.");
    }

    return user;
  }

  const clerkUser = await currentUser();
  const email = getEmailAddress(clerkUser ?? {});
  const displayName = getDisplayName(clerkUser ?? {});
  const sourceKey = `clerk:user:${clerkUserId}`;
  const label = displayName ?? email ?? "Clerk user";
  const filter = {
    authProvider: CLERK_AUTH_PROVIDER,
    authUserId: clerkUserId,
  };

  await users.updateOne(
    filter,
    {
      $setOnInsert: {
        _id: clerkUserId,
        createdAt: now,
      },
      $set: {
        id: clerkUserId,
        sourceKey,
        label,
        authProvider: CLERK_AUTH_PROVIDER,
        authUserId: clerkUserId,
        email,
        displayName,
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  const user = await users.findOne(filter);
  if (!user) {
    throw new Error("Failed to resolve Mongo user.");
  }

  return user;
}
