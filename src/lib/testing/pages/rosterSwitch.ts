// A roster write held across a collective switch and settled late: the shared steps of its specs.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { expect, type Mock } from 'vitest';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { deferred, type Deferred } from '$lib/testing/entuFetchKit';
import { q } from './dom';

export type Outcome<T> = { value: T } | { error: unknown };

export function holdNext<T = void>(mock: Mock): Deferred<T> {
	const held = deferred<T>();
	mock.mockImplementationOnce(() => held.promise);
	return held;
}

// The ready test id must be absent before the switch, so finding it means the new load rendered.
export async function switchTo(container: HTMLElement, db: string, readyTestId: string) {
	expect(q(container, readyTestId)).toBeNull();
	selectedCollectiveDbStore.set(db);
	await waitFor(() => {
		expect(q(container, readyTestId)).not.toBeNull();
	});
}

export async function expandGroup(container: HTMLElement, id: string, rowTestId: string) {
	const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
	if (toggle.getAttribute('aria-expanded') !== 'true') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(q(container, rowTestId)).not.toBeNull();
	});
}

// Waits on the held promise itself, then lets every continuation it queued run.
export async function settle<T>(held: Deferred<T>, outcome: Outcome<T>): Promise<void> {
	if ('error' in outcome) held.reject(outcome.error);
	else held.resolve(outcome.value);
	await held.promise.catch(() => undefined);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await tick();
}

export function callCounts(mocks: Mock[]): number[] {
	return mocks.map((mock) => mock.mock.calls.length);
}

// innerHTML misses typed values, which live on the control, not in an attribute.
function screen(container: HTMLElement) {
	const controls = container.querySelectorAll<HTMLInputElement>('input, select, textarea');
	return { html: container.innerHTML, values: [...controls].map((el) => el.value) };
}

// Settling the old write late must leave the page and the wire exactly as they were.
export async function expectLateSettleChangesNothing<T>(
	container: HTMLElement,
	held: Deferred<T>,
	outcome: Outcome<T>,
	writes: Mock[]
): Promise<void> {
	const page = screen(container);
	const calls = callCounts(writes);
	await settle(held, outcome);
	expect(callCounts(writes), 'no write fires for the collective the user left').toEqual(calls);
	expect(screen(container)).toEqual(page);
}

// (*MVOX:Josquin*)
