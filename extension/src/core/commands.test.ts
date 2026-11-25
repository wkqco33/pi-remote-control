import { describe, expect, it } from "vitest";
import { buildCommandCatalog, routeSlashInput, type CommandInfo } from "./commands.js";

const commands: CommandInfo[] = [
	{ name: "review", source: "prompt", description: "Review code" },
	{ name: "skill:verify", source: "skill" },
	{ name: "remote", source: "extension" },
	{ name: "deploy", source: "prompt" },
	{ name: "deploy:1", source: "extension" },
	{ name: "model", source: "prompt" },
];

describe("routeSlashInput", () => {
	it("expands only prompt templates and skills", () => {
		expect(routeSlashInput("/review src/a.ts", commands)).toEqual({ kind: "expand", name: "review", text: "/review src/a.ts" });
		expect(routeSlashInput("/skill:verify", commands).kind).toBe("expand");
	});

	it("rejects extension commands, even when a template shares the name", () => {
		for (const text of ["/remote auto on", "/deploy now", "/deploy:1", "/new", "/unknown"]) {
			expect(routeSlashInput(text, commands).kind, text).toBe("reject");
		}
	});

	it("routes built-ins ahead of templates", () => {
		expect(routeSlashInput("/model  a/b ", commands)).toEqual({ kind: "builtin", name: "model", args: "a/b" });
		expect(routeSlashInput("/compact keep\nthe plan", commands)).toMatchObject({ name: "compact", args: "keep\nthe plan" });
	});

	it("keeps ordinary text, paths, and escaped slashes as text", () => {
		expect(routeSlashInput("hello", commands)).toEqual({ kind: "plain", text: "hello" });
		expect(routeSlashInput("/etc/hosts is wrong", commands)).toMatchObject({ kind: "plain", text: "/etc/hosts is wrong" });
		expect(routeSlashInput("//remote auto on", commands)).toEqual({ kind: "plain", text: "/remote auto on" });
		expect(routeSlashInput("/ spaced", commands).kind).toBe("plain");
	});

	it("lists only commands that can run", () => {
		expect(buildCommandCatalog(commands).map((command) => command.name)).toEqual([
			"compact", "model", "thinking", "review", "skill:verify",
		]);
	});
});
