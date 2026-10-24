import { describe, expect, it } from "vitest";

import {
  DRAFT_HEIGHT,
  DRAFT_WIDTH,
  RENDER_PROFILES,
  isDraftProfile,
  renderProfileByName,
  renderProfileFor,
} from "./render-profiles";

describe("render profiles", () => {
  it("renders studio previews as a 480p draft", () => {
    const draft = renderProfileFor("PREVIEW");
    expect(draft.name).toBe("DRAFT");
    expect(draft.width).toBe(DRAFT_WIDTH);
    expect(draft.height).toBe(DRAFT_HEIGHT);
    expect(isDraftProfile(draft)).toBe(true);
  });

  it("reserves full resolution for final exports", () => {
    const final = renderProfileFor("FINAL");
    expect(final.name).toBe("PRODUCTION");
    expect(final.width).toBe(1080);
    expect(final.height).toBe(1920);
  });

  it("honours the project 720p resolution for finals only", () => {
    const final = renderProfileFor("FINAL", { resolution: "720p" });
    expect(final.width).toBe(720);
    expect(final.height).toBe(1280);
    expect(renderProfileFor("PREVIEW", { resolution: "720p" }).width).toBe(
      DRAFT_WIDTH,
    );
  });

  it("keeps draft encoding cheaper than production on every knob", () => {
    const draft = RENDER_PROFILES.DRAFT;
    const production = RENDER_PROFILES.PRODUCTION;
    expect(draft.crf).toBeGreaterThan(production.crf);
    expect(draft.preset).toBe("ultrafast");
    expect(draft.width * draft.height).toBeLessThan(
      production.width * production.height,
    );
  });

  it("maps a stored profile name back to a profile", () => {
    expect(renderProfileByName("DRAFT").name).toBe("DRAFT");
    expect(renderProfileByName("PRODUCTION").name).toBe("PRODUCTION");
  });
});
