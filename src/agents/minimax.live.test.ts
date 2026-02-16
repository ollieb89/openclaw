import { completeSimple, type Model } from "@mariozechner/pi-ai";
import { expect, it } from "vitest";
import { describeLive } from "../test-utils/live-test-helpers.js";

const MINIMAX_KEY = process.env.MINIMAX_API_KEY ?? "";
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimax.io/anthropic";
const MINIMAX_MODEL = process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.1";

const runSuite = describeLive({
  name: "minimax live",
  envVars: [
    { name: "MINIMAX_LIVE_TEST", value: process.env.MINIMAX_LIVE_TEST, required: false },
    { name: "MINIMAX_API_KEY", value: process.env.MINIMAX_API_KEY, required: true },
  ],
});

runSuite("minimax live", () => {
  it("returns assistant text", async () => {
    const model: Model<"anthropic-messages"> = {
      id: MINIMAX_MODEL,
      name: `MiniMax ${MINIMAX_MODEL}`,
      api: "anthropic-messages",
      provider: "minimax",
      baseUrl: MINIMAX_BASE_URL,
      reasoning: false,
      input: ["text"],
      // Pricing: placeholder values (per 1M tokens, multiplied by 1000 for display)
      cost: { input: 15, output: 60, cacheRead: 2, cacheWrite: 10 },
      contextWindow: 200000,
      maxTokens: 8192,
    };
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
      { apiKey: MINIMAX_KEY, maxTokens: 64 },
    );
    const text = res.content
      .filter((block) => block.type === "text")
      .map((block) => block.text.trim())
      .join(" ");
    expect(text.length).toBeGreaterThan(0);
  }, 20000);
});
