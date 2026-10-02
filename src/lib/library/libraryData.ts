// Library read data layer; specs and pages mock this one path, so every part re-exports here.
export {
	listWorks,
	listEditions,
	listAllEditions,
	listCopies,
	listAllCopies,
	listLendings,
	type Work,
	type EditionFile,
	type Edition,
	type Copy,
	type Lending
} from './libraryReads';
export {
	deriveCopyAvailability,
	resolveCopyNames,
	resolveBorrowerNames,
	deriveEditionAvailability,
	deriveWorkAvailability,
	activeLendingForMemberInEdition,
	formatLoanChainLabel,
	resolveCopyChains,
	type CopyAvailability,
	type LoanChain
} from './libraryAvailability';
