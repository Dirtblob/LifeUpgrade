import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/onboarding(.*)",
  "/inventory(.*)",
  "/recommendations(.*)",
  "/products(.*)",
  "/profile(.*)",
  "/scan(.*)",
  "/settings(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/devices(.*)",
  "/api/inventory(.*)",
  "/api/migrations/local-storage-inventory(.*)",
  "/api/profile(.*)",
  "/api/recommendations(.*)",
]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);
const clerkIsConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() && process.env.CLERK_SECRET_KEY?.trim(),
);

const authMiddleware = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request) && !isApiRoute(request)) {
    await auth.protect();
  }
});

export default clerkIsConfigured ? authMiddleware : () => NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
