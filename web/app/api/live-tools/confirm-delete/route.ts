import { NextResponse } from "next/server";
import { getDeleteAction, confirmDeleteAction } from "@/lib/arkan/memory-state";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, actionId, confirmed } = body;

    if (typeof sessionId !== "string" || typeof actionId !== "string" || typeof confirmed !== "boolean") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const action = getDeleteAction(actionId);
    if (!action) {
      return NextResponse.json({ ok: false, error: "action_not_found_or_expired" });
    }

    if (action.logicalSessionId !== sessionId) {
      return NextResponse.json({ ok: false, error: "action_session_mismatch" });
    }

    if (action.decision === "cancelled") {
      return NextResponse.json({ ok: false, error: "action_already_cancelled" });
    }

    const updated = confirmDeleteAction({
      actionId,
      logicalSessionId: sessionId,
      confirmed
    });
    
    if (!updated) {
       return NextResponse.json({ ok: false, error: "action_update_failed" });
    }

    return NextResponse.json({ ok: true, actionId, confirmed });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
