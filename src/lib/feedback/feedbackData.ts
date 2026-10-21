// Reads one feedback for FeedbackView; fails loudly on a bad read, screenshot or doodle layer.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { signFileUrl } from '$lib/repertoire/fileUrls';
import { parse, type StrokeData } from '$lib/strokes/strokes';

export interface Feedback {
	id: string;
	screenshotUrl: string;
	strokes: StrokeData;
	description: string;
}

interface TextValue {
	_id: string;
	string?: string;
}

interface ScreenshotValue {
	_id: string;
}

interface FeedbackEntity {
	screenshot?: ScreenshotValue[];
	doodle_layer?: TextValue[];
	description?: TextValue[];
}

export async function loadFeedback(
	cfg: EntuCfg,
	feedbackId: string,
	fetchImpl: typeof fetch = fetch
): Promise<Feedback> {
	const res = await entuFetch(
		cfg.db,
		`entity/${feedbackId}?props=screenshot,doodle_layer,description`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`loadFeedback: read failed for '${feedbackId}': HTTP ${res.status}`);

	const body = (await res.json()) as { entity?: FeedbackEntity };
	const entity = body.entity;
	if (!entity) throw new Error(`loadFeedback: no entity in the response for '${feedbackId}'`);

	const screenshot = entity.screenshot?.[0];
	if (!screenshot) throw new Error(`loadFeedback: '${feedbackId}' has no screenshot property`);

	const doodleLayer = entity.doodle_layer?.[0]?.string;
	if (!doodleLayer) throw new Error(`loadFeedback: '${feedbackId}' has no doodle_layer`);
	const strokes = parse(doodleLayer);

	// OPTIONAL on the type — absent means "no typed words", not a broken record.
	const description = entity.description?.[0]?.string ?? '';

	const screenshotUrl = await signFileUrl(cfg, screenshot._id, fetchImpl);

	return { id: feedbackId, screenshotUrl, strokes, description };
}

// (*MVOX:Palestrina*)
