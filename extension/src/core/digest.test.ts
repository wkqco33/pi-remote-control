import { describe, expect, it } from "vitest";
import { buildWorkDigest, parseGitBranch, parseGitNumstat } from "./digest.js";

describe("digest", () => {
	it("parses git numstat and renders redacted digest markdown", () => {
		expect(parseGitBranch("main\n")).toBe("main");
		const changes = parseGitNumstat("10\t2\tsrc/app.ts\n");
		expect(changes).toEqual([{ path: "src/app.ts", added: 10, deleted: 2 }]);

		const md = buildWorkDigest({
			sessionName: "demo",
			cwd: "/repo",
			branch: "main",
			state: "idle",
			changes,
			lastPrompt: "use sk-ant-api03-1234567890abcdef",
		});
		expect(md).toContain("### Session: demo");
		expect(md).toContain("`src/app.ts` (+10/-2)");
		expect(md).toContain("[redacted:anthropic-key]");
	});
});
