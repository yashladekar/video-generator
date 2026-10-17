import { createPrismaClient } from "../src/index";
import { ENV } from "../src/env";

const db = createPrismaClient(ENV);

const localPricing = [
  {
    provider: "template",
    model: "rule-based",
    category: "LLM" as const,
    unit: "request",
    unitPriceUsd: 0,
    sourceUrl: "local://template",
    metadata: { note: "Deterministic offline provider; no API cost." },
  },
  {
    provider: "ollama",
    model: "local",
    category: "LLM" as const,
    unit: "request",
    unitPriceUsd: 0,
    sourceUrl: "local://ollama",
    metadata: { note: "Local model execution; hardware cost only." },
  },
  {
    provider: "macos-say",
    model: "default",
    category: "TTS" as const,
    unit: "character",
    unitPriceUsd: 0,
    sourceUrl: "local://macos-say",
  },
  {
    provider: "espeak-ng",
    model: "default",
    category: "TTS" as const,
    unit: "character",
    unitPriceUsd: 0,
    sourceUrl: "local://espeak-ng",
  },
  {
    provider: "piper",
    model: "default",
    category: "TTS" as const,
    unit: "character",
    unitPriceUsd: 0,
    sourceUrl: "local://piper",
  },
  {
    provider: "procedural",
    model: "motion-graphics",
    category: "IMAGE" as const,
    unit: "image",
    unitPriceUsd: 0,
    sourceUrl: "local://procedural",
  },
  {
    provider: "procedural",
    model: "ambient-synth",
    category: "MUSIC" as const,
    unit: "track",
    unitPriceUsd: 0,
    sourceUrl: "local://music-generator",
  },
  {
    provider: "wikipedia",
    model: "rest-api",
    category: "RESEARCH" as const,
    unit: "request",
    unitPriceUsd: 0,
    sourceUrl: "https://www.mediawiki.org/wiki/API:REST_API",
  },
  {
    provider: "pexels",
    model: "stock",
    category: "IMAGE" as const,
    unit: "request",
    unitPriceUsd: 0,
    sourceUrl: "https://www.pexels.com/api/documentation/",
    metadata: { note: "Free API; attribution required. Configure PEXELS_API_KEY." },
  },
  {
    provider: "pexels",
    model: "stock-video",
    category: "TEXT_TO_VIDEO" as const,
    unit: "request",
    unitPriceUsd: 0,
    sourceUrl: "https://www.pexels.com/api/documentation/",
    metadata: { note: "Free stock video; attribution required." },
  },
  {
    provider: "local",
    model: "filesystem",
    category: "STORAGE" as const,
    unit: "request",
    unitPriceUsd: 0,
    sourceUrl: "local://filesystem",
  },
];

async function main() {
  for (const entry of localPricing) {
    await db.providerPricing.upsert({
      where: {
        provider_model_unit: {
          provider: entry.provider,
          model: entry.model,
          unit: entry.unit,
        },
      },
      update: {
        category: entry.category,
        unitPriceUsd: entry.unitPriceUsd,
        active: true,
        sourceUrl: entry.sourceUrl,
        verifiedAt: new Date(),
        metadata: entry.metadata ?? undefined,
      },
      create: {
        provider: entry.provider,
        model: entry.model,
        category: entry.category,
        unit: entry.unit,
        unitPriceUsd: entry.unitPriceUsd,
        active: true,
        sourceUrl: entry.sourceUrl,
        verifiedAt: new Date(),
        metadata: entry.metadata ?? undefined,
      },
    });
  }

  if (process.env.SEED_DEMO === "true") {
    const user = await db.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (!user) {
      console.log("SEED_DEMO requested, but no user exists yet. Sign up first, then rerun the seed.");
    } else {
      const existing = await db.project.findFirst({
        where: { userId: user.id, isSample: true },
      });
      if (!existing) {
        await db.project.create({
          data: {
            userId: user.id,
            title: "SAMPLE — 45s explainer draft",
            topic: "How solar panels turn sunlight into electricity",
            niche: "Science explainers",
            targetAudience: "Curious beginners",
            objective: "Educate and build trust",
            language: "en",
            tone: "Clear and friendly",
            cta: "Follow for more simple science explainers.",
            isSample: true,
            durationSeconds: 45,
            brief: {
              create: {
                topic: "How solar panels turn sunlight into electricity",
                targetAudience: "Curious beginners",
                objective: "Educate and build trust",
                niche: "Science explainers",
                language: "en",
                tone: "Clear and friendly",
                callToAction: "Follow for more simple science explainers.",
                researchEnabled: false,
              },
            },
          },
        });
        console.log("Created a clearly labeled SAMPLE draft project. No media or results were fabricated.");
      }
    }
  }

  console.log(`Seeded ${localPricing.length} local/provider pricing entries.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
