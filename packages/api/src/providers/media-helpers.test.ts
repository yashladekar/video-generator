import { describe, expect, it } from "vitest";

import { findFirstUrl, substituteTemplate } from "./media-helpers";

describe("media helpers", () => {
  it("substitutes placeholders recursively", () => {
    const result = substituteTemplate(
      {
        prompt: "{{prompt}}",
        nested: { duration: "{{duration}}", keep: "fixed" },
        list: ["{{width}}", "{{height}}"],
        missing: "{{unknown}}",
      },
      { prompt: "ocean", duration: 5, width: 1080, height: 1920 },
    );
    expect(result).toEqual({
      prompt: "ocean",
      nested: { duration: 5, keep: "fixed" },
      list: [1080, 1920],
      missing: "",
    });
  });

  it("finds the first URL in a nested result", () => {
    expect(
      findFirstUrl({
        status: "ok",
        video: { url: "https://cdn.example.com/a.mp4" },
      }),
    ).toBe("https://cdn.example.com/a.mp4");
    expect(findFirstUrl({ text: "no url" })).toBeUndefined();
  });
});
