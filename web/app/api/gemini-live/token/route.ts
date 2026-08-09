// POST /api/gemini-live/token
// Server-side only. Reads GEMINI_API_KEY from environment, creates a Gemini
// ephemeral token restricted to a single use, the configured Live model, and
// AUDIO response modality. The permanent API key is never returned, logged, or
// exposed to the client.

import { NextRequest, NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/server-env";

export const runtime = "nodejs";
const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";

// Endpoint: https://generativelanguage.googleapis.com/v1beta/
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function POST(req: NextRequest) {
  // Restrict to same-origin requests in production.
  const origin = req.headers.get("origin") ?? "";
  const host = req.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const sameOrigin = origin.includes(host) || isLocalhost;
  if (!isLocalhost && !sameOrigin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let apiKey: string;
  try {
    apiKey = getGeminiApiKey();
  } catch (e) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on server" },
      { status: 503 }
    );
  }

  const now = new Date();
  // newSessionExpireTime: the window in which a NEW session can be started (~60s)
  const newSessionExpireTime = new Date(now.getTime() + 60 * 1000);
  // expireTime: how long the token itself is valid (15 minutes, for reconnects)
  const expireTime = new Date(now.getTime() + 15 * 60 * 1000);

  const tokenPayload = {
    model: `models/${GEMINI_LIVE_MODEL}`,
    config: {
      responseModalities: ["AUDIO"],
    },
    uses: 1,
    newSessionExpireTime: newSessionExpireTime.toISOString(),
    expireTime: expireTime.toISOString(),
  };

  let tokenData: Record<string, unknown>;
  try {
    const response = await fetch(
      `${GEMINI_BASE}/ephemeralTokens?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tokenPayload),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Log only status code – never log API key or token value.
      console.error(
        "[gemini-live/token] Gemini API error status=%d",
        response.status
      );
      return NextResponse.json(
        { error: `Gemini token endpoint returned ${response.status}`, detail: body },
        { status: response.status === 429 ? 429 : 502 }
      );
    }

    tokenData = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[gemini-live/token] fetch error:", (err as Error).message);
    return NextResponse.json({ error: "Failed to reach Gemini API" }, { status: 502 });
  }

  // tokenData.name contains the ephemeral token identifier; use it as access token.
  const accessToken = tokenData.name as string | undefined;
  if (!accessToken) {
    console.error("[gemini-live/token] Gemini response missing .name field");
    return NextResponse.json({ error: "Invalid token response from Gemini" }, { status: 502 });
  }

  // Return only the access token and validity times. Never return the API key.
  return NextResponse.json(
    {
      accessToken,
      model: GEMINI_LIVE_MODEL,
      newSessionExpireTime: newSessionExpireTime.toISOString(),
      expireTime: expireTime.toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    }
  );
}

// Disallow all other HTTP methods.
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
