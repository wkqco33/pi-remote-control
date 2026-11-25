import { describe, expect, it } from "vitest";
import { DEFAULT_REMOTE_CONFIG, type RemoteControlConfig } from "../config.js";
import { Maintenance, type MaintenanceHost } from "./maintenance.js";

function setup(overrides: Partial<RemoteControlConfig> = {}, code = 0) {
	const calls: string[] = [];
	const state = { idle: true, now: 1_000 };
	const host: MaintenanceHost = {
		isIdle: () => state.idle,
		now: () => state.now,
		runPiUpdate: async (args) => {
			calls.push(args.join(" "));
			return { code, output: "log line" };
		},
		reload: () => void calls.push("reload"),
	};
	const maintenance = new Maintenance({ ...DEFAULT_REMOTE_CONFIG, remoteUpdate: "all", ...overrides }, host);
	return { maintenance, calls, state };
}

describe("Maintenance", () => {
	it("updates every extension only after confirmation", async () => {
		const { maintenance, calls } = setup();
		expect((await maintenance.update("a", "")).message).toContain("/update confirm");
		expect(calls).toEqual([]);
		expect((await maintenance.update("a", "confirm")).ok).toBe(true);
		expect(calls).toEqual(["update --extensions --no-approve"]);
		expect((await maintenance.update("a", "confirm")).ok).toBe(false);
	});

	it("limits the target to this package when asked or configured", async () => {
		for (const [remoteUpdate, input] of [["all", "self"], ["self", ""]] as const) {
			const { maintenance, calls } = setup({ remoteUpdate });
			await maintenance.update("a", input);
			await maintenance.update("a", `${input} confirm`.trim());
			expect(calls).toEqual(["update npm:@wkqco33/pi-remote-control --no-approve"]);
		}
	});

	it("rejects another client, a changed target, an expired request, and free-form arguments", async () => {
		const { maintenance, calls, state } = setup();
		await maintenance.update("a", "");
		expect((await maintenance.update("b", "confirm")).ok).toBe(false);
		await maintenance.update("a", "self");
		expect((await maintenance.update("a", "confirm")).ok).toBe(false);
		await maintenance.update("a", "");
		state.now += 60_001;
		expect((await maintenance.update("a", "confirm")).ok).toBe(false);
		expect((await maintenance.update("a", "--force confirm")).ok).toBe(false);
		expect(calls).toEqual([]);
	});

	it("is refused when disabled, restricted, or busy", async () => {
		for (const overrides of [{ remoteUpdate: "off" }, { remoteToolPolicy: "read-only" }, { remoteToolPolicy: "no-tools" }] as const) {
			const { maintenance } = setup(overrides);
			expect((await maintenance.update("a", "")).ok).toBe(false);
			expect(maintenance.prepareReload("").ok).toBe(false);
		}
		const busy = setup();
		busy.state.idle = false;
		expect(busy.maintenance.prepareReload("").ok).toBe(false);
	});

	it("reports a failed update", async () => {
		const { maintenance } = setup({}, 1);
		await maintenance.update("a", "");
		expect(await maintenance.update("a", "confirm")).toMatchObject({ ok: false });
	});
});
