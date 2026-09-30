import { goto } from '$app/navigation';

export type PartLabel = NonNullable<App.PageState['partLabel']>;

// The label rides in the navigation state: the entry pages know the part's name, the viewer
// does not.
export function openPart(db: string, fileId: string, label?: PartLabel): void {
	goto(`/part/${fileId}?db=${db}`, { state: label ? { partLabel: label } : {} });
}
