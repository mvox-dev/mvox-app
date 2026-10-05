// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LOCALES } from '$lib/testing/pages/profile';
import { readMessages } from '$lib/testing/pages/files';

describe('#271 — library_create_edition_* copy', () => {
	it('every locale FILE keeps the {name} placeholder in the created-announcement — a locale that drops it announces a nameless creation (survives any later copy refinement)', () => {
		for (const locale of LOCALES) {
			const value = readMessages(locale).library_create_edition_created;
			expect(
				typeof value === 'string' && value.includes('{name}'),
				`${locale}.json library_create_edition_created must interpolate {name}`
			).toBe(true);
		}
	});
});

// (*MVOX:Tallis* — #271 RED)
