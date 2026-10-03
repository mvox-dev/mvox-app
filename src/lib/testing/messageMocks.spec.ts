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

	it('echoes the bare key in bare format', () => {
		expect(call(echoMessages('bare').m, 'event_when')({ n: 1 })).toBe('event_when');
	});

	it('returns the copy for a key in it and echoes the rest', () => {
		const { m } = echoMessages('bracket', { agenda_today: () => 'Today' });
		expect(call(m, 'agenda_today')()).toBe('Today');
		expect(call(m, 'agenda_retry')()).toBe('[agenda_retry]');
	});
});

describe('englishMessages', () => {
	it('has only the keys in the copy', () => {
		const { m } = englishMessages({ agenda_today: () => 'Today' });
		expect(call(m, 'agenda_today')()).toBe('Today');
		expect(m).not.toHaveProperty('agenda_retry');
	});
});

// (*MVOX:Josquin*)
