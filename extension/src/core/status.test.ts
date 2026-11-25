import { describe, expect, it } from "vitest";
import { formatFooterLabel, formatStatusReport } from "./status.js";

describe("status", () => {
	it("formats footer and status report without secrets", () => {
		expect(formatFooterLabel("connected", 2)).toBe("remote: on (2)");
		expect(formatFooterLabel("disconnected", 0)).toBe("remote: off");
		const report = formatStatusReport({
			status: "connected",
			serverUrl: "ws://localhost:8787/ws/agent",
			sessionId: "sess-1",
			trustedClients: 1,
			pendingPairings: 0,
			remoteToolPolicy: "unrestricted",
			remoteToolApproval: "web",
			autoApprove: false,
		});
		expect(report).toContain("pi-remote-control status: connected");
		expect(report).toContain("toolPolicy: unrestricted (approval: web)");
	});
});
