import { describe, expect, it } from "vitest";

import { setupRequirements } from "../services/publishing";

describe("publishing setup and status policy", () => {
  it("marks YouTube as an official supported integration", () => {
    const setup = setupRequirements("YOUTUBE");
    expect(setup.supported).toBe(true);
    expect(setup.steps.join(" ")).toMatch(/youtube\.upload/i);
    expect(setup.notes).toMatch(/containsSyntheticMedia|synthetic/i);
  });

  it("marks Instagram and TikTok as manual-only", () => {
    for (const platform of ["INSTAGRAM_REELS", "TIKTOK"]) {
      const setup = setupRequirements(platform);
      expect(setup.supported).toBe(false);
      expect(setup.notes).toMatch(/manual export/i);
      expect(setup.notes).toMatch(/never marked as published|not a platform publish/i);
    }
  });

  it("describes manual export without claiming a publish", () => {
    const setup = setupRequirements("MANUAL");
    expect(setup.supported).toBe(true);
    expect(setup.steps.join(" ")).toMatch(/EXPORTED, not PUBLISHED/i);
    expect(setup.notes).toMatch(/does not call a platform API/i);
  });
});
