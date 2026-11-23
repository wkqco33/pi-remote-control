/**
 * Pure history snapshot extraction from pi session entries.
 * Applies secret redaction and size bounds.
 */

import type { HistoryItem } from "./protocol.js";
import { redactSecrets } from "./redact.js";

export interface RawMessageContentPart {
	readonly type?: string;
	readonly text?: string;
}

export interface RawSessionEntry {
	readonly type: string;
	readonly timestamp?: string;
	readonly message?: {
		readonly role?: string;
		readonly content?: unknown;
	};
}

export function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "object" && part !== null) {
			const record = part as RawMessageContentPart;
			if (record.type === "text" && typeof record.text === "string" && record.text.length > 0) {
				parts.push(record.text);
			}
		}
	}
	return parts.join("\n");
}

export function buildHistorySnapshot(
	entries: readonly RawSessionEntry[],
	options: { maxItems?: number; maxItemChars?: number } = {},
): HistoryItem[] {
	const maxItems = options.maxItems ?? 40;
	const maxItemChars = options.maxItemChars ?? 4000;
	const items: HistoryItem[] = [];

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const role = entry.message.role;
		if (role !== "user" && role !== "assistant") continue;
		const rawText = extractTextContent(entry.message.content).trim();
		if (!rawText) continue;

		const redacted = redactSecrets(rawText);
		const text = redacted.length > maxItemChars ? `${redacted.slice(0, maxItemChars - 1)}…` : redacted;
		const parsedTs = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
		items.push({
			role,
			text,
			...(Number.isFinite(parsedTs) ? { ts: parsedTs } : {}),
		});
	}

	if (items.length <= maxItems) return items;
	return items.slice(items.length - maxItems);
}
