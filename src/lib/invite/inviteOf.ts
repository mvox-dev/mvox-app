// The invite token an identity value carries, if any.
export function inviteOf(entry: { invite?: unknown }): string | undefined {
	return typeof entry.invite === 'string' && entry.invite.length > 0 ? entry.invite : undefined;
}
