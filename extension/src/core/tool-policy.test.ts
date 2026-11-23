import { describe, expect, it } from "vitest";
import { decideRemoteToolAccess, needsApproval } from "./tool-policy.js";

describe("tool-policy", () => {
	it("enforces read-only and no-tools policies", () => {
		expect(decideRemoteToolAccess("read-only", "read")).toBe("allow");
		expect(decideRemoteToolAccess("read-only", "bash")).toBe("block");
		expect(decideRemoteToolAccess("no-tools", "read")).toBe("block");
		expect(decideRemoteToolAccess("unrestricted", "bash")).toBe("allow");
	});

	it("skips approval for read-only tools even when approval is enabled", () => {
		expect(needsApproval("web", "read")).toBe(false);
		expect(needsApproval("web", "bash")).toBe(true);
		expect(needsApproval("off", "bash")).toBe(false);
	});
});
