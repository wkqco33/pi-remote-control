/**
 * Orchestrates pairing, prompt forwarding, streaming deltas, tool approval,
 * history snapshots, and work digests between pi and the Go relay server.
 */

import type { RemoteControlConfig } from "../config.js";
import type { CommandInfo } from "../core/commands.js";
import { createChallenge, formatChallengeCode, verifyChallenge, type PendingChallenge } from "../core/pairing.js";
import type { DeliverMode, HistoryItem, PromptImage, ServerInboundMessage, WireEnvelope } from "../core/protocol.js";
import { redactSecrets } from "../core/redact.js";
import type { ApprovalReason } from "../core/tool-policy.js";
import type { ConnectionStatus, StatusSnapshot } from "../core/status.js";
import type { BuiltinHost } from "./command-handler.js";
import { PromptRouter } from "./prompt-router.js";

export interface RemoteHost extends BuiltinHost {
	readonly sessionId: string;
	readonly sessionName?: string;
	readonly host: string;
	readonly cwd: string;
	readonly branch?: string;
	listCommands(): CommandInfo[];
	sendPrompt(
		text: string,
		options?: { deliverAs?: DeliverMode; images?: readonly PromptImage[]; expandPromptTemplates?: boolean },
	): void;
	abort(): void;
	notify(text: string, level?: "info" | "warning" | "error"): void;
	onStateChanged?(status: ConnectionStatus, trustedClients: number): void;
	getHistory(): HistoryItem[];
	getDigest(): Promise<string>;
	now(): number;
	random(): number;
}

export interface TransportSink {
	readonly currentStatus: ConnectionStatus;
	send(envelope: WireEnvelope): boolean;
}

export interface ApprovalOutcome {
	readonly approved: boolean;
	readonly reason: ApprovalReason;
}

interface PendingApproval {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly expiresAt: number;
	readonly resolve: (outcome: ApprovalOutcome) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

/** Tokens arriving within this window share one frame, which keeps replays short. */
export const DELTA_FLUSH_MS = 50;

interface PendingDelta {
	readonly kind: "text" | "thinking";
	text: string;
	readonly timer: ReturnType<typeof setTimeout>;
}

export class RemoteBridge {
	readonly config: RemoteControlConfig;
	private readonly host: RemoteHost;
	private readonly sink: TransportSink;
	private readonly trustedClients = new Set<string>();
	private readonly pendingChallenges = new Map<string, PendingChallenge>();
	private readonly pendingApprovals = new Map<string, PendingApproval>();
	private approvalCounter = 0;
	private autoApproveEnabled = false;
	private runningTool?: string;
	private pendingDelta?: PendingDelta;
	private readonly prompts: PromptRouter;
	private lastError?: string;

	constructor(options: { config: RemoteControlConfig; host: RemoteHost; sink: TransportSink }) {
		this.config = options.config;
		this.host = options.host;
		this.sink = options.sink;
		this.prompts = new PromptRouter({
			config: this.config,
			host: this.host,
			send: (envelope) => this.send(envelope),
			onCommandSettled: () => this.emitSessionState(this.runningTool),
		});
	}

	get autoApprove(): boolean {
		return this.autoApproveEnabled;
	}

	/** Agent-side mode: stays effective while no browser is connected. */
	setAutoApprove(enabled: boolean, source: string): void {
		if (this.autoApproveEnabled === enabled) return;
		this.autoApproveEnabled = enabled;
		this.host.notify(`[remote] Auto-approve ${enabled ? "on" : "off"} (by ${source}).`, enabled ? "warning" : "info");
		if (enabled) {
			for (const requestId of [...this.pendingApprovals.keys()]) {
				this.settleApproval(requestId, { approved: true, reason: "auto" });
			}
		}
		this.emitSessionState(this.runningTool);
	}

	onConnectionStatus(status: ConnectionStatus, detail?: string): void {
		if (status === "error" && detail) {
			this.lastError = detail;
		} else if (status === "connected") {
			this.lastError = undefined;
		}
		if (status === "disconnected" || status === "error") {
			this.rejectAllApprovals();
		}
		this.host.onStateChanged?.(status, this.trustedClients.size);
	}

	stop(): void {
		this.flushDeltas();
		this.rejectAllApprovals();
	}

	disconnectAll(): number {
		const revokedClients = [...this.trustedClients];
		this.trustedClients.clear();
		this.pendingChallenges.clear();
		this.rejectAllApprovals();
		this.setAutoApprove(false, "local disconnect");
		this.host.onStateChanged?.(this.sink.currentStatus, 0);
		if (this.sink.currentStatus === "connected") {
			for (const clientId of revokedClients) {
				this.issuePairingChallenge(clientId, "pairing_revoked");
			}
		}
		return revokedClients.length;
	}

