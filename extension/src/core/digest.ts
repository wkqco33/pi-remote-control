/**
 * Pure work digest builder for remote status cards.
 */

import { redactSecrets } from "./redact.js";

export interface DigestFileChange {
	readonly path: string;
	readonly added: number;
	readonly deleted: number;
}

export interface DigestInput {
	readonly sessionName?: string;
	readonly cwd: string;
	readonly branch?: string;
	readonly state: "idle" | "busy";
	readonly runningTool?: string;
	readonly changes?: readonly DigestFileChange[];
	readonly testSummary?: string;
	readonly lastPrompt?: string;
	readonly lastReply?: string;
}

export function parseGitBranch(stdout: string): string | undefined {
	const trimmed = stdout.trim();
	return trimmed.length > 0 && trimmed !== "HEAD" ? trimmed : undefined;
}

export function parseGitNumstat(stdout: string, max = 20): DigestFileChange[] {
	const out: DigestFileChange[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const added = parts[0] === "-" ? 0 : Number.parseInt(parts[0] ?? "0", 10);
		const deleted = parts[1] === "-" ? 0 : Number.parseInt(parts[1] ?? "0", 10);
		const path = parts.slice(2).join("\t");
		if (path) {
			out.push({
				path,
				added: Number.isFinite(added) ? added : 0,
				deleted: Number.isFinite(deleted) ? deleted : 0,
			});
		}
		if (out.length >= max) break;
	}
	return out;
}

export function buildWorkDigest(input: DigestInput): string {
	const lines: string[] = [];
	const title = input.sessionName ? `${input.sessionName}` : input.cwd;
	lines.push(`### Session: ${title}`);
	lines.push(`- **cwd:** \`${input.cwd}\``);
	if (input.branch) lines.push(`- **branch:** \`${input.branch}\``);
	lines.push(`- **state:** ${input.state}${input.runningTool ? ` (${input.runningTool})` : ""}`);
	if (input.testSummary) lines.push(`- **last command:** ${redactSecrets(input.testSummary)}`);

	if (input.changes && input.changes.length > 0) {
		lines.push("");
		lines.push("**Changed files:**");
		for (const c of input.changes.slice(0, 15)) {
			lines.push(`- \`${c.path}\` (+${c.added}/-${c.deleted})`);
		}
	}

	if (input.lastPrompt) {
		const p = redactSecrets(input.lastPrompt.trim()).slice(0, 200);
		lines.push("");
		lines.push(`**Last prompt:** ${p}`);
	}
	if (input.lastReply) {
		const r = redactSecrets(input.lastReply.trim()).slice(0, 300);
		lines.push("");
		lines.push(`**Last reply:** ${r}`);
	}

	return lines.join("\n");
}
