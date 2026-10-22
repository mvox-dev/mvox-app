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
	resolveBorrowerNames,
	deriveEditionAvailability,
	deriveWorkAvailability,
	isActiveLending,
	activeLendingForMemberInEdition,
	copyLabel,
	type CopyAvailability
} from './libraryAvailability';
export {
	formatLoanChainLabel,
	heldLoanCopy,
	loanCopyLabel,
	resolveLoanCopies,
	type LoanChain,
	type LoanCopy,
	type SettledReads
} from './loanCopies';
