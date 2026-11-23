import { describe, expect, it } from "vitest";
import { createChallenge, formatChallengeCode, verifyChallenge } from "./pairing.js";

describe("pairing", () => {
	it("creates deterministic 6-digit codes and enforces attempts and TTL", () => {
		let idx = 0;
		const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
		const ch = createChallenge({
			digits: 6,
			ttlMs: 60_000,
			maxAttempts: 2,
			now: 1000,
			random: () => seq[idx++ % seq.length] ?? 0,
		});
		expect(ch.code).toBe("123456");
		expect(formatChallengeCode(ch.code)).toBe("123-456");

		const miss = verifyChallenge(ch, "000000", 2000);
		expect(miss.ok).toBe(false);
		if (!miss.ok && miss.reason === "mismatch" && miss.next) {
			expect(miss.next.attemptsLeft).toBe(1);
			const ok = verifyChallenge(miss.next, "123-456", 3000);
			expect(ok).toEqual({ ok: true });
		}

		expect(verifyChallenge(ch, "123456", 62_000)).toEqual({ ok: false, reason: "expired" });
	});
});
