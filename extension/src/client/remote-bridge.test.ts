import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REMOTE_CONFIG } from "../config.js";
import type { WireEnvelope } from "../core/protocol.js";
import { RemoteBridge, type RemoteHost, type TransportSink } from "./remote-bridge.js";

function makeHarness(requirePairing = true) {
	const sent: WireEnvelope[] = [];
	const notices: string[] = [];
	const prompts: Array<{ text: string; deliverAs?: string }> = [];
	let idx = 0;
	const randSeq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.9, 0.8, 0.7, 0.0, 0.9, 0.8];

	const sink: TransportSink = {
		currentStatus: "connected",
		send(env) {
			sent.push(env);
			return true;
		},
	};
	const host: RemoteHost = {
		sessionId: "sess-1",
		host: "box",
		cwd: "/repo",
		isIdle: () => true,
		sendPrompt: (text, opts) => prompts.push({ text, deliverAs: opts?.deliverAs }),
		abort: vi.fn(),
		notify: (text) => notices.push(text),
		getHistory: () => [{ role: "user", text: "hi" }],
		getDigest: async () => "digest md",
		now: () => 1000,
		random: () => randSeq[idx++ % randSeq.length] ?? 0,
	};
	const bridge = new RemoteBridge({
		config: { ...DEFAULT_REMOTE_CONFIG, requirePairing, approvalTimeoutMs: 5000 },
		host,
		sink,
	});
	return { bridge, sent, notices, prompts, host };
}

