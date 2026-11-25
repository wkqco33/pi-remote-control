/**
 * pi extension entry point for pi-remote-control.
 * Thin adapter binding pi ExtensionAPI events to WsClient + RemoteBridge.
 */

import { readFile, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RemoteBridge, type RemoteHost } from "./client/remote-bridge.js";
import { WsClient } from "./client/ws-client.js";
import {
	expandHomePath,
	parseTokenFileContent,
	type RemoteControlConfig,
} from "./config.js";
import { loadExtensionConfig } from "./config-loader.js";
import { buildWorkDigest, parseGitBranch, parseGitNumstat } from "./core/digest.js";
import { buildHistorySnapshot, type RawSessionEntry } from "./core/history.js";
import { formatFooterLabel, formatStatusReport } from "./core/status.js";
import {
	decideRemoteToolAccess,
	needsApproval,
	remoteToolBlockReason,
	remoteToolDeclinedReason,
	type ApprovalReason,
} from "./core/tool-policy.js";

const EXTENSION_KEY = "remote-control";

async function loadServerToken(config: RemoteControlConfig, warnings: string[]): Promise<string> {
	const envToken = process.env[config.tokenEnv]?.trim();
	if (envToken) {
		return envToken;
	}
	if (!config.tokenFile) {
		return "";
	}
	const resolvedPath = expandHomePath(config.tokenFile, homedir());
	try {
		if (process.platform !== "win32") {
			const info = await stat(resolvedPath);
			if ((info.mode & 0o077) !== 0) {
				warnings.push(`tokenFile (${resolvedPath}) should have 0600 permissions`);
			}
		}
		const raw = await readFile(resolvedPath, "utf8");
		return parseTokenFileContent(raw);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			warnings.push(`tokenFile error (${resolvedPath}): ${error instanceof Error ? error.message : String(error)}`);
		}
		return "";
	}
}

