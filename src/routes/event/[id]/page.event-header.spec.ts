// @vitest-environment happy-dom
// The event page's header: title, date, time, type badge, conductors and the unreadable case.
import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/mocks/session')).localeRuntimeModule()
);
vi.mock('$app/state', async () => (await import('$lib/testing/mocks/events')).appStateModule());
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { REDACT_ATTR } from '$lib/redact/redact';
import { loadEventDetail, EventDetailLoadError } from '$lib/events/eventDetail';
import { IDBFactory } from 'fake-indexeddb';
import { setReadCacheFactory } from '$lib/entu/readCache';
import { pageStub } from '$lib/testing/mocks/events';
import { cfg, setAuthedWithSampledb } from '$lib/testing/pages/event';
import {
	type AppLocale,
	DOUBLED_PROFILES,
	DOUBLED_SEASON_CONDUCTORS,
	entuFetchStub,
	eventEntity,
	type Fixtures,
	seasonEntity,
	seriesEntity,
	setAppLocale,
	useEventPage
} from '$lib/testing/pages/eventDetail';

useEventPage();

function renderEventPage(fixtures: Fixtures = {}) {
	const fetchStub = entuFetchStub(fixtures);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

describe('/event/[id] — header (integration: route param → loadEventDetail → render)', () => {
	it('renders name, type badge, time range (19:00–20:30 Tallinn), duration and location', async () => {
		const { container } = renderEventPage();

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-name"]')?.textContent
			).toContain('Tuesday Rehearsal');
		});

		const type = container.querySelector('[data-testid="event-detail-type"]');
		expect(type).not.toBeNull();
		expect(type!.textContent).toMatch(/rehearsal/i);

		const time = container.querySelector('[data-testid="event-detail-time"]');
		expect(time).not.toBeNull();
		expect(time!.textContent).toContain('19:00');
		expect(time!.textContent).toContain('20:30');

		const duration = container.querySelector('[data-testid="event-detail-duration"]');
		expect(duration).not.toBeNull();
		expect(duration!.textContent).toContain('90');

		const location = container.querySelector('[data-testid="event-detail-location"]');
		expect(location).not.toBeNull();
		expect(location!.textContent).toContain('Rehearsal Hall');
	});

	it('reaches Entu for THIS event in the SELECTED collective (the wire, not a hardcoded fixture)', async () => {
		const { container, fetchStub } = renderEventPage();
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-name"]')?.textContent
			).toContain('Tuesday Rehearsal');
		});
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('/sampledb/') && u.includes('ev1'))).toBe(true);
	});

	it('renders conductor names comma-separated, in resolved order', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			const line = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(line).not.toBeNull();
			expect(line!.textContent).toContain('Mihkel Putrinš, Alice Smith');
		});
	});
});

describe('/event/[id] — description', () => {
	it('renders the description when present', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			const desc = container.querySelector('[data-testid="event-detail-description"]');
			expect(desc).not.toBeNull();
			expect(desc!.textContent).toContain('Come 15 minutes early for warm-ups.');
		});
	});

	it('renders NO description element when event AND series carry none (hidden, not an empty block)', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ description: undefined }),
			series: seriesEntity({ default_description: undefined })
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-name"]')?.textContent
			).toContain('Tuesday Rehearsal');
		});
		expect(container.querySelector('[data-testid="event-detail-description"]')).toBeNull();
	});
});

describe('/event/[id] — back link', () => {
	it('renders a back link to the agenda (/)', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			const back = container.querySelector('[data-testid="event-detail-back"]');
			expect(back).not.toBeNull();
			expect(back!.tagName).toBe('A');
			expect(back!.getAttribute('href')).toBe('/');
		});
	});

	it('renders the ← as decorative markup, not as part of the translated string', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-back"]')).not.toBeNull();
		});
		const back = container.querySelector('[data-testid="event-detail-back"]')!;
		const arrow = [...back.querySelectorAll('span')].find((s) => s.textContent?.includes('←'));
		expect(arrow, 'the ← lives in its own span').not.toBeUndefined();
		expect(arrow!.getAttribute('aria-hidden')).toBe('true');
		expect(back.textContent).toContain('[event_detail_back]');
	});
});

