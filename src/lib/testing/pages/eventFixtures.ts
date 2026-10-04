// Event page fixtures shared word for word: the bare series (no defaults) and a work row.
export function seriesEntity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }]
	};
}

export function workRow(id: string, workName: string, fileId: string) {
	return {
		id,
		kind: 'repertoire' as const,
		workId: `work-${id}`,
		editionId: `ed-${id}`,
		workName,
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: 'Vocal score',
		ordinal: null,
		fileId,
		fileName: fileId === '' ? '' : `${fileId}.pdf`,
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

// (*MVOX:Josquin*)
