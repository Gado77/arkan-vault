const ABBREVIATIONS = new Set([
  "sr.", "sra.", "srta.", "dr.", "dra.", "prof.", "profa.",
  "etc.", "ex.", "aprox.", "av.", "nº.", "núm.",
]);

export function normalizeForTts(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class ProgressiveTTSChunker {
  private buffer = "";
  private first = true;

  feed(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];
    while (true) {
      const cut = this.findCut();
      if (cut === null) break;
      const chunk = normalizeForTts(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut).trimStart();
      if (chunk) {
        chunks.push(chunk);
        this.first = false;
      }
    }
    return chunks;
  }

  flush(): string[] {
    const remaining = normalizeForTts(this.buffer);
    this.buffer = "";
    if (!remaining) return [];
    this.first = false;
    return [remaining];
  }

  private limits() {
    return this.first
      ? { min: 6, target: 9, max: 12 }
      : { min: 12, target: 18, max: 28 };
  }

  private findCut(): number | null {
    const limits = this.limits();
    const words = [...this.buffer.matchAll(/\S+/g)];
    if (words.length < limits.min) return null;

    const strong: Array<{ position: number; words: number }> = [];
    const soft: Array<{ position: number; words: number }> = [];
    for (const match of this.buffer.matchAll(/[.!?;:,](?=\s|$)/g)) {
      const position = (match.index || 0) + match[0].length;
      if (!this.safeBoundary(match.index || 0, match[0])) continue;
      const count = this.buffer.slice(0, position).trim().split(/\s+/).filter(Boolean).length;
      if (count < limits.min || count > limits.max) continue;
      (/[.!?]/.test(match[0]) ? strong : soft).push({ position, words: count });
    }
    if (strong.length) return strong[0].position;
    if (words.length >= limits.target && soft.length) {
      const atOrAfterTarget = soft.find((item) => item.words >= limits.target);
      return (atOrAfterTarget || soft[soft.length - 1]).position;
    }
    if (words.length >= limits.max) {
      const maxWord = words[limits.max - 1];
      const end = (maxWord.index || 0) + maxWord[0].length;
      // A streaming delta may end halfway through a word. Only force a cut
      // after the max word once the following whitespace proves it is whole.
      if (end < this.buffer.length && /\s/.test(this.buffer[end])) return end;
    }
    return null;
  }

  private safeBoundary(index: number, punctuation: string) {
    const previous = index > 0 ? this.buffer[index - 1] : "";
    const next = this.buffer[index + 1] || "";
    if ((punctuation === "." || punctuation === ",") && /\d/.test(previous) && /\d/.test(next)) return false;

    const before = this.buffer.slice(0, index + 1);
    const token = before.match(/\S+$/)?.[0]?.toLowerCase() || "";
    if (ABBREVIATIONS.has(token)) return false;
    if (/^[a-zá-ÿ]\.$/i.test(token)) return false;
    if (/^(?:[a-z]\.){2,}$/i.test(token)) return false;
    if (/^(?:https?:\/\/|www\.)/i.test(token)) return false;
    return true;
  }
}
