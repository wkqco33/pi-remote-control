/** Reads the extension configuration files. */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	applyProjectConfig,
	parseRemoteConfig,
	resolveRemoteConfig,
	type ParsedConfigResult,
	type RemoteControlConfig,
} from "./config.js";

export interface ConfigLoadOptions {
	readonly cwd: string;
	readonly homeDir: string;
	/** pi's config directory name, ".pi". */
	readonly configDirName: string;
	readonly projectTrusted: boolean;
	readonly env: Record<string, string | undefined>;
}

export interface LoadedConfig {
	readonly config: RemoteControlConfig;
	readonly warnings: string[];
}

/** Returns null when the file does not exist or cannot be used. */
async function readConfigFile(path: string, warnings: string[]): Promise<ParsedConfigResult | null> {
	try {
		const parsed = parseRemoteConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
		warnings.push(...parsed.warnings);
		return parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			warnings.push(`config error (${path}): ${error instanceof Error ? error.message : String(error)}`);
		}
		return null;
	}
}

export async function loadExtensionConfig(options: ConfigLoadOptions): Promise<LoadedConfig> {
	const warnings: string[] = [];
	// PI_REMOTE_CONFIG is chosen by the user, so it replaces both files.
	const override = options.env.PI_REMOTE_CONFIG?.trim();
	const userPath = override || join(options.homeDir, options.configDirName, "agent", "remote-control.json");
	const userFile = await readConfigFile(userPath, warnings);
	const config = resolveRemoteConfig(userFile?.config ?? {}, options.env);
	if (override) return { config, warnings };

	const projectPath = join(options.cwd, options.configDirName, "remote-control.json");
	if (resolve(projectPath) === resolve(userPath)) return { config, warnings };
	// The project file comes with the repository, which the user may not control.
	const projectWarnings: string[] = [];
	const projectFile = await readConfigFile(projectPath, projectWarnings);
	if (!options.projectTrusted) {
		if (projectFile || projectWarnings.length > 0) {
			warnings.push(`ignored ${projectPath} because the project is not trusted`);
		}
		return { config, warnings };
	}
	warnings.push(...projectWarnings);
	if (!projectFile) return { config, warnings };

	const applied = applyProjectConfig(config, projectFile.config);
	if (applied.ignored.length > 0) {
		warnings.push(
			`ignored in ${projectPath}: ${applied.ignored.join(", ")} (project config may only tighten security; set these in ${userPath})`,
		);
	}
	return { config: applied.config, warnings };
}
