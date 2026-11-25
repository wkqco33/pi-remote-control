import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import remoteControlExtension from "./index.js";

describe("remoteControlExtension wiring", () => {
	it("registers /remote command and lifecycle handlers without opening sockets at load time", async () => {
		const commands: string[] = [];
		const events: string[] = [];
		const fakePi = {
			registerCommand(name: string) {
				commands.push(name);
			},
			on(event: string) {
				events.push(event);
			},
			exec: vi.fn(),
			sendUserMessage: vi.fn(),
			getSessionName: () => "test",
		} as unknown as ExtensionAPI;

		await remoteControlExtension(fakePi);
		expect(commands).toEqual(["remote", "remote-reload"]);
		expect(events).toContain("session_start");
		expect(events).toContain("session_shutdown");
		expect(events).toContain("message_update");
		expect(events).toContain("tool_call");
		expect(events).toContain("agent_settled");
	});
});
