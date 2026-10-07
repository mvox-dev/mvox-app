// Entu's own add-passkey page for one database.
export function entuAddPasskeyHref(db: string): string {
	return `https://entu.app/${encodeURIComponent(db)}/passkey`;
}