describe("RemoteBridge", () => {
	it("blocks unauthenticated prompt, shows pairing code only locally, and pairs", async () => {
		const { bridge, sent, notices, prompts } = makeHarness(true);
		await bridge.handleServerMessage({ type: "prompt.send", clientId: "web-1", text: "hack" });
		expect(prompts).toHaveLength(0);
		expect(notices[0]).toContain("123-456");
		expect(sent[0]).toMatchObject({ type: "pair.required", clientId: "web-1" });
		expect(JSON.stringify(sent)).not.toContain("123456");

		await bridge.handleServerMessage({ type: "pair.submit", clientId: "web-1", code: "123456" });
		expect(sent.at(-1)?.type).toBe("pair.result");
		expect((sent.at(-1)?.payload as { ok: boolean }).ok).toBe(true);

		await bridge.handleServerMessage({ type: "prompt.send", clientId: "web-1", text: "hello" });
		expect(prompts).toEqual([{ text: "hello", deliverAs: undefined }]);
	});

	it("refreshes pairing state separately for each subscribed browser", async () => {
		const { bridge, sent } = makeHarness();
		await bridge.handleServerMessage({ type: "history.request", clientId: "web-1" });
		expect(sent[0]).toMatchObject({
			type: "history.snapshot", clientId: "web-1", payload: { paired: false },
		});
		await bridge.handleServerMessage({ type: "pair.submit", clientId: "web-1", code: "123456" });

		const beforeRefresh = sent.length;
		await bridge.handleServerMessage({ type: "history.request", clientId: "web-2" });
		await bridge.handleServerMessage({ type: "history.request", clientId: "web-1", pairStatusOnly: true });
		expect(sent.slice(beforeRefresh)).toMatchObject([
			{ type: "history.snapshot", clientId: "web-2", payload: { paired: false } },
			{ type: "pair.required", clientId: "web-2" },
			{ type: "pair.status", clientId: "web-1", payload: { paired: true } },
		]);

		expect(bridge.disconnectAll()).toBe(1);
		expect(sent.at(-1)).toMatchObject({ type: "pair.required", clientId: "web-1", payload: { reason: "pairing_revoked" } });
	});

	it("accepts prompts directly when the session disables pairing", async () => {
		const { bridge, sent, notices, prompts } = makeHarness(false);
		await bridge.handleServerMessage({ type: "history.request", clientId: "web-1" });
		await bridge.handleServerMessage({ type: "prompt.send", clientId: "web-1", text: "hello" });
		expect(sent).toMatchObject([
			{ type: "history.snapshot", clientId: "web-1", payload: { paired: true } },
		]);
		expect(notices).toHaveLength(0);
		expect(prompts).toEqual([{ text: "hello", deliverAs: undefined }]);
	});

	it("coalesces stream deltas and keeps them ahead of later frames", () => {
		vi.useFakeTimers();
		try {
			const { bridge, sent } = makeHarness(false);
			bridge.emitStreamDelta("thinking", "hm");
			bridge.emitStreamDelta("text", "sk-ant-api03-12345678");
			bridge.emitStreamDelta("text", "90abcdef done");
			expect(sent.map((e) => e.payload)).toEqual([{ kind: "thinking", delta: "hm" }]);
			bridge.emitToolStart("tc-1", "bash");
			expect(sent.map((e) => e.type)).toEqual(["stream.delta", "stream.delta", "tool.start"]);
			expect(JSON.stringify(sent[1])).toContain("[redacted:anthropic-key]");

			bridge.emitStreamDelta("text", "tail");
			vi.advanceTimersByTime(50);
			expect(sent.at(-1)).toMatchObject({ type: "stream.delta", payload: { delta: "tail" } });
			expect(sent).toHaveLength(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it("handles web tool approval and resolves false on disconnect", async () => {
		const { bridge, sent } = makeHarness(false);
		const promise = bridge.requestWebApproval("tc-1", "bash");
		const req = sent.find((e) => e.type === "approval.request");
		expect(req).toBeDefined();
		const requestId = (req?.payload as { requestId: string }).requestId;

		await bridge.handleServerMessage({
			type: "approval.response",
			clientId: "web-1",
			requestId,
			approved: true,
		});
		await expect(promise).resolves.toEqual({ approved: true, reason: "user" });

		const promise2 = bridge.requestWebApproval("tc-2", "bash");
		bridge.onConnectionStatus("disconnected");
		await expect(promise2).resolves.toEqual({ approved: false, reason: "cancelled" });
	});

	it("approves without a browser while auto-approve is on", async () => {
		const { bridge, sent } = makeHarness(false);
		const pending = bridge.requestWebApproval("tc-1", "bash");
		await bridge.handleServerMessage({ type: "approval.mode", clientId: "web-1", autoApprove: true });
		await expect(pending).resolves.toEqual({ approved: true, reason: "auto" });
		expect(sent.at(-1)).toMatchObject({ type: "session.state", payload: { autoApprove: true } });

		bridge.onConnectionStatus("disconnected");
		const before = sent.length;
		await expect(bridge.requestWebApproval("tc-2", "bash")).resolves.toEqual({ approved: true, reason: "auto" });
		expect(sent.slice(before).map((e) => e.type)).toEqual(["approval.resolved"]);

		bridge.disconnectAll();
		expect(bridge.autoApprove).toBe(false);
	});

	it("ignores auto-approve requests from unpaired browsers", async () => {
		const { bridge } = makeHarness(true);
		await bridge.handleServerMessage({ type: "approval.mode", clientId: "web-1", autoApprove: true });
		expect(bridge.autoApprove).toBe(false);
	});

	it("reports a timeout and repeats pending approvals to a returning browser", async () => {
		vi.useFakeTimers();
		try {
			const { bridge, sent } = makeHarness(false);
			const pending = bridge.requestWebApproval("tc-1", "bash");
			await bridge.handleServerMessage({ type: "history.request", clientId: "web-2" });
			expect(sent.filter((e) => e.type === "approval.request")).toHaveLength(2);
			vi.advanceTimersByTime(5000);
			await expect(pending).resolves.toEqual({ approved: false, reason: "timeout" });
			expect(sent.at(-1)).toMatchObject({ type: "approval.resolved", payload: { reason: "timeout" } });
		} finally {
			vi.useRealTimers();
		}
	});
});
