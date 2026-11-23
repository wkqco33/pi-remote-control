/**
 * Orchestrates pairing, prompt forwarding, streaming deltas, tool approval,
 * history snapshots, and work digests between pi and the Go relay server.
 */

import type { RemoteControlConfig } from "../config.js";
import { createChallenge, formatChallengeCode, verifyChallenge, type PendingChallenge } from "../core/pairing.js";
import type { DeliverMode, HistoryItem, PromptImage, ServerInboundMessage, WireEnvelope } from "../core/protocol.js";
import { redactSecrets } from "../core/redact.js";
import type { ConnectionStatus, StatusSnapshot } from "../core/status.js";

export interface RemoteHost {
	readonly sessionId: string;
	readonly sessionName?: string;
	readonly host: string;
	readonly cwd: string;
	readonly branch?: string;
	readonly model?: string;
	isIdle(): boolean;
	sendPrompt(text: string, options?: { deliverAs?: DeliverMode; images?: readonly PromptImage[] }): void;
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

interface PendingApproval {
	readonly resolve: (approved: boolean) => void;
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
	private lastError?: string;

	constructor(options: { config: RemoteControlConfig; host: RemoteHost; sink: TransportSink }) {
		this.config = options.config;
		this.host = options.host;
		this.sink = options.sink;
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
		this.rejectAllApprovals();
	}

	disconnectAll(): number {
		const count = this.trustedClients.size;
		this.trustedClients.clear();
		this.pendingChallenges.clear();
		this.rejectAllApprovals();
		this.host.onStateChanged?.(this.sink.currentStatus, 0);
		return count;
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
			...(this.lastError ? { lastError: this.lastError } : {}),
		};
	}

	async handleServerMessage(msg: ServerInboundMessage): Promise<void> {
		switch (msg.type) {
			case "history.request": {
				const items = this.host.getHistory();
				this.sink.send({
					type: "history.snapshot",
					sessionId: this.host.sessionId,
					...(msg.clientId ? { clientId: msg.clientId } : {}),
					ts: this.host.now(),
					payload: { items },
				});
				if (msg.clientId && this.config.requirePairing && !this.trustedClients.has(msg.clientId)) {
					this.issuePairingChallenge(msg.clientId, "pairing_required");
				}
				return;
			}
			case "pair.submit":
				this.handlePairSubmit(msg.clientId, msg.code);
				return;
			case "prompt.send":
				if (!this.ensureTrusted(msg.clientId)) return;
				this.handlePromptSend(msg.text, msg.deliverAs, msg.images);
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
				this.resolveApproval(msg.requestId, msg.approved);
				return;
			default:
				return;
		}
	}

	emitSessionState(runningTool?: string): void {
		this.sink.send({
			type: "session.state",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: {
				state: this.host.isIdle() ? "idle" : "busy",
				...(this.host.sessionName ? { sessionName: this.host.sessionName } : {}),
				...(this.host.branch ? { branch: this.host.branch } : {}),
				...(this.host.model ? { model: this.host.model } : {}),
				...(runningTool ? { runningTool } : {}),
			},
		});
	}

	emitStreamStart(): void {
		this.sink.send({
			type: "stream.start",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: {},
		});
	}

	emitStreamDelta(kind: "text" | "thinking", delta: string): void {
		if (!delta) return;
		this.sink.send({
			type: "stream.delta",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { kind, delta: redactSecrets(delta) },
		});
	}

	emitStreamEnd(text: string): void {
		this.sink.send({
			type: "stream.end",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { text: redactSecrets(text) },
		});
	}

	emitToolStart(toolCallId: string, toolName: string): void {
		this.sink.send({
			type: "tool.start",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { toolCallId, toolName },
		});
	}

	emitToolEnd(toolCallId: string, toolName: string, isError: boolean, durationMs: number): void {
		this.sink.send({
			type: "tool.end",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { toolCallId, toolName, isError, durationMs },
		});
	}

	async emitDigest(): Promise<void> {
		const markdown = await this.host.getDigest();
		this.sink.send({
			type: "digest.snapshot",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: { markdown: redactSecrets(markdown) },
		});
	}

	requestWebApproval(toolCallId: string, toolName: string): Promise<boolean> {
		const requestId = `apr_${this.host.now()}_${++this.approvalCounter}`;
		const sent = this.sink.send({
			type: "approval.request",
			sessionId: this.host.sessionId,
			ts: this.host.now(),
			payload: {
				requestId,
				toolCallId,
				toolName,
				timeoutMs: this.config.approvalTimeoutMs,
			},
		});
		if (!sent) {
			return Promise.resolve(false);
		}
		return new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.pendingApprovals.delete(requestId);
				resolve(false);
			}, this.config.approvalTimeoutMs);
			if (typeof timer === "object" && "unref" in timer) timer.unref();
			this.pendingApprovals.set(requestId, { resolve, timer });
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
		this.sink.send({
			type: "pair.required",
			sessionId: this.host.sessionId,
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
			this.sink.send({
				type: "pair.result",
				sessionId: this.host.sessionId,
				clientId,
				ts: this.host.now(),
				payload: { ok: true, clientId },
			});
			return;
		}
		if (result.reason === "mismatch" && result.next) {
			this.pendingChallenges.set(clientId, result.next);
		} else {
			this.pendingChallenges.delete(clientId);
		}
		this.sink.send({
			type: "pair.result",
			sessionId: this.host.sessionId,
			clientId,
			ts: this.host.now(),
			payload: { ok: false, clientId, error: result.reason },
		});
	}

	private handlePromptSend(text: string, deliverAs?: DeliverMode, images?: readonly PromptImage[]): void {
		const validImages: PromptImage[] = [];
		if (images) {
			for (const img of images.slice(0, this.config.maxImages)) {
				const estimatedBytes = Math.ceil((img.data.length * 3) / 4);
				if (estimatedBytes <= this.config.maxImageBytes) {
					validImages.push(img);
				}
			}
		}
		this.host.sendPrompt(text, {
			...(deliverAs ? { deliverAs } : {}),
			...(validImages.length > 0 ? { images: validImages } : {}),
		});
	}

	private resolveApproval(requestId: string, approved: boolean): void {
		const entry = this.pendingApprovals.get(requestId);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.pendingApprovals.delete(requestId);
		entry.resolve(approved);
	}

	private rejectAllApprovals(): void {
		for (const [id, entry] of this.pendingApprovals.entries()) {
			clearTimeout(entry.timer);
			entry.resolve(false);
			this.pendingApprovals.delete(id);
		}
	}
}
