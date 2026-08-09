import "server-only";

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();

  if (!key) {
    throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");
  }

  return key;
}

export function isGeminiApiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return !!key && key.length > 0;
}
