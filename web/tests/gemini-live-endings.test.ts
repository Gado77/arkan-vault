import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isNaturalEndTurn,
  normalizeNaturalEndTurn,
  VOICE_IDLE_TIMEOUT_MS,
} from "../lib/gemini-live/constants.ts";

const hookSource = readFileSync(new URL("../hooks/use-gemini-live.ts", import.meta.url), "utf8");

test("idle normal is 25 seconds", () => {
  assert.equal(VOICE_IDLE_TIMEOUT_MS, 25_000);
  assert.match(hookSource, /state === "ready"/);
  assert.doesNotMatch(hookSource, /mark\("last_voice_activity"\)[\s\S]{0,160}setTimeout/);
  assert.match(hookSource, /audioPlaybackActiveRef\.current/);
  assert.match(hookSource, /queue\.onIdle/);
  assert.match(hookSource, /if \(!audioPlaybackActiveRef\.current\) setStateAndRef\("ready"\)/);
});

test("natural ending normalization accepts the operator phrases", () => {
  const phrases = [
    "Não, obrigado!",
    "não obrigado",
    "não, obrigada",
    "não obrigada",
    "não, valeu",
    "não valeu",
    "era só isso",
    "é só isso",
    "valeu, era isso",
    "já resolveu",
    "não preciso de mais nada",
  ];
  for (const phrase of phrases) assert.equal(isNaturalEndTurn(phrase), true, phrase);
  assert.equal(normalizeNaturalEndTurn("  NÃO,   OBRIGADO!! "), "nao obrigado");
  assert.equal(isNaturalEndTurn("não gostei disso"), false);
  assert.equal(isNaturalEndTurn("obrigado pela explicação, continue"), false);
});

test("normal endings converge on returnToWakeMode", () => {
  assert.match(hookSource, /endConversation\("idle"\)/);
  assert.match(hookSource, /endConversation\("hermes_end_conversation"\)/);
  assert.match(hookSource, /"natural_end"/);
  assert.match(hookSource, /function returnToWakeMode\(\)/);
  assert.match(hookSource, /wakeActivationRef\.current = false/);
  assert.match(hookSource, /addDestination\("wake-detector"\)/);
  assert.match(hookSource, /setStateAndRef\("sleeping"\)/);
  assert.doesNotMatch(hookSource, /function returnToWakeMode[\s\S]*?audioCaptureEngine\.shutdown\(/);
});

test("wake gives immediate local chime before activation", () => {
  const wakeBlock = hookSource.slice(
    hookSource.indexOf('if (msg.event === "wake")'),
    hookSource.indexOf("ws.onclose", hookSource.indexOf('if (msg.event === "wake")')),
  );
  assert.match(wakeBlock, /createOscillator\(\)/);
  assert.match(wakeBlock, /osc\.start\(\)/);
  assert.ok(wakeBlock.indexOf("osc.start()") < wakeBlock.indexOf("activateFromWake()"));
});

test("wake requests a short spoken greeting in new and preserved sessions", () => {
  assert.match(hookSource, /function requestWakeGreeting\(\)/);
  assert.match(hookSource, /O usuário acabou de dizer Hey Jarvis/);
  assert.match(hookSource, /requestWakeGreeting\(\);[\s\S]{0,80}void startMic\(\)/);
  const occurrences = hookSource.match(/requestWakeGreeting\(\);/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("Parar path remains stopMic/startMic and does not end the session", () => {
  assert.match(hookSource, /const toggleMic = useCallback[\s\S]*?stopMic\(\)[\s\S]*?startMic\(\)/);
  const toggleBlock = hookSource.slice(
    hookSource.indexOf("const toggleMic"),
    hookSource.indexOf("Internal: persist conversation"),
  );
  assert.doesNotMatch(toggleBlock, /endConversation\(/);
});
