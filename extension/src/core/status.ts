/**
 * Pure status and doctor report renderers.
 */

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface StatusSnapshot {
	readonly status: ConnectionStatus;
	readonly serverUrl: string;
	readonly sessionId: string;
	readonly trustedClients: number;
	readonly pendingPairings: number;
	readonly remoteToolPolicy: string;
	readonly remoteToolApproval: string;
	readonly autoApprove: boolean;
	readonly lastError?: string;
}

export function formatFooterLabel(status: ConnectionStatus, trustedClients: number): string {
	if (status === "connected") {
		return trustedClients > 0 ? `remote: on (${trustedClients})` : "remote: on";
	}
	if (status === "connecting") return "remote: connecting";
	if (status === "error") return "remote: error";
	return "remote: off";
}

export function formatStatusReport(s: StatusSnapshot): string {
	const lines = [
		`pi-remote-control status: ${s.status}`,
		`- server: ${s.serverUrl}`,
		`- sessionId: ${s.sessionId}`,
		`- trustedClients: ${s.trustedClients}`,
		`- pendingPairings: ${s.pendingPairings}`,
		`- toolPolicy: ${s.remoteToolPolicy} (approval: ${s.remoteToolApproval})`,
		`- autoApprove: ${s.autoApprove ? "on" : "off"}`,
	];
	if (s.lastError) lines.push(`- lastError: ${s.lastError}`);
	return lines.join("\n");
}