	statusSnapshot(): StatusSnapshot {
		return {
			status: this.sink.currentStatus,
			serverUrl: this.config.serverUrl,
			sessionId: this.host.sessionId,
			trustedClients: this.trustedClients.size,
			pendingPairings: this.pendingChallenges.size,
			remoteToolPolicy: this.config.remoteToolPolicy,
			remoteToolApproval: this.config.remoteToolApproval,
			autoApprove: this.autoApproveEnabled,
			...(this.lastError ? { lastError: this.lastError } : {}),
		};
	}

	async handleServerMessage(msg: ServerInboundMessage): Promise<void> {
		switch (msg.type) {
			case "history.request": {
				const { clientId } = msg;
				const paired = !this.config.requirePairing || (clientId !== undefined && this.trustedClients.has(clientId));
				if (msg.pairStatusOnly && clientId) {
					this.send({
						type: "pair.status",
						sessionId: this.host.sessionId,
						clientId,
						ts: this.host.now(),
						payload: { paired },
					});
				} else {
					this.send({
						type: "history.snapshot",
						sessionId: this.host.sessionId,
						...(clientId ? { clientId } : {}),
						ts: this.host.now(),
						payload: { items: this.host.getHistory(), ...(clientId ? { paired } : {}) },
					});
				}
				if (clientId && !paired) {
					this.issuePairingChallenge(clientId, "pairing_required");
				} else {
					this.resendPendingApprovals();
				}
				return;
			}
			case "pair.submit":
				this.handlePairSubmit(msg.clientId, msg.code);
				return;
			case "prompt.send":
				if (!this.ensureTrusted(msg.clientId)) return;
				await this.prompts.submit(msg.text, msg.deliverAs, msg.images);
				return;
			case "commands.request":
				if (!this.ensureTrusted(msg.clientId)) return;
				this.prompts.sendCatalog(msg.clientId);
				return;
			case "turn.abort":
				if (!this.ensureTrusted(msg.clientId)) return;
				this.host.abort();
				return;
			case "digest.request":
				if (!this.ensureTrusted(msg.clientId)) return;
				await this.emitDigest();
				return;
			case "approval.response":
				if (!this.ensureTrusted(msg.clientId)) return;
				this.settleApproval(msg.requestId, { approved: msg.approved, reason: "user" });
				return;
			case "approval.mode":
				if (!this.ensureTrusted(msg.clientId)) return;
				this.setAutoApprove(msg.autoApprove, msg.clientId);
				return;
			default:
				return;
		}
	}

	emitSessionState(runningTool?: string): void {
		this.runningTool = runningTool;
		this.send({
			type: "session.state",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: {
				state: this.host.isIdle() ? "idle" : "busy",
				autoApprove: this.autoApproveEnabled,
				...(this.host.sessionName ? { sessionName: this.host.sessionName } : {}),
				...(this.host.branch ? { branch: this.host.branch } : {}),
				...(this.host.model ? { model: this.host.model } : {}),
				...(runningTool ? { runningTool } : {}),
			},
		});
	}

	emitStreamStart(): void {
		this.send({
			type: "stream.start",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: {},
		});
	}

	emitStreamDelta(kind: "text" | "thinking", delta: string): void {
		if (!delta) return;
		if (this.pendingDelta && this.pendingDelta.kind !== kind) this.flushDeltas();
		if (this.pendingDelta) {
			this.pendingDelta.text += delta;
			return;
		}
		const timer = setTimeout(() => this.flushDeltas(), DELTA_FLUSH_MS);
		if (typeof timer === "object" && "unref" in timer) timer.unref();
		this.pendingDelta = { kind, text: delta, timer };
	}

	private flushDeltas(): void {
		const pending = this.pendingDelta;
		if (!pending) return;
		this.pendingDelta = undefined;
		clearTimeout(pending.timer);
		this.sink.send({
			type: "stream.delta",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			// Redacting the joined text also catches secrets split across tokens.
			payload: { kind: pending.kind, delta: redactSecrets(pending.text) },
		});
	}

	/** Every other frame goes out after the buffered text so the order is preserved. */
	private send(envelope: WireEnvelope): boolean {
		this.flushDeltas();
		return this.sink.send(envelope);
	}

	emitStreamEnd(text: string): void {
		this.send({
			type: "stream.end",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { text: redactSecrets(text) },
		});
	}

	emitToolStart(toolCallId: string, toolName: string): void {
		this.send({
			type: "tool.start",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { toolCallId, toolName },
		});
	}

	emitToolEnd(toolCallId: string, toolName: string, isError: boolean, durationMs: number): void {
		this.send({
			type: "tool.end",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { toolCallId, toolName, isError, durationMs },
		});
	}

	async emitDigest(): Promise<void> {
		const markdown = await this.host.getDigest();
		this.send({
			type: "digest.snapshot",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { markdown: redactSecrets(markdown) },
		});
	}

