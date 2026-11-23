/**
 * Configuration loader and validator for pi-remote-control extension.
 * Secrets are never stored in config files — only env var names (`tokenEnv`).
 */

import type { RemoteToolApproval, RemoteToolPolicy } from "./core/tool-policy.js";

export interface RemoteControlConfig {
	readonly serverUrl: string;
	readonly tokenEnv: string;
	readonly tokenFile?: string;
	readonly requirePairing: boolean;
	readonly pairingTtlMs: number;
	readonly pairingDigits: number;
	readonly pairingMaxAttempts: number;
	readonly remoteToolPolicy: RemoteToolPolicy;
	readonly remoteToolApproval: RemoteToolApproval;
	readonly approvalTimeoutMs: number;
	readonly maxImageBytes: number;
	readonly maxImages: number;
	readonly reconnectBaseMs: number;
	readonly reconnectMaxMs: number;
}

export const DEFAULT_REMOTE_CONFIG: RemoteControlConfig = {
	serverUrl: "ws://127.0.0.1:8787/ws/agent",
	tokenEnv: "PI_REMOTE_SERVER_TOKEN",
	requirePairing: true,
	pairingTtlMs: 5 * 60 * 1000,
	pairingDigits: 6,
	pairingMaxAttempts: 3,
	remoteToolPolicy: "unrestricted",
	remoteToolApproval: "off",
	approvalTimeoutMs: 60_000,
	maxImageBytes: 8 * 1024 * 1024,
	maxImages: 4,
	reconnectBaseMs: 1_000,
	reconnectMaxMs: 30_000,
};

export interface ParsedConfigResult {
	readonly config: Partial<RemoteControlConfig>;
	readonly warnings: readonly string[];
}

export function parseRemoteConfig(raw: unknown): ParsedConfigResult {
	const warnings: string[] = [];
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { config: {}, warnings: ["config must be a JSON object"] };
	}
	const obj = raw as Record<string, unknown>;
	const out: Record<string, unknown> = {};

	if ("token" in obj || "serverToken" in obj) {
		warnings.push("raw token keys are ignored; use tokenEnv to name an environment variable");
	}
	if (typeof obj.serverUrl === "string" && obj.serverUrl.trim()) {
		out.serverUrl = obj.serverUrl.trim();
	}
	if (typeof obj.tokenEnv === "string" && /^[A-Z0-9_]+$/i.test(obj.tokenEnv.trim())) {
		out.tokenEnv = obj.tokenEnv.trim();
	}
	if (typeof obj.tokenFile === "string" && obj.tokenFile.trim()) {
		out.tokenFile = obj.tokenFile.trim();
	}
	if (typeof obj.requirePairing === "boolean") {
		out.requirePairing = obj.requirePairing;
	}
	if (obj.remoteToolPolicy === "unrestricted" || obj.remoteToolPolicy === "read-only" || obj.remoteToolPolicy === "no-tools") {
		out.remoteToolPolicy = obj.remoteToolPolicy;
	}
	if (obj.remoteToolApproval === "off" || obj.remoteToolApproval === "local" || obj.remoteToolApproval === "web") {
		out.remoteToolApproval = obj.remoteToolApproval;
	}
	if (typeof obj.approvalTimeoutMs === "number" && obj.approvalTimeoutMs >= 5_000 && obj.approvalTimeoutMs <= 300_000) {
		out.approvalTimeoutMs = obj.approvalTimeoutMs;
	}
	if (typeof obj.pairingTtlMs === "number" && obj.pairingTtlMs >= 10_000 && obj.pairingTtlMs <= 3_600_000) {
		out.pairingTtlMs = obj.pairingTtlMs;
	}

	return { config: out as Partial<RemoteControlConfig>, warnings };
}

export function resolveRemoteConfig(
	overrides: Partial<RemoteControlConfig>,
	env: Record<string, string | undefined> = process.env,
): RemoteControlConfig {
	const envUrl = env.PI_REMOTE_SERVER_URL?.trim();
	const envTokenFile = env.PI_REMOTE_SERVER_TOKEN_FILE?.trim();
	return {
		...DEFAULT_REMOTE_CONFIG,
		...overrides,
		...(envUrl ? { serverUrl: envUrl } : {}),
		...(envTokenFile ? { tokenFile: envTokenFile } : {}),
	};
}

export function expandHomePath(filePath: string, homeDir: string): string {
	const trimmed = filePath.trim();
	if (trimmed === "~") return homeDir;
	if (trimmed.startsWith("~/")) {
		return `${homeDir.replace(/\/+$/, "")}/${trimmed.slice(2)}`;
	}
	return trimmed;
}

export function parseTokenFileContent(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				const record = parsed as Record<string, unknown>;
				if (typeof record.token === "string" && record.token.trim()) {
					return record.token.trim();
				}
				if (typeof record.serverToken === "string" && record.serverToken.trim()) {
					return record.serverToken.trim();
				}
			}
			return "";
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}
