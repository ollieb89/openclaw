import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { expect, it } from "vitest";
import { describeLive } from "../test-utils/live-test-helpers.js";

const ZAI_KEY = process.env.ZAI_API_KEY ?? process.env.Z_AI_API_KEY ?? "";

const runSuite = describeLive({
  name: "zai live",
  envVars: [
    { name: "ZAI_LIVE_TEST", value: process.env.ZAI_LIVE_TEST, required: false },
    {
      name: "ZAI_API_KEY",
      value: process.env.ZAI_API_KEY ?? process.env.Z_AI_API_KEY,
      required: true,
    },
  ],
});

runSuite("zai live", () => {
  it("returns assistant text", async () => {
    const model = getModel("zai", "glm-4.7");
    const res = await completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: "Reply with the word ok.",
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: ZAI_KEY, maxTokens: 64 },
    );
    const text = res.content
      .filter((block) => block.type === "text")
      .map((block) => block.text.trim())
      .join(" ");
    expect(text.length).toBeGreaterThan(0);
  }, 20000);

  it("glm-4.7-flashx returns assistant text", async () => {
    const model = getModel("zai", "glm-4.7-flashx" as "glm-4.7");
    const res = await completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: "Reply with the word ok.",
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: ZAI_KEY, maxTokens: 64 },
    );
    const text = res.content
      .filter((block) => block.type === "text")
      .map((block) => block.text.trim())
      .join(" ");
    expect(text.length).toBeGreaterThan(0);
  }, 20000);
});