describe('/event/[id] — optional type badge', () => {
	it('renders no type badge at all when the event carries no event_type', async () => {
		const { container } = renderEventPage({ event: eventEntity({ event_type: [] }) });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-type"]')).toBeNull();
	});
});

describe('/event/[id] — event with no start_datetime (renderable-invalid data)', () => {
	it('still renders the whole header; the time line is simply absent (no RangeError mid-render)', async () => {
		const { container } = renderEventPage({ event: eventEntity({ start_datetime: [] }) });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-time"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-location"]')?.textContent).toContain(
			'Rehearsal Hall'
		);
		expect(
			container.querySelector('[data-testid="event-detail-conductors"]')?.textContent
		).toContain('Mihkel Putrinš');
		expect(container.querySelector('[data-testid="event-detail-duration"]')?.textContent).toContain(
			'90'
		);
		expect(container.querySelector('[data-testid="event-detail-load-error"]')).toBeNull();
	});

	it('an UNPARSEABLE start_datetime is treated the same as a missing one', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ start_datetime: [{ datetime: 'not-a-date' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-time"]')).toBeNull();
	});
});

describe('/event/[id] — unknown duration (0)', () => {
	function noDurationAnywhere() {
		return {
			event: eventEntity({ duration_minutes: [] }),
			series: seriesEntity({ duration_minutes: undefined })
		};
	}

	it('renders NO duration line at all — never a literal "0 min"', async () => {
		const { container } = renderEventPage(noDurationAnywhere());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-duration"]')).toBeNull();
	});

	it('collapses the time line to the START time alone — never "19:00–19:00"', async () => {
		const { container } = renderEventPage(noDurationAnywhere());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
		});
		const time = container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
		expect(time).toContain('19:00');
		expect(time).not.toContain('–');
		expect(time.match(/19:00/g)).toHaveLength(1);
	});
});

describe('/event/[id] — type badge is translated', () => {
	it('routes a KNOWN event_type through paraglide, not the raw Entu string', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-type"]')!.textContent).toContain(
			'[event_type_rehearsal]'
		);
	});

	it('falls back to the RAW value for an unknown event_type (visibly wrong beats invisibly blank)', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ event_type: [{ string: 'flashmob' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-type"]')!.textContent).toContain(
			'flashmob'
		);
	});
});

describe('/event/[id] — the date', () => {
	it('shows the Tallinn-zoned weekday + date alongside the time', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-date"]')).not.toBeNull();
		});
		const date = container.querySelector('[data-testid="event-detail-date"]')!.textContent ?? '';
		expect(date).toMatch(/Tuesday/i);
		expect(date).toMatch(/September/i);
		expect(date).toContain('1');
		expect(date.trim()).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const time = container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
		expect(time).toContain('19:00');
		expect(time).toContain('20:30');
	});
});

describe('#251 — event-detail date renders in the app language', () => {
	const expectedDate: Record<AppLocale, string> = {
		en: 'Tuesday, September 1',
		et: 'teisipäev, 1. september',
		lv: 'otrdiena, 1. septembris',
		uk: 'вівторок, 1 вересня'
	};
	for (const locale of ['et', 'en', 'lv', 'uk'] as AppLocale[]) {
		it(`app language '${locale}': the date line reads '${expectedDate[locale]}' regardless of the device locale`, async () => {
			setAppLocale(locale);
			const { container } = renderEventPage();
			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-date"]')).not.toBeNull();
			});
			expect(
				container.querySelector('[data-testid="event-detail-date"]')?.textContent?.trim()
			).toBe(expectedDate[locale]);
			const time = container.querySelector('[data-testid="event-detail-time"]')?.textContent ?? '';
			expect(time).toContain('19:00');
			expect(time).toContain('20:30');
		});
	}

	it('switching the app language re-renders the date WITHOUT a remount (formatter is rebuilt, not a construction-time constant)', async () => {
		setAppLocale('en');
		const { container } = renderEventPage();
		const dateText = () =>
			container.querySelector('[data-testid="event-detail-date"]')?.textContent?.trim();
		await waitFor(() => {
			expect(dateText()).toBe('Tuesday, September 1');
		});

		setAppLocale('et');
		await waitFor(() => {
			expect(dateText()).toBe('teisipäev, 1. september');
		});
	});
});

