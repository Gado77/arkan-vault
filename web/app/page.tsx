"use client";

/**
 * app/page.tsx — Slim wrapper.
 *
 * Routes between LiveVoiceView (Gemini Live, default) and ClassicVoiceView
 * (Groq + Edge TTS, fallback). Mode is persisted in localStorage.
 */

import { useEffect, useState } from "react";
import { LiveVoiceView } from "./_views/LiveVoiceView";
import { ClassicVoiceView } from "./_views/ClassicVoiceView";

type VoiceMode = "live" | "classic";
const STORAGE_KEY = "hermes-voice-mode";

export default function Home() {
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("live");

  // Read from localStorage on mount (SSR-safe: default is "live").
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "classic" || stored === "live") setVoiceMode(stored);
    } catch {}
  }, []);

  function switchToLive() {
    setVoiceMode("live");
    try { localStorage.setItem(STORAGE_KEY, "live"); } catch {}
  }

  function switchToClassic() {
    setVoiceMode("classic");
    try { localStorage.setItem(STORAGE_KEY, "classic"); } catch {}
  }

  if (voiceMode === "classic") {
    return <ClassicVoiceView onSwitchToLive={switchToLive} />;
  }
  return <LiveVoiceView onSwitchToClassic={switchToClassic} />;
}
