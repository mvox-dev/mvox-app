import { describe, expect, it } from 'vitest';
import { SURFACE_EXEMPT, selectSurfaces, surfacesUnder, svelteSurfaces } from './svelteSurfaces';

describe('selectSurfaces', () => {
	it('a new component is a surface the moment its path exists, no list edited', () => {
		expect(
			selectSurfaces(['src/routes/+page.svelte', 'src/lib/x/New.svelte', 'src/lib/x/new.ts'])
		).toEqual(['src/lib/x/New.svelte', 'src/routes/+page.svelte']);
	});

	it('drops exempt folders and anything outside src/', () => {
		expect(
			selectSurfaces([
				'src/lib/testing/comment-rules-fixtures/compliant.svelte',
				'scripts/Tool.svelte'
			])
		).toEqual([]);
	});

	it('every exemption carries a reason', () => {
		for (const reason of Object.values(SURFACE_EXEMPT)) expect(reason.trim()).not.toBe('');
	});
});

describe('svelteSurfaces', () => {
	it('walks the real tree: the scans read every component there is', () => {
		const surfaces = svelteSurfaces();
		expect(surfaces).toContain('src/lib/components/nav/NavShell.svelte');
		expect(surfaces).toContain('src/routes/auth/callback/+page.svelte');
		expect(surfaces.length).toBeGreaterThanOrEqual(72);
		expect(surfaces.some((path) => path.includes('comment-rules-fixtures'))).toBe(false);
	});

	it('surfacesUnder narrows the walk to an area, a new file there included', () => {
		expect(surfacesUnder('src/routes/event/', 'src/lib/events/')).toEqual([
			'src/lib/events/EventAttendanceSection.svelte',
			'src/lib/events/EventConvertForm.svelte',
			'src/lib/events/EventDangerZone.svelte',
			'src/lib/events/EventFieldEdit.svelte',
			'src/lib/events/EventRsvpSection.svelte',
			'src/lib/events/EventScheduleSection.svelte',
			'src/lib/events/EventWorksSection.svelte',
			'src/routes/event/[id]/+page.svelte'
		]);
	});
});
