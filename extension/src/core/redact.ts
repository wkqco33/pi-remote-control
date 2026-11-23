/**
 * Secret redaction for outbound text leaving the local machine.
 */

export interface RedactionRule {
	readonly name: string;
	readonly pattern: RegExp;
	readonly replacement: string;
}

export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = [
	{
		name: "private-key",
		pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
		replacement: "[redacted:private-key]",
	},
	{ name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, replacement: "[redacted:anthropic-key]" },
	{ name: "openai-key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: "[redacted:openai-key]" },
	{ name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replacement: "[redacted:github-token]" },
	{ name: "slack-bot-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: "[redacted:slack-token]" },
	{ name: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, replacement: "[redacted:npm-token]" },
	{
		name: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
		replacement: "[redacted:jwt]",
	},
	{ name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[redacted:aws-key]" },
	{ name: "google-api-key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g, replacement: "[redacted:google-key]" },
	{
		name: "auth-header",
		pattern: /\b(Authorization|X-Api-Key|X-Auth-Token|X-Access-Token)\s*:\s*(?!\s*Bearer\b)[^\n]*/gi,
		replacement: "$1: [redacted]",
	},
	{
		name: "bearer-header",
		pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
		replacement: "Bearer [redacted]",
	},
	{
		name: "env-secret-assignment",
		pattern:
			/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*(?:"[^"\n]+"|'[^'\n]+'|[^\s"'\n]+)/g,
		replacement: "$1=[redacted]",
	},
];

export function redactSecrets(input: string, rules: readonly RedactionRule[] = DEFAULT_REDACTION_RULES): string {
	let text = input;
	for (const rule of rules) {
		rule.pattern.lastIndex = 0;
		if (rule.pattern.test(text)) {
			rule.pattern.lastIndex = 0;
			text = text.replace(rule.pattern, rule.replacement);
		}
	}
	return text;
}
