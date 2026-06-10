/**
 * Tests transcript cleanup on simulated STT errors for domain phrases.
 * Run: npx tsx scripts/test-transcript-cleanup.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupTranscript, logTranscriptQuality } from "../lib/transcript-cleanup";

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const TEST_CASES = [
  {
    label: "INPAS / EMV",
    expected: "INPAS делает нам EMV",
    simulatedRaw: "инпас делает нам имви"
  },
  {
    label: "T6D / BOM / MediaTek",
    expected: "По T6D нужно проверить BOM и MediaTek MT8766V",
    simulatedRaw: "по t6d нужно проверить бом и mediatek mt8766v"
  },
  {
    label: "реестр ККТ",
    expected: "Дальше идем в реестр ККТ",
    simulatedRaw: "дальше идем в реестр к k t"
  },
  {
    label: "ЕНВД",
    expected: "Это связано с ЕНВД",
    simulatedRaw: "это связано с envd"
  }
] as const;

async function main() {
  loadEnvLocal();

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is missing in .env.local");
    process.exit(1);
  }

  console.log("Transcript cleanup test (simulated STT errors)\n");
  console.log("=".repeat(72));

  for (const testCase of TEST_CASES) {
    const result = await cleanupTranscript(testCase.simulatedRaw);

    logTranscriptQuality({
      rawTranscriptLength: testCase.simulatedRaw.length,
      cleanedTranscriptLength: result.cleanedTranscript?.length ?? null,
      appliedCorrectionsCount: result.appliedCorrections.length,
      transcriptStatus: result.transcriptStatus
    });

    console.log(`\n[${testCase.label}]`);
    console.log(`  Ожидание:     ${testCase.expected}`);
    console.log(`  До (STT):     ${testCase.simulatedRaw}`);
    console.log(`  После:        ${result.cleanedTranscript ?? "(cleanup failed)"}`);
    console.log(
      `  Исправления:  ${
        result.appliedCorrections.length
          ? result.appliedCorrections.map((item) => `\n    - ${item}`).join("")
          : "(нет)"
      }`
    );
    console.log("-".repeat(72));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
