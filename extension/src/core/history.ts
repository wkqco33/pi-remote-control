/**
 * Pure history snapshot extraction from pi session entries.
 * Applies secret redaction and size bounds. Tool arguments and results are never included.
 */

import type { HistoryItem, HistoryToolStatus } from "./protocol.js";
import { redactSecrets } from "./redact.js";

export interface RawMessageContentPart {
	readonly type?: string;
	readonly text?: string;
	readonly id?: string;
	readonly name?: string;
}

export interface RawSessionEntry {
	readonly type: string;
	readonly timestamp?: string;
	readonly message?: {
		readonly role?: string;
		readonly content?: unknown;
		readonly toolCallId?: string;
		readonly isError?: boolean;
		readonly durationMs?: number;
	};
}

export interface HistoryOptions {
	/** Maximum number of user and assistant messages. */
	readonly maxItems?: number;
	readonly maxItemChars?: number;
	readonly maxToolItems?: number;
	/** Whether the agent is working, so a tool call without a result may still be running. */
	readonly busy?: boolean;
}

type ToolItem = Extract<HistoryItem, { role: "tool" }>;
type MutableToolItem = { -readonly [Key in keyof ToolItem]: ToolItem[Key] };

function contentParts(content: unknown): RawMessageContentPart[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	return content.filter((part): part is RawMessageContentPart => typeof part === "object" && part !== null);
}

export function extractTextContent(content: unknown): string {
	return contentParts(content)
		.flatMap((part) => (part.type === "text" && typeof part.text === "string" && part.text ? [part.text] : []))
		.join("\n");
}

export function buildHistorySnapshot(entries: readonly RawSessionEntry[], options: HistoryOptions = {}): HistoryItem[] {
	const maxItems = options.maxItems ?? 40;
	const maxItemChars = options.maxItemChars ?? 4000;
	const maxToolItems = options.maxToolItems ?? 100;
	const items: HistoryItem[] = [];
	const unresolved = new Map<string, MutableToolItem>();

	const settleUnresolved = (status: HistoryToolStatus): void => {
		for (const item of unresolved.values()) item.status = status;
		unresolved.clear();
	};

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const { role, content, toolCallId, isError, durationMs } = entry.message;
		if (role === "toolResult") {
			const call = toolCallId ? unresolved.get(toolCallId) : undefined;
			if (!call || !toolCallId) continue;
			call.status = isError ? "failed" : "done";
			if (typeof durationMs === "number") call.durationMs = durationMs;
			unresolved.delete(toolCallId);
			continue;
		}
		if (role !== "user" && role !== "assistant") continue;
		// A new prompt means earlier calls without a result never finished.
		if (role === "user") settleUnresolved("interrupted");

		const parsedTs = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
		const ts = Number.isFinite(parsedTs) ? { ts: parsedTs } : {};
		const rawText = extractTextContent(content).trim();
		if (rawText) {
			const redacted = redactSecrets(rawText);
			const text = redacted.length > maxItemChars ? `${redacted.slice(0, maxItemChars - 1)}…` : redacted;
			items.push({ role, text, ...ts });
		}
		if (role !== "assistant") continue;
		for (const part of contentParts(content)) {
			if (part.type !== "toolCall" || !part.id || !part.name) continue;
			const item: MutableToolItem = { role: "tool", text: part.name, toolCallId: part.id, status: "running", ...ts };
			items.push(item);
			unresolved.set(part.id, item);
		}
	}
	if (!options.busy) settleUnresolved("interrupted");

	return boundHistory(items, maxItems, maxToolItems);
}

/** Bounds messages and tool calls separately so tool-heavy turns keep the conversation. */
function boundHistory(items: readonly HistoryItem[], maxItems: number, maxToolItems: number): HistoryItem[] {
	let messages = 0;
	let tools = 0;
	const kept: HistoryItem[] = [];
	for (let i = items.length - 1; i >= 0 && messages < maxItems; i--) {
		const item = items[i] as HistoryItem;
		if (item.role === "tool") {
			if (tools >= maxToolItems) continue;
			tools += 1;
		} else {
			messages += 1;
		}
		kept.push(item);
	}
	return kept.reverse();
}
