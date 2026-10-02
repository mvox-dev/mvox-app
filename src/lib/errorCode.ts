// Duck-typed on `code`: rejection reasons cross mock boundaries as plain tagged objects.
export function hasErrorCode(reason: unknown, code: string): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === code;
}
