/**
 * Pure 6-digit pairing challenge generator and verifier.
 * Codes are shown only in the local pi terminal, never sent to the relay.
 */

export interface PendingChallenge {
	readonly challengeId: string;
	readonly code: string;
	readonly createdAt: number;
	readonly expiresAt: number;
	readonly attemptsLeft: number;
}

export interface CreateChallengeOptions {
	readonly digits: number;
	readonly ttlMs: number;
	readonly maxAttempts: number;
	readonly now: number;
	readonly random: () => number;
}

export function generateNumericCode(digits: number, random: () => number): string {
	let out = "";
	for (let i = 0; i < digits; i++) {
		const n = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 10);
		out += String(n);
	}
	return out;
}

export function createChallenge(options: CreateChallengeOptions): PendingChallenge {
	const code = generateNumericCode(options.digits, options.random);
	const suffix = generateNumericCode(6, options.random);
	return {
		challengeId: `ch_${options.now}_${suffix}`,
		code,
		createdAt: options.now,
		expiresAt: options.now + options.ttlMs,
		attemptsLeft: options.maxAttempts,
	};
}

export type VerifyResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: "expired" | "locked" | "mismatch"; readonly next?: PendingChallenge };

export function verifyChallenge(
	challenge: PendingChallenge,
	submitted: string,
	now: number,
): VerifyResult {
	if (now > challenge.expiresAt) {
		return { ok: false, reason: "expired" };
	}
	const trimmed = submitted.trim().replace(/[\s-]+/g, "");
	if (trimmed === challenge.code) {
		return { ok: true };
	}
	const remaining = challenge.attemptsLeft - 1;
	if (remaining <= 0) {
		return { ok: false, reason: "locked" };
	}
	return {
		ok: false,
		reason: "mismatch",
		next: { ...challenge, attemptsLeft: remaining },
	};
}

export function formatChallengeCode(code: string): string {
	if (code.length === 6) return `${code.slice(0, 3)}-${code.slice(3)}`;
	return code;
}
