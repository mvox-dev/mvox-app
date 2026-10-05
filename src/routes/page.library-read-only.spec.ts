// @vitest-environment happy-dom
// The library page: the read-only structural guard.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { LIBRARY_SURFACES } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';

useLibraryPage();

// The data layer's header quotes a write method to state the rule; only code must lack it.
function stripLineComments(src: string): string {
	return src
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n');
}

describe('/library — read-only structural guard', () => {
	it.each([
		'src/lib/library/libraryData.ts',
		'src/lib/library/libraryReads.ts',
		'src/lib/library/libraryAvailability.ts'
	])('the data layer module %s never contains a write-method call (no POST/PUT/DELETE)', (file) => {
		const src = readFileSync(resolve(process.cwd(), file), 'utf-8');
		expect(stripLineComments(src)).not.toMatch(/method:\s*['"](POST|PUT|DELETE)['"]/);
	});

	it.each(LIBRARY_SURFACES)('%s never contains a write-method call (no POST/PUT/DELETE)', (file) => {
		const src = readFileSync(resolve(process.cwd(), file), 'utf-8');
		expect(stripLineComments(src)).not.toMatch(/method:\s*['"](POST|PUT|DELETE)['"]/);
	});
});

// (*MVOX:Tallis*)