export default async function remoteControlExtension(pi: ExtensionAPI): Promise<void> {
	let sessionCtx: ExtensionContext | null = null;
	let wsClient: WsClient | null = null;
	let bridge: RemoteBridge | null = null;
	let remoteTurn = false;
	let lastPrompt = "";
	let lastReply = "";
	let lastShellSummary: string | undefined;
	let currentBranch: string | undefined;
	const toolStartTimes = new Map<string, number>();

	async function runGit(cwd: string, args: readonly string[]): Promise<string | null> {
		try {
			const res = await pi.exec("git", ["-C", cwd, ...args], { timeout: 5_000 });
			return res.code === 0 ? res.stdout : null;
		} catch {
			return null;
		}
	}

	async function refreshBranch(cwd: string): Promise<string | undefined> {
		const out = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
		currentBranch = out ? parseGitBranch(out) : undefined;
		return currentBranch;
	}

	function getSessionId(ctx: ExtensionContext): string {
		try {
			const id = ctx.sessionManager.getSessionId();
			if (id) return id;
		} catch {
			// Fall back to ephemeral id.
		}
		return `ephemeral-${process.pid}`;
	}

	pi.registerCommand("remote", {
		description: "Control pi-remote-control relay connection (status, disconnect, digest, auto, help)",
		handler: async (args, ctx) => {
			const [sub = "status", value] = args.trim().split(/\s+/).filter(Boolean);
			if (sub === "status" || sub === "doctor") {
				if (!bridge) {
					ctx.ui.notify("remote-control: not initialized.", "warning");
					return;
				}
				ctx.ui.notify(formatStatusReport(bridge.statusSnapshot()), "info");
				return;
			}
			if (sub === "disconnect") {
				const count = bridge?.disconnectAll() ?? 0;
				ctx.ui.notify(`remote-control: revoked ${count} paired client(s).`, "info");
				return;
			}
			if (sub === "digest") {
				await bridge?.emitDigest();
				ctx.ui.notify("remote-control: digest pushed.", "info");
				return;
			}
			if (sub === "auto" && (value === "on" || value === "off")) {
				if (!bridge) {
					ctx.ui.notify("remote-control: not initialized.", "warning");
					return;
				}
				bridge.setAutoApprove(value === "on", "local terminal");
				return;
			}
			ctx.ui.notify("Usage: /remote [status|doctor|digest|disconnect|auto on|auto off]", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;
		const { config, warnings } = await loadExtensionConfig({
			cwd: ctx.cwd,
			homeDir: homedir(),
			configDirName: CONFIG_DIR_NAME,
			projectTrusted: ctx.isProjectTrusted(),
			env: process.env,
		});
		await refreshBranch(ctx.cwd);
		const serverToken = await loadServerToken(config, warnings);

		const host: RemoteHost = {
			sessionId: getSessionId(ctx),
			get sessionName() {
				return pi.getSessionName();
			},
			host: hostname(),
			cwd: ctx.cwd,
			get branch() {
				return currentBranch;
			},
			get model() {
				return ctx.model?.id;
			},
			listCommands: () => pi.getCommands(),
			listModels: () => ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`),
			async setModel(reference) {
				const available = ctx.modelRegistry.getAvailable();
				const exact = available.filter((model) => `${model.provider}/${model.id}` === reference);
				const matches = exact.length > 0 ? exact : available.filter((model) => model.id === reference);
				const [model] = matches;
				if (!model) return "not_found";
				if (matches.length > 1) return "ambiguous";
				return (await pi.setModel(model)) ? "ok" : "no_auth";
			},
			getThinkingLevel: () => pi.getThinkingLevel(),
			setThinkingLevel: (level) => pi.setThinkingLevel(level),
			compact: (instructions) =>
				new Promise<void>((resolve, reject) => {
					(sessionCtx ?? ctx).compact({
						...(instructions ? { customInstructions: instructions } : {}),
						onComplete: () => resolve(),
						onError: reject,
					});
				}),
			isIdle: () => (sessionCtx ? sessionCtx.isIdle() : true),
			sendPrompt(text, options) {
				const content =
					options?.images && options.images.length > 0
						? [
								{ type: "text" as const, text },
								...options.images.map((img) => ({
									type: "image" as const,
									data: img.data,
									mimeType: img.mediaType,
								})),
							]
						: text;
				try {
					const deliverAs =
						options?.deliverAs ?? (sessionCtx && !sessionCtx.isIdle() ? ("followUp" as const) : undefined);
					pi.sendUserMessage(content, {
						...(deliverAs ? { deliverAs } : {}),
						...(options?.expandPromptTemplates ? { expandPromptTemplates: true } : {}),
					});
				} catch (error) {
					ctx.ui.notify(
						`[remote] failed to inject prompt: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
			},
			abort: () => sessionCtx?.abort(),
			notify: (text, level) => sessionCtx?.ui.notify(text, level ?? "info"),
			onStateChanged: (status, trusted) => {
				sessionCtx?.ui.setStatus(EXTENSION_KEY, formatFooterLabel(status, trusted));
			},
			getHistory: () => {
				try {
					const entries = ctx.sessionManager.getEntries() as unknown as RawSessionEntry[];
					return buildHistorySnapshot(entries, { busy: !ctx.isIdle() });
				} catch {
					return [];
				}
			},
			getDigest: async () => {
				const branch = await refreshBranch(ctx.cwd);
				const numstat = await runGit(ctx.cwd, ["diff", "--numstat", "HEAD"]);
				const changes = numstat ? parseGitNumstat(numstat) : undefined;
				return buildWorkDigest({
					sessionName: pi.getSessionName(),
					cwd: ctx.cwd,
					branch,
					state: ctx.isIdle() ? "idle" : "busy",
					changes,
					testSummary: lastShellSummary,
					lastPrompt,
					lastReply,
				});
			},
			now: () => Date.now(),
			random: () => Math.random(),
		};

		wsClient = new WsClient({
			serverUrl: config.serverUrl,
			reconnectBaseMs: config.reconnectBaseMs,
			reconnectMaxMs: config.reconnectMaxMs,
			getHello: () => ({
				serverToken,
				sessionId: host.sessionId,
				...(host.sessionName ? { sessionName: host.sessionName } : {}),
				host: host.host,
				cwd: host.cwd,
				...(host.branch ? { branch: host.branch } : {}),
				...(host.model ? { model: host.model } : {}),
				state: host.isIdle() ? "idle" : "busy",
				requirePairing: config.requirePairing,
				autoApprove: bridge?.autoApprove ?? false,
			}),
			onMessage: (msg) => {
				void bridge?.handleServerMessage(msg);
			},
			onStatusChange: (status, detail) => {
				bridge?.onConnectionStatus(status, detail);
			},
		});

		bridge = new RemoteBridge({ config, host, sink: wsClient });
		wsClient.start();
		ctx.ui.setStatus(EXTENSION_KEY, formatFooterLabel(wsClient.currentStatus, 0));

		if (warnings.length > 0) {
			ctx.ui.notify(`[remote] ${warnings.join("; ")}`, "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		bridge?.stop();
		wsClient?.stop();
		bridge = null;
		wsClient = null;
		sessionCtx = null;
		remoteTurn = false;
		toolStartTimes.clear();
	});

	pi.on("input", async (event) => {
		remoteTurn = event.source === "extension";
	});

	pi.on("before_agent_start", async (event, ctx) => {
		sessionCtx = ctx;
		if (event.messageType === "user") lastPrompt = event.prompt;
	});

	pi.on("agent_start", async (_event, ctx) => {
		sessionCtx = ctx;
		lastReply = "";
		bridge?.emitSessionState();
		bridge?.emitStreamStart();
	});

	pi.on("message_update", async (event) => {
		const ev = event.assistantMessageEvent;
		if (ev.type === "text_delta") {
			bridge?.emitStreamDelta("text", ev.delta);
		} else if (ev.type === "thinking_delta") {
			bridge?.emitStreamDelta("thinking", ev.delta);
		}
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		const content = event.message.content;
		if (Array.isArray(content)) {
			const text = content
				.filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
				.map((p) => p.text)
				.join("\n");
			if (text) lastReply = text;
		}
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		sessionCtx = ctx;
		toolStartTimes.set(event.toolCallId, Date.now());
		bridge?.emitSessionState(event.toolName);
		bridge?.emitToolStart(event.toolCallId, event.toolName);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		sessionCtx = ctx;
		const startedAt = toolStartTimes.get(event.toolCallId) ?? Date.now();
		toolStartTimes.delete(event.toolCallId);
		if (event.toolName === "bash") {
			lastShellSummary = event.isError ? "bash failed" : "bash ok";
		}
		bridge?.emitToolEnd(event.toolCallId, event.toolName, event.isError === true, Date.now() - startedAt);
		bridge?.emitSessionState();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!remoteTurn || !bridge) return undefined;
		const { remoteToolPolicy, remoteToolApproval } = bridge.config;
		if (decideRemoteToolAccess(remoteToolPolicy, event.toolName) === "block") {
			return { block: true, reason: remoteToolBlockReason(remoteToolPolicy, event.toolName) };
		}
		if (!needsApproval(remoteToolApproval, event.toolName)) return undefined;

		let approved = false;
		let declineReason: ApprovalReason | undefined;
		if (remoteToolApproval === "web") {
			const outcome = await bridge.requestWebApproval(event.toolCallId, event.toolName);
			approved = outcome.approved;
			declineReason = outcome.reason;
		} else if (remoteToolApproval === "local") {
			approved = await ctx.ui.confirm("Remote tool call", `Allow '${event.toolName}' on remote turn?`);
		}
		if (approved) return undefined;
		return { block: true, reason: remoteToolDeclinedReason(event.toolName, declineReason) };
	});

	pi.on("agent_settled", async (_event, ctx) => {
		sessionCtx = ctx;
		remoteTurn = false;
		bridge?.emitStreamEnd(lastReply);
		bridge?.emitSessionState();
	});
}
