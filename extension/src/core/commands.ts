/**
 * Pure routing for slash commands typed in the web UI.
 *
 * Extension commands are never dispatched: pi runs their handlers without the
 * `input` and `tool_call` events, so remote tool policy could not apply to them.
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export type BuiltinCommandName = "compact" | "model" | "thinking";

export interface CommandInfo {
	readonly name: string;
	readonly description?: string;
	readonly source: "extension" | "prompt" | "skill";
}

export interface CatalogCommand {
	readonly name: string;
	readonly description?: string;
	readonly source: "builtin" | "prompt" | "skill";
}

export const BUILTIN_COMMANDS: readonly (CatalogCommand & { readonly name: BuiltinCommandName })[] = [
	{ name: "compact", source: "builtin", description: "Compact the session context [instructions]" },
	{ name: "model", source: "builtin", description: "Show or change the model [provider/id]" },
	{ name: "thinking", source: "builtin", description: "Show or change the thinking level [level]" },
];

export type SlashRoute =
	/** Ordinary prompt text, delivered without any expansion. */
	| { readonly kind: "plain"; readonly text: string }
	/** Prompt template or skill that pi expands into a prompt. */
	| { readonly kind: "expand"; readonly name: string; readonly text: string }
	| { readonly kind: "builtin"; readonly name: BuiltinCommandName; readonly args: string }
	| { readonly kind: "reject"; readonly name: string; readonly reason: string };

function isExtensionCommand(command: CommandInfo, name: string): boolean {
	if (command.source !== "extension") return false;
	// pi suffixes duplicate names, for example "review:1".
	return command.name === name || (command.name.startsWith(`${name}:`) && /^\d+$/.test(command.name.slice(name.length + 1)));
}

export function routeSlashInput(text: string, commands: readonly CommandInfo[]): SlashRoute {
	if (!text.startsWith("/")) return { kind: "plain", text };
	// "//..." is the escape for text that really starts with a slash.
	if (text.startsWith("//")) return { kind: "plain", text: text.slice(1) };

	const match = /^\/(\S*)\s*([\s\S]*)$/.exec(text);
	const name = match?.[1] ?? "";
	// A second slash means a file path, not a command.
	if (!name || name.includes("/")) return { kind: "plain", text };

	const builtin = BUILTIN_COMMANDS.find((command) => command.name === name);
	if (builtin) return { kind: "builtin", name: builtin.name, args: (match?.[2] ?? "").trim() };

	if (commands.some((command) => isExtensionCommand(command, name))) {
		return { kind: "reject", name, reason: `/${name} is an extension command, which cannot be run from the web.` };
	}
	if (commands.some((command) => command.name === name && command.source !== "extension")) {
		return { kind: "expand", name, text };
	}
	return {
		kind: "reject",
		name,
		reason: `/${name} is not a command available from the web. To send it as text, start with "//".`,
	};
}

export function buildCommandCatalog(commands: readonly CommandInfo[]): CatalogCommand[] {
	const expandable = commands.flatMap((command): CatalogCommand[] => {
		if (command.source === "extension") return [];
		// Hide names that routing would reject or handle as a built-in.
		if (routeSlashInput(`/${command.name}`, commands).kind !== "expand") return [];
		return [{ name: command.name, source: command.source, ...(command.description ? { description: command.description } : {}) }];
	});
	return [...BUILTIN_COMMANDS, ...expandable];
}
