import { describe, expect, it } from "vitest";
import { parseServerEnvelope } from "./protocol.js";

describe("parseServerEnvelope", () => {
	it("parses prompt.send with images and deliverAs", () => {
		const raw = JSON.stringify({
			type: "prompt.send",
			sessionId: "s1",
			clientId: "web-1",
			payload: {
				text: "check this",
				deliverAs: "steer",
				images: [{ mediaType: "image/png", data: "YWJj" }],
			},
		});
		const msg = parseServerEnvelope(raw);
		expect(msg).toEqual({
			type: "prompt.send",
			clientId: "web-1",
			text: "check this",
			deliverAs: "steer",
			images: [{ mediaType: "image/png", data: "YWJj" }],
		});
	});

	it("rejects malformed json or missing clientId", () => {
		expect(parseServerEnvelope("{bad")).toBeNull();
		expect(parseServerEnvelope(JSON.stringify({ type: "prompt.send", payload: { text: "hi" } }))).toBeNull();
	});

	it("parses approval.response", () => {
		const raw = JSON.stringify({
			type: "approval.response",
			clientId: "web-1",
			payload: { requestId: "req-1", approved: true },
		});
		expect(parseServerEnvelope(raw)).toEqual({
			type: "approval.response",
			clientId: "web-1",
			requestId: "req-1",
			approved: true,
		});
	});
});
