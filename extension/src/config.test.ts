import { describe, expect, it } from "vitest";
import { expandHomePath, parseRemoteConfig, parseTokenFileContent, resolveRemoteConfig } from "./config.js";

describe("remote config", () => {
	it("rejects raw tokens and resolves env overrides", () => {
		const parsed = parseRemoteConfig({
			token: "secret",
			serverUrl: "wss://relay.example.com/ws/agent",
			tokenFile: "~/.pi/agent/remote-control.token.json",
			remoteToolPolicy: "read-only",
			remoteToolApproval: "web",
		});
		expect(parsed.warnings).toHaveLength(1);
		expect(parsed.config.tokenFile).toBe("~/.pi/agent/remote-control.token.json");
		const resolved = resolveRemoteConfig(parsed.config, {
			PI_REMOTE_SERVER_URL: "ws://override:8787/ws/agent",
			PI_REMOTE_SERVER_TOKEN_FILE: "/tmp/custom.token",
		});
		expect(resolved.serverUrl).toBe("ws://override:8787/ws/agent");
		expect(resolved.tokenFile).toBe("/tmp/custom.token");
		expect(resolved.remoteToolPolicy).toBe("read-only");
		expect(resolved.remoteToolApproval).toBe("web");
	});

	it("expands home directory paths", () => {
		expect(expandHomePath("~/.pi/agent/remote-control.token.json", "/home/alice")).toBe(
			"/home/alice/.pi/agent/remote-control.token.json",
		);
		expect(expandHomePath("/etc/pi/token", "/home/alice")).toBe("/etc/pi/token");
	});

	it("parses plain and JSON token files", () => {
		expect(parseTokenFileContent("plain-secret\n")).toBe("plain-secret");
		expect(parseTokenFileContent('{"token":"json-secret"}\n')).toBe("json-secret");
		expect(parseTokenFileContent('{"serverToken":"alt-secret"}\n')).toBe("alt-secret");
		expect(parseTokenFileContent("   \n")).toBe("");
	});
});
