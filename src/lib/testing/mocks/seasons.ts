// Season-manage, repertoire read and entu request mocks shared across specs.
import { vi } from 'vitest';

export const listEventSeriesForSeasonMock = vi.fn();
export const listSeriesOptionsForSeasonMock = vi.fn();
export const listEventsForSeasonMock = vi.fn();
export const updateSeasonFieldMock = vi.fn();
export const addSeasonConductorMock = vi.fn();
export const removeSeasonConductorMock = vi.fn();
export const getSeriesDefaultsMock = vi.fn();
export const listRepertoireItemsMock = vi.fn();
export const entuFetchMock = vi.fn();
export const listSeasonsMock = vi.fn();

export function seasonManageModule() {
	return {
		listEventSeriesForSeason: listEventSeriesForSeasonMock,
		listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
		listEventsForSeason: listEventsForSeasonMock,
		updateSeasonField: updateSeasonFieldMock,
		addSeasonConductor: addSeasonConductorMock,
		removeSeasonConductor: removeSeasonConductorMock,
		getSeriesDefaults: getSeriesDefaultsMock
	};
}

// 'empty': the read resolves []; 'handle': the spec configures listRepertoireItemsMock.
export function repertoireDataModule(read: 'empty' | 'handle') {
	return {
		listRepertoireItems: read === 'empty' ? vi.fn().mockResolvedValue([]) : listRepertoireItemsMock
	};
}

export async function entuRequestModule(importOriginal: () => Promise<unknown>) {
	return { ...((await importOriginal()) as object), entuFetch: entuFetchMock };
}

export async function repertoireOverRealModule() {
	const actual = await vi.importActual<object>('$lib/repertoire/repertoireData');
	return { ...actual, listRepertoireItems: listRepertoireItemsMock };
}

// Keeps resolveTypeId and the rest of the real module.
export async function entuSeasonsModule() {
	const actual = await vi.importActual<object>('$lib/seasons/entuSeasons');
	return { ...actual, listSeasons: listSeasonsMock };
}

// (*MVOX:Josquin*)
