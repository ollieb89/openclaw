import { describe, expect, it } from "vitest";
import { maskApiKey } from "./mask-api-key.js";

describe("maskApiKey", () => {
  it("masks a standard key showing first 4 chars and length", () => {
    expect(maskApiKey("sk-proj-abc123xyz789longkey")).toBe("sk-p... (27 chars)");
  });

  it("returns 'unknown' for empty string", () => {
    expect(maskApiKey("")).toBe("unknown");
  });

  it("returns 'unknown' for whitespace-only input", () => {
    expect(maskApiKey("  ")).toBe("unknown");
  });

  it("masks a 4-char key", () => {
    expect(maskApiKey("abcd")).toBe("abcd... (4 chars)");
  });

  it("masks a very short 2-char key", () => {
    expect(maskApiKey("ab")).toBe("ab... (2 chars)");
  });

  it("strips spaces before masking", () => {
    expect(maskApiKey("sk proj abc")).toBe("skpr... (9 chars)");
  });

  it("masks a realistic 52-char key", () => {
    const key = "sk-proj-" + "a".repeat(44); // 52 chars total
    expect(maskApiKey(key)).toBe("sk-p... (52 chars)");
  });

  it("never shows trailing characters", () => {
    const key = "sk-proj-abc123xyz789longkeySECRETTAIL";
    const result = maskApiKey(key);
    expect(result).not.toContain("TAIL");
    expect(result).not.toContain("SECRET");
    expect(result).toMatch(/^sk-p\.\.\. \(\d+ chars\)$/);
  });
});
