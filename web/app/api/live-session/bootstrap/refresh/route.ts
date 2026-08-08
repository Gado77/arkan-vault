import { NextResponse } from "next/server";
import { syncBootstrapCache } from "@/lib/arkan/bootstrap-cache";

export async function POST() {
  const result = await syncBootstrapCache();
  
  if (result.source !== "unavailable") {
    return NextResponse.json({ ok: true, cached: true });
  }
  
  return NextResponse.json({ ok: false, message: "Refresh yielded no valid context. Old cache retained if any." });
}
