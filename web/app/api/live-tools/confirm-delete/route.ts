import { NextResponse } from "next/server";
import { updateDeleteActionDecision } from "@/lib/arkan/memory-state";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, actionId, confirmed } = body;

    if (typeof sessionId !== "string" || typeof actionId !== "string" || typeof confirmed !== "boolean") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const updated = updateDeleteActionDecision(actionId, confirmed ? "confirmed" : "cancelled");
    
    if (!updated) {
       return NextResponse.json({ ok: false, error: "action_not_found_or_expired" });
    }

    return NextResponse.json({ ok: true, actionId, confirmed });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