	requestWebApproval(toolCallId: string, toolName: string): Promise<ApprovalOutcome> {
		const requestId = `apr_${this.host.now()}_${++this.approvalCounter}`;
		if (this.autoApproveEnabled) {
			const outcome: ApprovalOutcome = { approved: true, reason: "auto" };
			this.emitApprovalResolved(requestId, outcome);
			return Promise.resolve(outcome);
		}
		const timeoutMs = this.config.approvalTimeoutMs;
		const sent = this.sendApprovalRequest(requestId, toolCallId, toolName, timeoutMs);
		if (!sent) {
			return Promise.resolve({ approved: false, reason: "cancelled" });
		}
		return new Promise<ApprovalOutcome>((resolve) => {
			const timer = setTimeout(() => {
				this.settleApproval(requestId, { approved: false, reason: "timeout" });
			}, timeoutMs);
			if (typeof timer === "object" && "unref" in timer) timer.unref();
			this.pendingApprovals.set(requestId, {
				toolCallId,
				toolName,
				expiresAt: this.host.now() + timeoutMs,
				resolve,
				timer,
			});
		});
	}

	private sendApprovalRequest(requestId: string, toolCallId: string, toolName: string, timeoutMs: number): boolean {
		return this.send({
			type: "approval.request",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { requestId, toolCallId, toolName, timeoutMs },
		});
	}

	/** A browser that reloaded has no replay cursor, so repeat what is still waiting. */
	private resendPendingApprovals(): void {
		for (const [requestId, entry] of this.pendingApprovals) {
			const remainingMs = entry.expiresAt - this.host.now();
			if (remainingMs > 0) this.sendApprovalRequest(requestId, entry.toolCallId, entry.toolName, remainingMs);
		}
	}

	private emitApprovalResolved(requestId: string, outcome: ApprovalOutcome): void {
		this.send({
			type: "approval.resolved",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { requestId, ...outcome },
		});
	}

	private ensureTrusted(clientId: string): boolean {
		if (!this.config.requirePairing || this.trustedClients.has(clientId)) return true;
		this.issuePairingChallenge(clientId, "pairing_required");
		return false;
	}

	private issuePairingChallenge(clientId: string, reason: string): void {
		const now = this.host.now();
		let challenge = this.pendingChallenges.get(clientId);
		if (!challenge || now > challenge.expiresAt) {
			challenge = createChallenge({
				digits: this.config.pairingDigits,
				ttlMs: this.config.pairingTtlMs,
				maxAttempts: this.config.pairingMaxAttempts,
				now,
				random: () => this.host.random(),
			});
			this.pendingChallenges.set(clientId, challenge);
			// Security invariant: code is shown ONLY in the local pi terminal.
			this.host.notify(
				`[remote] Pairing code for ${clientId}: ${formatChallengeCode(challenge.code)}`,
				"info",
			);
		}
		this.send({
			type: "pair.required",
			sessionId: this.host.sessionId,
			clientId,
			ts: now,
			payload: {
				challengeId: challenge.challengeId,
				digits: challenge.code.length,
				expiresAt: challenge.expiresAt,
				reason,
			},
		});
	}

	private handlePairSubmit(clientId: string, code: string): void {
		if (!this.config.requirePairing || this.trustedClients.has(clientId)) {
			this.sendPairResult(clientId, { ok: true, clientId });
			return;
		}
		const challenge = this.pendingChallenges.get(clientId);
		if (!challenge) {
			this.issuePairingChallenge(clientId, "no_active_challenge");
			return;
		}
		const result = verifyChallenge(challenge, code, this.host.now());
		if (result.ok) {
			this.pendingChallenges.delete(clientId);
			this.trustedClients.add(clientId);
			this.host.notify(`[remote] Paired client ${clientId}.`, "info");
			this.host.onStateChanged?.(this.sink.currentStatus, this.trustedClients.size);
			this.sendPairResult(clientId, { ok: true, clientId });
			return;
		}
		if (result.reason === "mismatch" && result.next) {
			this.pendingChallenges.set(clientId, result.next);
		} else {
			this.pendingChallenges.delete(clientId);
		}
		this.sendPairResult(clientId, { ok: false, clientId, error: result.reason });
	}

	private sendPairResult(clientId: string, payload: { ok: boolean; clientId: string; error?: string }): void {
		this.send({
			type: "pair.result",
			sessionId: this.host.sessionId,
			clientId,
			ts: this.host.now(),
			payload,
		});
	}

	private settleApproval(requestId: string, outcome: ApprovalOutcome): void {
		const entry = this.pendingApprovals.get(requestId);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.pendingApprovals.delete(requestId);
		this.emitApprovalResolved(requestId, outcome);
		entry.resolve(outcome);
	}

	private rejectAllApprovals(): void {
		for (const requestId of [...this.pendingApprovals.keys()]) {
			this.settleApproval(requestId, { approved: false, reason: "cancelled" });
		}
	}
}
