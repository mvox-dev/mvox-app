// @vitest-environment happy-dom

// The list frame every main list renders through (#859). Usage, for #861-#864:
//   <ListOfStuff filter={typeFilter} view={viewToggle}>{list body}</ListOfStuff>
// Both snippets are optional; a list with no such control passes neither and gets no slot.
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ListOfStuff from './ListOfStuff.svelte';

afterEach(cleanup);

function snippet(testid: string) {
	return createRawSnippet(() => ({ render: () => `<div data-testid="${testid}">${testid}</div>` }));
}

function q(root: ParentNode, testid: string): HTMLElement | null {
	return root.querySelector(`[data-testid="${testid}"]`);
}

function follows(a: Node, b: Node): boolean {
	// eslint-disable-next-line no-bitwise
	return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('ListOfStuff', () => {
	it('puts the filter above the list, outside it, and the view control inside it, above the rows', () => {
		const { container } = render(ListOfStuff, {
			props: { filter: snippet('my-filter'), view: snippet('my-view'), children: snippet('my-rows') }
		});
		const list = q(container, 'list-of-stuff-body')!;
		const filter = q(container, 'my-filter')!;
		const view = q(container, 'my-view')!;
		const rows = q(container, 'my-rows')!;

		expect(list.contains(filter)).toBe(false);
		expect(follows(filter, list)).toBe(true);
		expect(list.contains(view)).toBe(true);
		expect(list.contains(rows)).toBe(true);
		expect(follows(view, rows)).toBe(true);
		expect(q(container, 'list-of-stuff-filter')!.contains(filter)).toBe(true);
		expect(q(container, 'list-of-stuff-view')!.contains(view)).toBe(true);
	});

	it('with neither control renders the rows alone: no slot markup at all', () => {
		const { container } = render(ListOfStuff, { props: { children: snippet('my-rows') } });
		const list = q(container, 'list-of-stuff-body')!;

		expect(q(container, 'list-of-stuff-filter')).toBeNull();
		expect(q(container, 'list-of-stuff-view')).toBeNull();
		expect([...list.children].map((el) => el.getAttribute('data-testid'))).toEqual(['my-rows']);
		expect([...q(container, 'list-of-stuff')!.children]).toEqual([list]);
	});

	it('takes one control without the other', () => {
		const viewOnly = render(ListOfStuff, {
			props: { view: snippet('my-view'), children: snippet('my-rows') }
		}).container;
		expect(q(viewOnly, 'list-of-stuff-filter')).toBeNull();
		expect(q(viewOnly, 'list-of-stuff-body')!.contains(q(viewOnly, 'my-view'))).toBe(true);
		cleanup();

		const filterOnly = render(ListOfStuff, {
			props: { filter: snippet('my-filter'), children: snippet('my-rows') }
		}).container;
		expect(q(filterOnly, 'list-of-stuff-view')).toBeNull();
		expect(q(filterOnly, 'list-of-stuff-body')!.contains(q(filterOnly, 'my-filter'))).toBe(false);
	});
});
