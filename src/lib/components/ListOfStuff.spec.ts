// @vitest-environment happy-dom

// The list frame every main list renders through (#859, #869). Usage:
//   <ListOfStuff title={m.x_title()} filter={typeFilter} view={viewToggle}>{rows}</ListOfStuff>
// The title is required; both snippets are optional and a missing one gets no slot.
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

function testids(el: Element): (string | null)[] {
	return [...el.children].map((child) => child.getAttribute('data-testid'));
}

describe('ListOfStuff', () => {
	it('puts the title and the view control on one header line, then the filter, then the rows', () => {
		const { container } = render(ListOfStuff, {
			props: {
				title: 'Members',
				filter: snippet('my-filter'),
				view: snippet('my-view'),
				children: snippet('my-rows')
			}
		});
		const header = q(container, 'list-of-stuff-header')!;
		const title = header.querySelector('h1')!;
		const view = q(container, 'my-view')!;
		const filter = q(container, 'my-filter')!;
		const list = q(container, 'list-of-stuff-body')!;

		expect(title.textContent).toBe('Members');
		expect(testids(header)).toEqual(['list-of-stuff-title', 'list-of-stuff-view']);
		expect(header.contains(view)).toBe(true);
		expect(follows(title, view)).toBe(true);
		expect(testids(q(container, 'list-of-stuff')!)).toEqual([
			'list-of-stuff-header',
			'list-of-stuff-filter',
			'list-of-stuff-body'
		]);
		expect(q(container, 'list-of-stuff-filter')!.contains(filter)).toBe(true);
		expect(testids(list)).toEqual(['my-rows']);
	});

	it('with neither control renders the header with the title alone, then the rows', () => {
		const { container } = render(ListOfStuff, {
			props: { title: 'Members', children: snippet('my-rows') }
		});

		expect(testids(q(container, 'list-of-stuff')!)).toEqual([
			'list-of-stuff-header',
			'list-of-stuff-body'
		]);
		expect(testids(q(container, 'list-of-stuff-header')!)).toEqual(['list-of-stuff-title']);
		expect(testids(q(container, 'list-of-stuff-body')!)).toEqual(['my-rows']);
		expect(container.querySelectorAll('h1')).toHaveLength(1);
	});

	it('takes one control without the other', () => {
		const viewOnly = render(ListOfStuff, {
			props: { title: 'Members', view: snippet('my-view'), children: snippet('my-rows') }
		}).container;
		expect(q(viewOnly, 'list-of-stuff-filter')).toBeNull();
		expect(q(viewOnly, 'list-of-stuff-header')!.contains(q(viewOnly, 'my-view'))).toBe(true);
		cleanup();

		const filterOnly = render(ListOfStuff, {
			props: { title: 'Members', filter: snippet('my-filter'), children: snippet('my-rows') }
		}).container;
		expect(q(filterOnly, 'list-of-stuff-view')).toBeNull();
		expect(testids(q(filterOnly, 'list-of-stuff-header')!)).toEqual(['list-of-stuff-title']);
		expect(follows(q(filterOnly, 'list-of-stuff-header')!, q(filterOnly, 'my-filter')!)).toBe(true);
	});
});
