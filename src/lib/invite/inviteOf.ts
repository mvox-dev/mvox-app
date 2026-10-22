// An identity value's invite token, and whether it is pending: Entu reads one back as `true`.
export function inviteOf(entry: { invite?: unknown }): string | undefined {
	return typeof entry.invite === 'string' && entry.invite.length > 0 ? entry.invite : undefined;
}

export function isPendingInvite(entry: { invite?: unknown }): boolean {
	return entry.invite === true || inviteOf(entry) !== undefined;
}
