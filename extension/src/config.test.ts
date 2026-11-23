import { describe, expect, it } from "vitest";
import { parseRemoteConfig, resolveRemoteConfig } from "./config.js";

describe("remote config", () => {
	it("rejects raw tokens and resolves env overrides", () => {
		const parsed = parseRemoteConfig({
			token: "secret",
			serverUrl: "wss://relay.example.com/ws/agent",
			remoteToolPolicy: "read-only",
			remoteToolApproval: "web",
		});
		expect(parsed.warnings).toHaveLength(1);
		const resolved = resolveRemoteConfig(parsed.config, { PI_REMOTE_SERVER_URL: "ws://override:8787/ws/agent" });
		expect(resolved.serverUrl).toBe("ws://override:8787/ws/agent");
		expect(resolved.remoteToolPolicy).toBe("read-only");
		expect(resolved.remoteToolApproval).toBe("web");
	});
});
