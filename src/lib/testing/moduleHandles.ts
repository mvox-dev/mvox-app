// Shared handles for page-import mocks: spec and vi.mock factory import here, one vi.fn each.
import { vi } from 'vitest';

export const loadFullAgendaMock = vi.fn();
export const listSectionsMock = vi.fn();

export function agendaDataModule() {
	return {
		loadFullAgenda: loadFullAgendaMock
	};
}

export function sectionDataModule(actual: unknown) {
	return { ...(actual as object), listSections: listSectionsMock };
}

// (*MVOX:Josquin*)
