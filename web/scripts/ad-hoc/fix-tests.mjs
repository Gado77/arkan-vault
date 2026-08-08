import { readFileSync, writeFileSync } from "fs";

const f = "tests/gemini-live.test.ts";
let code = readFileSync(f, "utf8");
code = code.replace(/\.ts"/g, '"');
code = code.replace(/GET\(req\)/g, "GET(req as any)");
code = code.replace(/POST\(req\)/g, "POST(req as any)");
writeFileSync(f, code);

const f2 = "tests/progressive-tts-chunker.test.ts";
let code2 = readFileSync(f2, "utf8");
code2 = code2.replace(/\.ts"/g, '"');
writeFileSync(f2, code2);