describe('/event/[id] — event not readable in the selected collective', () => {
	it('loadEventDetail throws an EventDetailLoadError carrying the status', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		const err = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch).catch(
			(e: unknown) => e
		);
		expect(err).toBeInstanceOf(EventDetailLoadError);
		expect((err as EventDetailLoadError).status).toBe(403);
		expect((err as EventDetailLoadError).unavailable).toBe(true);
	});

	it('a 2xx that carried no entity is unavailable too (status 0), not a transient failure', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 200));
		const err = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch).catch(
			(e: unknown) => e
		);
		expect(err).toBeInstanceOf(EventDetailLoadError);
		expect((err as EventDetailLoadError).unavailable).toBe(true);
	});

	it('a 5xx is NOT unavailable — that one is worth retrying', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 503));
		const err = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch).catch(
			(e: unknown) => e
		);
		expect((err as EventDetailLoadError).unavailable).toBe(false);
	});

	it('renders a not-in-this-collective message with NO Retry button on a 404', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({}, 404))
		);
		pageStub.params = { id: 'ev1' };
		pageStub.url = new URL('http://localhost/event/ev1');
		setAuthedWithSampledb();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-not-available"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-retry"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-back"]')).not.toBeNull();
	});

	it('still offers Retry for a genuinely transient failure (network throw)', async () => {
		setReadCacheFactory(new IDBFactory());
		try {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new TypeError('network down');
				})
			);
			pageStub.params = { id: 'ev1' };
			pageStub.url = new URL('http://localhost/event/ev1');
			setAuthedWithSampledb();
			const { container } = render(Page);

			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-load-error"]')).not.toBeNull();
			});
			expect(container.querySelector('[data-testid="event-detail-retry"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-not-available"]')).toBeNull();
			expect(container.querySelector('[data-testid="event-detail-as-of"]')).toBeNull();
		} finally {
			setReadCacheFactory(undefined);
		}
	});
});

