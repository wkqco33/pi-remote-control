import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExtensionConfig } from "./config-loader.js";

describe("loadExtensionConfig", () => {
	let root: string;
	const write = async (path: string, body: object) => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(body));
	};
	const load = (projectTrusted: boolean, env: Record<string, string> = {}) =>
		loadExtensionConfig({ cwd: join(root, "repo"), homeDir: join(root, "home"), configDirName: ".pi", projectTrusted, env });

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "remote-config-"));
		await write(join(root, "home/.pi/agent/remote-control.json"), { serverUrl: "wss://mine/ws/agent" });
		await write(join(root, "repo/.pi/remote-control.json"), { serverUrl: "wss://theirs/ws/agent", requirePairing: true });
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it("does not apply an untrusted project file", async () => {
		const { config, warnings } = await load(false);
		expect(config).toMatchObject({ serverUrl: "wss://mine/ws/agent", requirePairing: false });
		expect(warnings.join()).toContain("not trusted");
	});

	it("applies only the tightening values of a trusted project", async () => {
		const { config, warnings } = await load(true);
		expect(config).toMatchObject({ serverUrl: "wss://mine/ws/agent", requirePairing: true });
		expect(warnings.join()).toContain("serverUrl");
	});

	it("reads only the file named by PI_REMOTE_CONFIG", async () => {
		const path = join(root, "chosen.json");
		await write(path, { serverUrl: "wss://chosen/ws/agent" });
		const { config } = await load(true, { PI_REMOTE_CONFIG: path });
		expect(config).toMatchObject({ serverUrl: "wss://chosen/ws/agent", requirePairing: false });
	});
});
