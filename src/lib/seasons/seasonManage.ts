// Season management data layer; specs and pages mock this one path, so every part re-exports here.
export {
	listEventSeriesForSeason,
	listSeriesOptionsForSeason,
	type SeriesListItem,
	type SeriesListRead,
	type SeriesOption
} from './seasonSeriesList';
export {
	updateSeasonField,
	addSeasonConductor,
	removeSeasonConductor,
	type SeasonEditableField
} from './seasonFieldEdit';
export { getSeriesDefaults, type SeriesDefaults } from './seasonSeriesDefaults';
export { countSeriesOccurrences, deleteEvent } from './seasonDeleteEvent';
export { deleteEventSeries, countSeasonScope, deleteSeason } from './seasonDeleteCascade';
