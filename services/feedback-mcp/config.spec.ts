// The config file lists every db the server reads, each with its key.
import { describe, expect, it } from 'vitest';
import { loadConfig } from './src/config.ts';

const reader = (text: string) => (path: string) => {
	if (path !== '/etc/fb.json') throw new Error(`unexpected path ${path}`);
	return text;
};

describe('loadConfig', () => {
	it('loads dbs from file', () => {
		const text = JSON.stringify({
			dbs: [
				{ db: 'mvox_alpha', label: 'Alpha', key: 'k-alpha' },
				{ db: 'mvox_beta', label: 'Beta', key: 'k-beta' }
			]
		});
		expect(loadConfig('/etc/fb.json', reader(text))).toEqual([
			{ db: 'mvox_alpha', label: 'Alpha', key: 'k-alpha' },
			{ db: 'mvox_beta', label: 'Beta', key: 'k-beta' }
		]);
	});

	it('throws on duplicate db', () => {
		const text = JSON.stringify({
			dbs: [
				{ db: 'mvox_alpha', label: 'A', key: 'k1' },
				{ db: 'mvox_alpha', label: 'B', key: 'k2' }
			]
		});
		expect(() => loadConfig('/etc/fb.json', reader(text))).toThrow(/duplicate db mvox_alpha/);
	});

	it('throws on a missing or empty dbs list', () => {
		expect(() => loadConfig('/etc/fb.json', reader('{}'))).toThrow(/no dbs/);
		expect(() => loadConfig('/etc/fb.json', reader('{"dbs":[]}'))).toThrow(/no dbs/);
	});

	it('throws on an entry with a missing key', () => {
		const text = JSON.stringify({ dbs: [{ db: 'mvox_alpha', label: 'A' }] });
		expect(() => loadConfig('/etc/fb.json', reader(text))).toThrow(/bad db entry/);
	});
});
