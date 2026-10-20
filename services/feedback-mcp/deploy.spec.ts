// The container's hardening and pinned install, read straight from the files the host applies.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const here = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('compose.snippet.yml', () => {
	const service = parse(here('./compose.snippet.yml')).services['feedback-mcp'];

	it('drops every capability and blocks new privileges', () => {
		expect(service.cap_drop).toEqual(['ALL']);
		expect(service.security_opt).toContain('no-new-privileges:true');
	});

	it('publishes on the tailnet address only', () => {
		expect(service.ports.length).toBeGreaterThan(0);
		for (const port of service.ports) expect(port).toMatch(/^100\.103\.189\.3:/);
	});
});

describe('Dockerfile', () => {
	it('installs from the committed lockfile', () => {
		const dockerfile = here('./Dockerfile');
		expect(dockerfile).toMatch(/COPY [^\n]*pnpm-lock\.yaml/);
		expect(dockerfile).toContain('pnpm install --frozen-lockfile');
		expect(dockerfile).not.toContain('--no-frozen-lockfile');
	});
});
