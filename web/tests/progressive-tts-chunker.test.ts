import assert from "node:assert/strict";
import test from "node:test";
import { ProgressiveTTSChunker, normalizeForTts } from "../lib/progressive-tts-chunker";

function chunksFor(text: string, deltaSize = 3) {
  const chunker = new ProgressiveTTSChunker();
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += deltaSize) chunks.push(...chunker.feed(text.slice(index, index + deltaSize)));
  chunks.push(...chunker.flush());
  return chunks;
}

test("first chunk is progressive and ordered", () => {
  const chunks = chunksFor("Certo, encontrei três informações importantes sobre o projeto Arkan Vault e vou explicar cada uma delas.");
  assert.ok(chunks[0].split(/\s+/).length >= 6 && chunks[0].split(/\s+/).length <= 12);
  assert.equal(chunks.join(" "), "Certo, encontrei três informações importantes sobre o projeto Arkan Vault e vou explicar cada uma delas.");
});

test("does not split decimals or common abbreviations", () => {
  for (const sentence of [
    "O valor estimado é de 1,5 milhão de reais, mas ainda precisamos confirmar.",
    "Conversei com o Dr. Silva sobre o problema e ele sugeriu uma nova abordagem.",
    "Consulte https://exemplo.com.br/teste agora e depois confirme o resultado completo.",
    "A empresa E.U.A. Tecnologia apresentou hoje uma solução bastante interessante para o projeto.",
  ]) {
    const chunks = chunksFor(sentence, 1);
    assert.ok(!chunks.includes("O valor estimado é de 1,"));
    assert.ok(!chunks.includes("Conversei com o Dr."));
    assert.equal(chunks.join(" "), sentence);
  }
});

test("short answers leave immediately on flush", () => {
  const chunker = new ProgressiveTTSChunker();
  assert.deepEqual(chunker.feed("Sim."), []);
  assert.deepEqual(chunker.flush(), ["Sim."]);
});

test("normalizes markdown only for speech", () => {
  assert.equal(normalizeForTts("**Veja** [o projeto](https://x.test) e `confirme`."), "Veja o projeto e confirme.");
});
