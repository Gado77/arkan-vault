import { readFileSync, writeFileSync } from "fs";

const f = "tests/gemini-live.test.ts";
let code = readFileSync(f, "utf8");
code = code.replace(/new URL\("([^"]+)", import\.meta\.url\)/g, (match, p1) => {
  if (!p1.endsWith(".ts")) {
    return `new URL("${p1}.ts", import.meta.url)`;
  }
  return match;
});
writeFileSync(f, code);
