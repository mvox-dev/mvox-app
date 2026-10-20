// Each team key may only start the server, with its team fixed by the key.
import { describe, expect, it } from 'vitest';
import { makeAuthorizedKeys } from './make-authorized-keys.ts';

const KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA a@host';
const KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('makeAuthorizedKeys', () => {
	it('each team line gets restrict and forced command', () => {
		expect(makeAuthorizedKeys(`mvox ${KEY_A}\npo-team ${KEY_B}\n`)).toBe(
			`restrict,command="/usr/local/bin/feedback-mcp --team mvox" ${KEY_A}\n` +
				`restrict,command="/usr/local/bin/feedback-mcp --team po-team" ${KEY_B}\n`
		);
	});

	it('rejects team with shell characters', () => {
		expect(() => makeAuthorizedKeys(`mvox;rm ${KEY_A}`)).toThrow(/bad team/);
		expect(() => makeAuthorizedKeys(`Mvox ${KEY_A}`)).toThrow(/bad team/);
		expect(() => makeAuthorizedKeys(`mv"ox ${KEY_A}`)).toThrow(/bad team/);
	});

	it('rejects a line with no key, or options in place of a key', () => {
		expect(() => makeAuthorizedKeys('mvox')).toThrow(/no key/);
		expect(() => makeAuthorizedKeys('mvox   ')).toThrow(/no key/);
		expect(() => makeAuthorizedKeys(`mvox command="sh" ${KEY_A}`)).toThrow(/bad key/);
	});

	it('skips comments and blanks', () => {
		expect(makeAuthorizedKeys(`# team keys\n\n  \nmvox ${KEY_A}\n# end\n`)).toBe(
			`restrict,command="/usr/local/bin/feedback-mcp --team mvox" ${KEY_A}\n`
		);
	});
});
