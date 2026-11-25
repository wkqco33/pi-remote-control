/** Turns web input into agent prompts or slash command runs. */

import type { RemoteControlConfig } from "../config.js";
import { buildCommandCatalog, routeSlashInput, THINKING_LEVELS, type BuiltinCommandName } from "../core/commands.js";
import type { DeliverMode, PromptImage, WireEnvelope } from "../core/protocol.js";
import { redactSecrets } from "../core/redact.js";
import { runBuiltinCommand, type CommandResult } from "./command-handler.js";
import type { RemoteHost } from "./remote-bridge.js";

export interface PromptRouterOptions {
	readonly config: RemoteControlConfig;
	readonly host: RemoteHost;
	readonly send: (envelope: WireEnvelope) => boolean;
	/** Called after a built-in command, which may change the model or busy state. */
	readonly onCommandSettled: () => void;
}

export class PromptRouter {
	private readonly options: PromptRouterOptions;
	private builtinRunning = false;

	constructor(options: PromptRouterOptions) {
		this.options = options;
	}

	async submit(text: string, deliverAs?: DeliverMode, images?: readonly PromptImage[]): Promise<void> {
		const { host } = this.options;
		const route = routeSlashInput(text, text.startsWith("/") ? host.listCommands() : []);
		if (route.kind === "reject") {
			this.emitResult(route.name, { ok: false, message: route.reason });
			return;
		}
		if (route.kind === "builtin") {
			await this.runBuiltin(route.name, route.args, Boolean(images?.length));
			return;
		}
		const validImages = this.acceptImages(images);
		host.sendPrompt(route.text, {
			...(route.kind === "expand" ? { expandPromptTemplates: true } : {}),
			...(deliverAs ? { deliverAs } : {}),
			...(validImages.length > 0 ? { images: validImages } : {}),
		});
	}

	sendCatalog(clientId: string): void {
		const { host } = this.options;
		const commands = buildCommandCatalog(host.listCommands()).map((command) =>
			command.description ? { ...command, description: redactSecrets(command.description) } : command,
		);
		this.options.send({
			type: "commands.snapshot",
			sessionId: host.sessionId,
			clientId,
			ts: host.now(),
			payload: { commands, models: host.listModels(), thinkingLevels: THINKING_LEVELS },
		});
	}

	private async runBuiltin(name: BuiltinCommandName, args: string, hasImages: boolean): Promise<void> {
		if (hasImages) {
			this.emitResult(name, { ok: false, message: `/${name} does not accept images.` });
			return;
		}
		if (this.builtinRunning) {
			this.emitResult(name, { ok: false, message: "Another command is still running." });
			return;
		}
		this.builtinRunning = true;
		try {
			this.emitResult(name, await runBuiltinCommand(this.options.host, name, args));
		} finally {
			this.builtinRunning = false;
			this.options.onCommandSettled();
		}
	}

	private acceptImages(images: readonly PromptImage[] = []): PromptImage[] {
		const { maxImages, maxImageBytes } = this.options.config;
		return images.slice(0, maxImages).filter((image) => Math.ceil((image.data.length * 3) / 4) <= maxImageBytes);
	}

	private emitResult(command: string, result: CommandResult): void {
		const { host } = this.options;
		this.options.send({
			type: "command.result",
			sessionId: host.sessionId,
			ts: host.now(),
			payload: { command, ok: result.ok, message: redactSecrets(result.message) },
		});
	}
}
