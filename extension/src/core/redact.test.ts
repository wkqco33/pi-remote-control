import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
	it("redacts API keys, bearer headers, and env assignments", () => {
		const input = [
			"PI_REMOTE_SERVER_TOKEN=mysecret123",
			"Authorization: Bearer abcdefghijklmnopqrstuvwxyz12345",
			"key sk-ant-api03-1234567890abcdef",
		].join("\n");
		const out = redactSecrets(input);
		expect(out).not.toContain("mysecret123");
		expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz12345");
		expect(out).not.toContain("1234567890abcdef");
		expect(out).toContain("PI_REMOTE_SERVER_TOKEN=[redacted]");
		expect(out).toContain("Bearer [redacted]");
		expect(out).toContain("[redacted:anthropic-key]");
	});
});