describe('/event/[id] — type badge color scheme (#211)', () => {
	const styles = () =>
		import('$lib/events/eventTypeStyles') as Promise<{
			eventTypeBadgeClass: (type: string | undefined) => string;
		}>;

	const expectClasses = (badge: Element, classString: string) => {
		for (const cls of classString.split(/\s+/)) {
			expect(badge.classList.contains(cls), `badge missing class '${cls}'`).toBe(true);
		}
	};

	it("a rehearsal's badge carries eventTypeBadgeClass('rehearsal') — label text intact", async () => {
		const { eventTypeBadgeClass } = await styles();
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass('rehearsal'));
		expect(badge.textContent).toContain('[event_type_rehearsal]');
		expect(badge.children.length).toBe(0);
	});

	it("a social event's badge keeps the quiet default — no type-* token at all", async () => {
		const { eventTypeBadgeClass } = await styles();
		const { container } = renderEventPage({
			event: eventEntity({ event_type: [{ string: 'social' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass('social'));
		expect([...badge.classList].filter((cls) => cls.includes('type-'))).toEqual([]);
	});

	it("an UNKNOWN free-text type ('flashmob') keeps the quiet default and its raw label", async () => {
		const { eventTypeBadgeClass } = await styles();
		const { container } = renderEventPage({
			event: eventEntity({ event_type: [{ string: 'flashmob' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass(undefined));
		expect([...badge.classList].filter((cls) => cls.includes('type-'))).toEqual([]);
		expect(badge.textContent).toContain('flashmob');
	});
});

describe('/event/[id] — #220 AM/PM preference on the time line', () => {
	it("'ampm': the range renders BOTH ends explicit — '7:00 PM–8:30 PM' — and the narrative date stays untouched (rule 7)", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const { container } = renderEventPage();
			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
			});
			const timeLines = [...container.querySelectorAll('[data-testid="event-detail-time"]')];
			expect(timeLines.length).toBeGreaterThan(0);
			for (const el of timeLines) {
				const text = el.textContent ?? '';
				expect(text).toContain('7:00 PM–8:30 PM');
				expect(text).not.toContain('19:00');
				expect(text).not.toContain('20:30');
			}
			const date = container.querySelector('[data-testid="event-detail-date"]')!.textContent ?? '';
			expect(date).toMatch(/Tuesday/i);
			expect(date).toMatch(/September/i);
			expect(date).not.toMatch(/\b(AM|PM)\b/);
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'ampm', unknown duration: the line collapses to the START alone — '7:00 PM', no dash, no invented end", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const { container } = renderEventPage({
				event: eventEntity({ duration_minutes: [] }),
				series: seriesEntity({ duration_minutes: undefined })
			});
			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
			});
			const time =
				container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
			expect(time).toContain('7:00 PM');
			expect(time).not.toContain('–');
			expect(time).not.toContain('19:00');
			expect(time.match(/7:00 PM/g)).toHaveLength(1);
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'24h' (the unset default): byte-identical to today — '19:00' and '20:30', no AM/PM suffix anywhere in the line", async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
		});
		const time = container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
		expect(time).toContain('19:00');
		expect(time).toContain('20:30');
		expect(time).not.toMatch(/\b(AM|PM)\b/);
	});
});

describe('#483 /event/[id] header — a doubled season conductor is named ONCE, for everyone', () => {
	async function conductorLine(container: HTMLElement): Promise<string> {
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-conductors"]')?.textContent
			).toContain('Grace Hopper');
		});
		return (
			container.querySelector('[data-testid="event-detail-conductors"]')?.textContent ?? ''
		).trim();
	}

	it('a NON-editor reader sees "Ada Lovelace" exactly once', async () => {
		const { container } = renderEventPage({
			season: seasonEntity({ conductor: DOUBLED_SEASON_CONDUCTORS }),
			profiles: DOUBLED_PROFILES
		});
		const line = await conductorLine(container);
		expect(container.querySelector('[data-testid="event-edit-btn-name"]')).toBeNull();
		expect(line).toBe('[event_detail_conductor_label]: Ada Lovelace, Grace Hopper');
		expect(line.split('Ada Lovelace').length - 1).toBe(1);
	});

	it('an EDITOR sees "Ada Lovelace" exactly once too — the header is not the place to fix the duplicate', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: seasonEntity({
				conductor: DOUBLED_SEASON_CONDUCTORS,
				_editor: [{ reference: 'p-viewer' }]
			}),
			profiles: DOUBLED_PROFILES
		});
		const line = await conductorLine(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-name"]')).not.toBeNull();
		});
		expect(line).toBe('[event_detail_conductor_label]: Ada Lovelace, Grace Hopper');
		expect(line.split('Ada Lovelace').length - 1).toBe(1);
	});
});

describe('#361 — /event/[id] header: each conductor name is marked', () => {
	it('each name sits in its own marker (exactly the name), the separator is outside every marker', async () => {
		const { container } = renderEventPage();
		const line = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain('Mihkel Putrinš, Alice Smith');
			return el as HTMLElement;
		});
		expectNameMarkedOnce(line, 'Mihkel Putrinš', 'in the event header conductor line');
		expectNameMarkedOnce(line, 'Alice Smith', 'in the event header conductor line');
		const markers = [...line.querySelectorAll(`[${REDACT_ATTR}]`)].map((e) => e.textContent);
		expect(markers).toEqual(['Mihkel Putrinš', 'Alice Smith']);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
