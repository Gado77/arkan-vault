import { NextResponse } from "next/server";
import { getBootstrapCache } from "@/lib/arkan/bootstrap-cache";

export async function GET() {
  try {
    const data = await getBootstrapCache();
    
    // Fallback safely if there's an error
    if (data.source === "unavailable") {
      return NextResponse.json({
        text: "Sistema de memória offline.",
        count: 0,
        chars: 0,
        source: "unavailable"
      });
    }

    return NextResponse.json({
      text: data.text,
      count: data.count,
      chars: data.chars,
      source: data.source
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch bootstrap context" },
      { status: 500 }
    );
  }
}
