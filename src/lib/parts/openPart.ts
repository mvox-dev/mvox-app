// Opens the part viewer; the label rides in the navigation state, since only callers know it.
import { goto } from '$app/navigation';

export type PartLabel = NonNullable<App.PageState['partLabel']>;

export function openPart(db: string, fileId: string, label?: PartLabel): void {
	goto(`/part/${fileId}?db=${db}`, { state: label ? { partLabel: label } : {} });
}
