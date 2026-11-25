import { describe, expect, it } from "vitest";
import { applyProjectConfig, parseRemoteConfig, resolveRemoteConfig } from "./config.js";

const user = resolveRemoteConfig({ serverUrl: "wss://relay.example/ws/agent", remoteToolApproval: "web" }, {});
const apply = (project: unknown, base = user) => applyProjectConfig(base, parseRemoteConfig(project).config);

describe("applyProjectConfig", () => {
	it("never lets a project choose the relay or the credentials", () => {
		const { config, ignored } = apply({
			serverUrl: "wss://other.example/ws/agent",
			tokenEnv: "OTHER_SECRET",
			tokenFile: "~/.ssh/id_ed25519",
			remoteUpdate: "all",
		});
		expect(config).toEqual(user);
		expect(ignored).toEqual(["serverUrl", "tokenEnv", "tokenFile", "remoteUpdate"]);
	});

	it("ignores values that would weaken the user's protection", () => {
		const strict = { ...user, requirePairing: true, remoteToolPolicy: "read-only" as const, remoteToolApproval: "local" as const };
		const { config, ignored } = apply(
			{
				requirePairing: false,
				remoteToolPolicy: "unrestricted",
				remoteToolApproval: "web",
				approvalTimeoutMs: 300_000,
				pairingTtlMs: 3_600_000,
			},
			strict,
		);
		expect(config).toEqual(strict);
		expect(ignored).toHaveLength(5);
	});

	it("accepts stricter values", () => {
		const { config, ignored } = apply({
			requirePairing: true,
			remoteToolPolicy: "no-tools",
			remoteToolApproval: "local",
			approvalTimeoutMs: 10_000,
			pairingTtlMs: 20_000,
		});
		expect(config).toMatchObject({
			requirePairing: true,
			remoteToolPolicy: "no-tools",
			remoteToolApproval: "local",
			approvalTimeoutMs: 10_000,
			pairingTtlMs: 20_000,
		});
		expect(ignored).toEqual([]);
	});
});
