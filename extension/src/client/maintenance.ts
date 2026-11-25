/**
 * Remote `/update` and `/reload`. Both change the code that pi runs, so they are
 * off unless the user's own config enables them.
 */

import type { RemoteControlConfig } from "../config.js";
import type { CommandResult } from "./command-handler.js";

export const SELF_PACKAGE_SOURCE = "npm:@wkqco33/pi-remote-control";
export const CONFIRM_WINDOW_MS = 60_000;
const MAX_OUTPUT_CHARS = 1_500;

export interface UpdateRun {
	readonly code: number;
	readonly output: string;
}

export interface MaintenanceHost {
	isIdle(): boolean;
	now(): number;
	/** Runs the pi CLI with a fixed argument list, without a shell. */
	runPiUpdate(args: readonly string[]): Promise<UpdateRun>;
	reload(): void;
}

interface PendingUpdate {
	readonly clientId: string;
	readonly args: readonly string[];
	readonly expiresAt: number;
}

const success = (message: string): CommandResult => ({ ok: true, message });
const failure = (message: string): CommandResult => ({ ok: false, message });

export function maintenanceRefusal(config: RemoteControlConfig, idle: boolean): string | null {
	if (config.remoteUpdate === "off") {
		return 'Remote updates are disabled. Set "remoteUpdate" to "self" or "all" in your user config on the pi machine.';
	}
	if (config.remoteToolPolicy !== "unrestricted") {
		return `Remote updates are not allowed with the ${config.remoteToolPolicy} tool policy.`;
	}
	if (!idle) return "Wait for the current work to finish, or abort it, first.";
	return null;
}

export class Maintenance {
	private pending?: PendingUpdate;
	private readonly config: RemoteControlConfig;
	private readonly host: MaintenanceHost;

	constructor(config: RemoteControlConfig, host: MaintenanceHost) {
		this.config = config;
		this.host = host;
	}

	/** `/update [self] [confirm]`. The first call only describes what would run. */
	async update(clientId: string, input: string): Promise<CommandResult> {
		const refusal = maintenanceRefusal(this.config, this.host.isIdle());
		if (refusal) return failure(refusal);

		const words = input.split(/\s+/).filter(Boolean);
		const confirmed = words.at(-1) === "confirm";
		const target = (confirmed ? words.slice(0, -1) : words).join(" ");
		if (target !== "" && target !== "self") return failure("Usage: /update [self] [confirm]");

		const everything = this.config.remoteUpdate === "all" && target === "";
		// --no-approve keeps packages declared by the repository out of the update.
		const args = ["update", ...(everything ? ["--extensions"] : [SELF_PACKAGE_SOURCE]), "--no-approve"];
		const commandLine = `pi ${args.join(" ")}`;

		if (!confirmed) {
			this.pending = { clientId, args, expiresAt: this.host.now() + CONFIRM_WINDOW_MS };
			const confirm = target ? "/update self confirm" : "/update confirm";
			return success(`This will run \`${commandLine}\` on the pi machine. Send ${confirm} within 60 seconds.`);
		}

		const pending = this.pending;
		this.pending = undefined;
		if (!pending || pending.clientId !== clientId || pending.expiresAt < this.host.now() || pending.args.join() !== args.join()) {
			return failure("Nothing to confirm. Send the update command again without confirm.");
		}

		const run = await this.host.runPiUpdate(args);
		const output = run.output.trim().slice(-MAX_OUTPUT_CHARS);
		if (run.code !== 0) return failure(`\`${commandLine}\` failed with exit code ${run.code}.\n${output}`);
		return success(`\`${commandLine}\` finished.\n${output}\nSend /reload to load the updated extensions.`);
	}

	/** Validates a reload. The caller sends the result first, because reloading drops the connection. */
	prepareReload(input: string): CommandResult {
		const refusal = maintenanceRefusal(this.config, this.host.isIdle());
		if (refusal) return failure(refusal);
		if (input) return failure("Usage: /reload");
		return success("Reloading pi. The session reconnects shortly; auto-approve and pairing start off again.");
	}

	reload(): void {
		this.host.reload();
	}
}
