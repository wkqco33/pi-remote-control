/** Runs the built-in slash commands that have an extension API equivalent. */

import { THINKING_LEVELS, type BuiltinCommandName, type ThinkingLevel } from "../core/commands.js";

export type SetModelResult = "ok" | "not_found" | "ambiguous" | "no_auth";

export interface BuiltinHost {
	readonly model?: string;
	isIdle(): boolean;
	/** Models that have authentication configured, as "provider/id". */
	listModels(): string[];
	setModel(reference: string): Promise<SetModelResult>;
	getThinkingLevel(): ThinkingLevel;
	setThinkingLevel(level: ThinkingLevel): void;
	compact(instructions: string | undefined): Promise<void>;
}

export interface CommandResult {
	readonly ok: boolean;
	readonly message: string;
}

const MAX_LISTED_MODELS = 30;
const success = (message: string): CommandResult => ({ ok: true, message });
const failure = (message: string): CommandResult => ({ ok: false, message });

async function runModel(host: BuiltinHost, reference: string): Promise<CommandResult> {
	if (!reference) {
		const models = host.listModels();
		const listed = models.slice(0, MAX_LISTED_MODELS).map((model) => `- ${model}`);
		if (models.length > MAX_LISTED_MODELS) listed.push(`- …and ${models.length - MAX_LISTED_MODELS} more`);
		return success([`Current model: ${host.model ?? "unknown"}`, ...listed].join("\n"));
	}
	const result = await host.setModel(reference);
	if (result === "ok") return success(`Model changed to ${reference}.`);
	if (result === "no_auth") return failure(`No authentication is configured for ${reference}.`);
	if (result === "ambiguous") return failure(`Several providers offer ${reference}. Use provider/id.`);
	return failure(`Unknown model: ${reference}. Run /model to list available models.`);
}

function runThinking(host: BuiltinHost, level: string): CommandResult {
	if (!level) return success(`Thinking level: ${host.getThinkingLevel()} (${THINKING_LEVELS.join(", ")})`);
	const next = THINKING_LEVELS.find((item) => item === level);
	if (!next) return failure(`Unknown thinking level: ${level}. Use one of ${THINKING_LEVELS.join(", ")}.`);
	host.setThinkingLevel(next);
	// pi clamps the level to what the current model supports.
	const applied = host.getThinkingLevel();
	return success(applied === next ? `Thinking level set to ${applied}.` : `Thinking level set to ${applied}; this model does not support ${next}.`);
}

export type SessionCommandName = Exclude<BuiltinCommandName, "update" | "reload">;

export async function runBuiltinCommand(host: BuiltinHost, name: SessionCommandName, args: string): Promise<CommandResult> {
	try {
		if (name === "model") return await runModel(host, args);
		if (name === "thinking") return runThinking(host, args);
		if (!host.isIdle()) return failure("Wait for the current work to finish, or abort it, before /compact.");
		await host.compact(args || undefined);
		return success("Session context compacted.");
	} catch (error) {
		return failure(`/${name} failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
