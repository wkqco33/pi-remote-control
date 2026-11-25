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

describe("buildHistorySnapshot tool calls", () => {
	const call = (id: string, text = "") => ({
		type: "message",
		message: {
			role: "assistant",
			content: [
				...(text ? [{ type: "text", text }] : []),
				{ type: "toolCall", id, name: "bash", arguments: { command: "echo secret-command" } },
			],
		},
	});
	const result = (toolCallId: string, isError = false) => ({
		type: "message",
		message: { role: "toolResult", toolCallId, toolName: "bash", isError, durationMs: 12, content: "secret output" },
	});
	const user = (content: string) => ({ type: "message", message: { role: "user", content } });

	it("restores call states in order without arguments or output", () => {
		const entries = [user("go"), call("a", "first"), result("a"), call("b"), result("b", true), call("c"), user("next"), call("d")];
		const out = buildHistorySnapshot(entries, { busy: true });
		expect(out.map((item) => (item.role === "tool" ? `${item.toolCallId}:${item.status}` : item.text))).toEqual([
			"go", "first", "a:done", "b:failed", "c:interrupted", "next", "d:running",
		]);
		expect(out[2]).toMatchObject({ role: "tool", text: "bash", durationMs: 12 });
		expect(JSON.stringify(out)).not.toContain("secret");
		expect(buildHistorySnapshot(entries).at(-1)).toMatchObject({ status: "interrupted" });
	});

	it("bounds messages and tool calls separately", () => {
		const entries = [user("old"), user("kept"), call("a"), call("b"), call("c"), user("last")];
		const out = buildHistorySnapshot(entries, { maxItems: 2, maxToolItems: 2 });
		expect(out.map((item) => (item.role === "tool" ? item.toolCallId : item.text))).toEqual(["kept", "b", "c", "last"]);
	});
});
