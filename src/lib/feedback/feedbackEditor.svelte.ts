// The feedback editor's state, shared by its overlay and the bar that replaces the nav.
import { tick } from 'svelte';
import type { StrokeData } from '$lib/strokes/strokes';
import { captureScreen, ClipboardImageUnsupported, copyInked, type Capture } from './capture';
import { sendFeedback } from './sendFeedback';

export type EditorNotice =
	| 'capture-failed'
	| 'copied'
	| 'copy-unsupported'
	| 'copy-failed'
	| 'send-failed'
	| 'send-after-sign-in';

export interface EditorShot extends Capture {
	url: string;
	pagePath: string;
}

const noStrokes = (): StrokeData => ({ v: 1, strokes: [] });

export function createFeedbackEditor() {
	let open = $state(false);
	let shot = $state.raw<EditorShot | null>(null);
	let strokes = $state<StrokeData>(noStrokes());
	let description = $state('');
	let notice = $state<EditorNotice | null>(null);
	let savedForLater = $state(false);
	let capturing = false;
	let stage: HTMLElement | undefined;
	let returnFocus: HTMLElement | null = null;

	async function capture(pagePath: string): Promise<void> {
		if (open || capturing) return;
		capturing = true;
		savedForLater = false;
		const active = document.activeElement;
		returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
		try {
			const taken = await captureScreen();
			shot = { ...taken, url: URL.createObjectURL(taken.blob), pagePath };
			notice = null;
		} catch (e) {
			console.error('feedback screenshot failed', e);
			shot = null;
			notice = 'capture-failed';
		} finally {
			capturing = false;
		}
		strokes = noStrokes();
		description = '';
		open = true;
	}

	// Focus waits a tick: the page is inert until the overlay has gone.
	async function close(): Promise<void> {
		if (shot) URL.revokeObjectURL(shot.url);
		shot = null;
		notice = null;
		open = false;
		const target = returnFocus?.isConnected ? returnFocus : null;
		returnFocus = null;
		await tick();
		(target ?? document.querySelector<HTMLElement>('main.nav-content'))?.focus();
	}

	async function copy(): Promise<void> {
		if (!shot || !stage) return;
		notice = null;
		try {
			await copyInked(stage, shot.width * window.devicePixelRatio);
			notice = 'copied';
		} catch (e) {
			console.error('feedback copy failed', e);
			notice = e instanceof ClipboardImageUnsupported ? 'copy-unsupported' : 'copy-failed';
		}
	}

	async function send(): Promise<void> {
		if (!shot || notice === 'send-after-sign-in') return;
		notice = null;
		try {
			const outcome = await sendFeedback({
				screenshot: shot.blob,
				strokes: $state.snapshot(strokes),
				description,
				pagePath: shot.pagePath
			});
			if (outcome === 'after-sign-in') {
				notice = 'send-after-sign-in';
				return;
			}
			savedForLater = outcome === 'saved';
			close();
		} catch (e) {
			console.error('feedback send failed', e);
			notice = 'send-failed';
		}
	}

	return {
		get open() {
			return open;
		},
		get shot() {
			return shot;
		},
		get strokes() {
			return strokes;
		},
		set strokes(next: StrokeData) {
			strokes = next;
		},
		get description() {
			return description;
		},
		set description(next: string) {
			description = next;
		},
		get notice() {
			return notice;
		},
		get savedForLater() {
			return savedForLater;
		},
		dismissSaved() {
			savedForLater = false;
		},
		get stage() {
			return stage;
		},
		set stage(next: HTMLElement | undefined) {
			stage = next;
		},
		capture,
		close,
		copy,
		send
	};
}

export type FeedbackEditor = ReturnType<typeof createFeedbackEditor>;
