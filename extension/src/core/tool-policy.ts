/**
 * Remote-turn tool policy and approval rules.
 */

export type RemoteToolPolicy = "unrestricted" | "read-only" | "no-tools";
export type RemoteToolApproval = "off" | "local" | "web";

export const READ_ONLY_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];

export function decideRemoteToolAccess(policy: RemoteToolPolicy, toolName: string): "allow" | "block" {
	if (policy === "unrestricted") return "allow";
	if (policy === "no-tools") return "block";
	return READ_ONLY_TOOLS.includes(toolName) ? "allow" : "block";
}

export function needsApproval(approval: RemoteToolApproval, toolName: string): boolean {
	if (approval === "off") return false;
	return !READ_ONLY_TOOLS.includes(toolName);
}

export function remoteToolBlockReason(policy: RemoteToolPolicy, toolName: string): string {
	if (policy === "no-tools") {
		return `Tool '${toolName}' is blocked for remote turns (no-tools policy).`;
	}
	return `Tool '${toolName}' is blocked for remote turns (read-only policy).`;
}

export function remoteToolDeclinedReason(toolName: string): string {
	return `Remote tool '${toolName}' was declined or timed out.`;
}
