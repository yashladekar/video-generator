import { isPaidProvider } from "../catalog";

export type VisualTier = "stock" | "procedural" | "keyframe" | "generative-video";

export type VisualPlanEntry = {
  tier: VisualTier;
  provider: string;
  paid: boolean;
  reason: string;
};

export type SceneVisualPlanInput = {
  visualType: string;
  preferredProvider?: string | null;
  localOnly?: boolean;
  stockProviders: string[];
  imageProviders: string[];
  videoProviders: string[];
  allowPaidVideo: boolean;
};

const EXPLICIT_PREFERENCE = new Set(["auto", "none", ""]);

export function hasExplicitVisualPreference(
  preferredProvider: string | null | undefined,
): boolean {
  if (preferredProvider === null || preferredProvider === undefined) return false;
  return !EXPLICIT_PREFERENCE.has(preferredProvider);
}

function entry(
  tier: VisualTier,
  provider: string,
  reason: string,
): VisualPlanEntry {
  return { tier, provider, paid: isPaidProvider(provider), reason };
}

/**
 * Orders the visual sources for a scene cheapest-first.
 *
 * Scenes the user drove toward stock media keep every free source ahead of any
 * paid generator, so background filler never costs money. Scenes with explicit
 * generative intent check free stock first, then one cheap keyframe, then the
 * paid turbo video tier, and only fall back to local motion graphics last -
 * a text-card procedural still is a worse outcome than a real generated frame.
 */
export function planSceneVisual(
  input: SceneVisualPlanInput,
): VisualPlanEntry[] {
  const {
    visualType,
    preferredProvider,
    localOnly,
    stockProviders,
    imageProviders,
    videoProviders,
    allowPaidVideo,
  } = input;

  const explicit = hasExplicitVisualPreference(preferredProvider)
    ? (preferredProvider as string)
    : null;
  const stock = localOnly ? [] : stockProviders;
  const images = localOnly ? [] : imageProviders;
  const videos = localOnly || !allowPaidVideo ? [] : videoProviders;

  if (explicit) {
    const providerExists =
      stock.includes(explicit) ||
      images.includes(explicit) ||
      videos.includes(explicit) ||
      explicit === "procedural";
    if (providerExists) {
      const tier = stock.includes(explicit)
        ? "stock"
        : videos.includes(explicit)
          ? "generative-video"
          : explicit === "procedural"
            ? "procedural"
            : "keyframe";
      return [entry(tier, explicit, "Pinned by the project's provider settings")];
    }
  }

  const plan: VisualPlanEntry[] = [];
  for (const provider of stock) {
    plan.push(
      entry("stock", provider, "Free stock media before any paid generation"),
    );
  }

  if (visualType === "AI_VIDEO") {
    for (const provider of images) {
      plan.push(
        entry("keyframe", provider, "Cheap keyframe that the video tier animates"),
      );
    }
    for (const provider of videos) {
      plan.push(
        entry("generative-video", provider, "Turbo image-to-video on the keyframe"),
      );
    }
    plan.push(
      entry("procedural", "procedural", "Zero-cost local motion graphics"),
    );
    return plan;
  }

  if (visualType === "AI_IMAGE") {
    for (const provider of images) {
      plan.push(entry("keyframe", provider, "Low-cost hosted keyframe model"));
    }
    plan.push(
      entry("procedural", "procedural", "Zero-cost local motion graphics"),
    );
    return plan;
  }

  plan.push(
    entry("procedural", "procedural", "Zero-cost local motion graphics"),
  );
  if (visualType === "STOCK_VIDEO" || visualType === "STOCK_IMAGE") {
    for (const provider of images) {
      plan.push(
        entry(
          "keyframe",
          provider,
          "Cheap generated still only when free sources are unavailable",
        ),
      );
    }
  }
  return plan;
}

export function paidTiers(plan: VisualPlanEntry[]): VisualPlanEntry[] {
  return plan.filter((item) => item.paid);
}

export function planRequiresPaidSpend(plan: VisualPlanEntry[]): boolean {
  const first = plan[0];
  return Boolean(first?.paid);
}
