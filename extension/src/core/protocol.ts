/**
 * Pure wire protocol types and envelope parser for pi-remote-control.
 * Mirrors `server/internal/protocol/types.go`.
 */

export const PROTOCOL_VERSION = 1;

export type AgentState = "idle" | "busy";
export type DeliverMode = "steer" | "followUp";

export interface PromptImage {
	readonly mediaType: string;
	readonly data: string;
}

export type HistoryToolStatus = "running" | "done" | "failed" | "interrupted";

export type HistoryItem =
	| { readonly role: "user" | "assistant" | "system"; readonly text: string; readonly ts?: number }
	| {
			readonly role: "tool";
			/** Tool name. */
			readonly text: string;
			readonly toolCallId: string;
			readonly status: HistoryToolStatus;
			readonly durationMs?: number;
			readonly ts?: number;
	  };

export interface WireEnvelope<T = unknown> {
	readonly type: string;
	readonly sessionId?: string;
	readonly seq?: number;
	readonly ts?: number;
	readonly clientId?: string;
	readonly payload?: T;
}

export interface PromptSendPayload {
	readonly sessionId?: string;
	readonly text: string;
	readonly deliverAs?: DeliverMode;
	readonly images?: readonly PromptImage[];
}

export interface PairSubmitPayload {
	readonly sessionId?: string;
	readonly code: string;
}

export interface ApprovalResponsePayload {
	readonly sessionId?: string;
	readonly requestId: string;
	readonly approved: boolean;
}

export interface HistoryRequestPayload {
	readonly clientId?: string;
	readonly pairStatusOnly?: boolean;
}

export type ServerInboundMessage =
	| ({ readonly type: "history.request" } & HistoryRequestPayload)
	| { readonly type: "pair.submit"; readonly clientId: string; readonly code: string }
	| {
			readonly type: "prompt.send";
			readonly clientId: string;
			readonly text: string;
			readonly deliverAs?: DeliverMode;
			readonly images?: readonly PromptImage[];
	  }
	| { readonly type: "turn.abort"; readonly clientId: string }
	| { readonly type: "approval.response"; readonly clientId: string; readonly requestId: string; readonly approved: boolean }
	| { readonly type: "approval.mode"; readonly clientId: string; readonly autoApprove: boolean }
	| { readonly type: "digest.request"; readonly clientId: string }
	| { readonly type: "ping" }
	| { readonly type: "pong" }
	| { readonly type: "error"; readonly code: string; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseServerEnvelope(raw: string): ServerInboundMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || typeof parsed.type !== "string") return null;

	const clientId = typeof parsed.clientId === "string" ? parsed.clientId : "";
	const payload = isRecord(parsed.payload) ? parsed.payload : {};

	switch (parsed.type) {
		case "ping":
			return { type: "ping" };
		case "pong":
			return { type: "pong" };
		case "history.request": {
			const reqClient = typeof payload.clientId === "string" ? payload.clientId : clientId || undefined;
			return {
				type: "history.request",
				...(reqClient ? { clientId: reqClient } : {}),
				...(payload.pairStatusOnly === true ? { pairStatusOnly: true } : {}),
			};
		}
		case "pair.submit":
			if (!clientId || typeof payload.code !== "string") return null;
			return { type: "pair.submit", clientId, code: payload.code };
		case "prompt.send": {
			if (!clientId || typeof payload.text !== "string") return null;
			const deliverAs =
				payload.deliverAs === "steer" || payload.deliverAs === "followUp" ? payload.deliverAs : undefined;
			const images = parseImages(payload.images);
			return {
				type: "prompt.send",
				clientId,
				text: payload.text,
				...(deliverAs === undefined ? {} : { deliverAs }),
				...(images === undefined ? {} : { images }),
			};
		}
		case "turn.abort":
			return clientId ? { type: "turn.abort", clientId } : null;
		case "approval.response":
			if (!clientId || typeof payload.requestId !== "string" || typeof payload.approved !== "boolean") return null;
			return { type: "approval.response", clientId, requestId: payload.requestId, approved: payload.approved };
		case "approval.mode":
			if (!clientId || typeof payload.autoApprove !== "boolean") return null;
			return { type: "approval.mode", clientId, autoApprove: payload.autoApprove };
		case "digest.request":
			return clientId ? { type: "digest.request", clientId } : null;
		case "error":
			return {
				type: "error",
				code: typeof payload.code === "string" ? payload.code : "unknown",
				message: typeof payload.message === "string" ? payload.message : "unknown error",
			};
		default:
			return null;
	}
}

function parseImages(raw: unknown): PromptImage[] | undefined {
	if (!Array.isArray(raw) || raw.length === 0) return undefined;
	const out: PromptImage[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		if (typeof item.mediaType === "string" && typeof item.data === "string" && item.data.length > 0) {
			out.push({ mediaType: item.mediaType, data: item.data });
		}
	}
	return out.length > 0 ? out : undefined;
}
