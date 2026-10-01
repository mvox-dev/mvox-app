// The field named by the form's current error points at the form's one error line.
export interface FieldErrorAttrs {
	'aria-invalid': true | undefined;
	'aria-describedby': string | undefined;
}

export function fieldErrorAttrs<F extends string>(
	current: F | null,
	field: F,
	errorId: string
): FieldErrorAttrs {
	const hit = current === field;
	return {
		'aria-invalid': hit ? true : undefined,
		'aria-describedby': hit ? errorId : undefined
	};
}
