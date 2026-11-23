import { describe, expect, it } from "vitest";
import { buildHistorySnapshot } from "./history.js";

describe("buildHistorySnapshot", () => {
	it("extracts user and assistant messages, redacts secrets, and bounds count", () => {
		const entries = [
			{ type: "session", id: "h1" },
			{ type: "message", timestamp: "2026-11-23T10:00:00Z", message: { role: "user", content: "hi sk-ant-api03-1234567890abcdef" } },
			{ type: "message", message: { role: "toolResult", content: "secret output" } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
		];
		const out = buildHistorySnapshot(entries, { maxItems: 10 });
		expect(out).toHaveLength(2);
		expect(out[0]?.role).toBe("user");
		expect(out[0]?.text).toContain("[redacted:anthropic-key]");
		expect(out[1]?.text).toBe("done");
	});
});
