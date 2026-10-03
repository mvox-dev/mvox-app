// Links page mocks: link reads and writes, and the page state the links page reads.
import { vi } from 'vitest';

export const listLinksMock = vi.fn();
export const createLinkMock = vi.fn();
export const updateLinkMock = vi.fn();
export const reorderLinksMock = vi.fn();
export const deleteLinkMock = vi.fn();

export function linkDataModule() {
	return { listLinks: listLinksMock };
}

export function linkActionsModule() {
	return {
		createLink: createLinkMock,
		updateLink: updateLinkMock,
		reorderLinks: reorderLinksMock,
		deleteLink: deleteLinkMock
	};
}

export function linksPageStateModule() {
	return { page: { url: new URL('https://dev.mvox.eu/links') } };
}

// (*MVOX:Josquin*)
