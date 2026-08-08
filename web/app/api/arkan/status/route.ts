/**
 * app/api/arkan/status/route.ts
 * 
 * Exposes the Arkan Vault real health status.
 * Replaces the old proxy intercept in local-preview.mjs.
 */

import { NextResponse } from "next/server";
import { arkanGetStatus } from "@/lib/arkan-client";

export async function GET() {
  const status = await arkanGetStatus();
  return NextResponse.json(status);
}
