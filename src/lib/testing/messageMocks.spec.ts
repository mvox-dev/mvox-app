// The shared message mocks return exactly the text the specs that import them assert.
import { describe, expect, it } from 'vitest';
import { echoMessages, englishMessages } from './messageMocks';

type Call = (params?: Record<string, unknown>) => string;
const call = (m: Record<string, unknown>, key: string) => m[key] as Call;

describe('echoMessages', () => {
	it('echoes [key], with the params when given, by default', () => {
		const { m } = echoMessages();
		expect(call(m, 'roster_title')()).toBe('[roster_title]');
		expect(call(m, 'event_when')({ n: 1 })).toBe('[event_when {"n":1}]');
	});

	it('echoes [key] without params in bracket format', () => {
		expect(call(echoMessages('bracket').m, 'event_when')({ n: 1 })).toBe('[event_when]');
	});

	it('echoes key, with non-empty params, in plain format', () => {
		const { m } = echoMessages('plain');
		expect(call(m, 'event_when')({ n: 1 })).toBe('event_when {"n":1}');
		expect(call(m, 'event_when')({})).toBe('event_when');
		expect(call(m, 'event_when')()).toBe('event_when');
	});

	it('echoes key, with any given params, in raw format', () => {
		const { m } = echoMessages('raw');
		expect(call(m, 'event_when')({ n: 1 })).toBe('event_when {"n":1}');
		expect(call(m, 'event_when')({})).toBe('event_when {}');
		expect(call(m, 'event_when')()).toBe('event_when');
	});

	it('echoes the bare key in bare format', () => {
		expect(call(echoMessages('bare').m, 'event_when')({ n: 1 })).toBe('event_when');
	});

	it('returns the copy for a key in it and echoes the rest', () => {
		const { m } = echoMessages('bracket', { agenda_today: () => 'Today' });
		expect(call(m, 'agenda_today')()).toBe('Today');
		expect(call(m, 'agenda_retry')()).toBe('[agenda_retry]');
	});

	it('echoes key names the copy object inherits', () => {
		const { m } = echoMessages('bracket', { agenda_today: () => 'Today' });
		expect(call(m, 'toString')()).toBe('[toString]');
		expect(call(m, 'constructor')()).toBe('[constructor]');
	});
});

describe('echoMessages with the real module', () => {
	it('exports each of its names, echoed or from the copy, and keeps m', () => {
		const real = { nav_agenda: () => 'Agenda', nav_links: () => 'Links', m: {} };
		const mod = echoMessages('bracket', { nav_links: () => 'Lingikogu' }, real);
		expect(Object.keys(mod).sort()).toEqual(['m', 'nav_agenda', 'nav_links']);
		expect(call(mod, 'nav_agenda')()).toBe('[nav_agenda]');
		expect(call(mod, 'nav_links')()).toBe('Lingikogu');
		expect(call(mod.m, 'nav_agenda')()).toBe('[nav_agenda]');
	});
});

describe('englishMessages', () => {
	it('has only the keys in the copy', () => {
		const { m } = englishMessages({ agenda_today: () => 'Today' });
		expect(call(m, 'agenda_today')()).toBe('Today');
		expect(m).not.toHaveProperty('agenda_retry');
	});

	it('exports the copy keys as named exports too', () => {
		const mod = englishMessages({ nav_agenda: () => 'Agenda' });
		expect(call(mod, 'nav_agenda')()).toBe('Agenda');
		expect(mod).not.toHaveProperty('nav_links');
	});
});

// (*MVOX:Josquin*)
