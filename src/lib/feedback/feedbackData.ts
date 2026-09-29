// #395 slice 2/2 GREEN — loadFeedback: read ONE feedback for FeedbackView.
// See feedbackData.spec.ts's header for the full pinned contract; the shape
// in short:
//
//   1. GET entity/{feedbackId}?props=screenshot,doodle_layer,description —
//      only the three fields; no reference `.string` is ever read (a
//      reference `.string` bakes PII — `.reference` only, and only for
//      rights; this reader has no reference prop at all).
//   2. GET property/{screenshotPropertyId} — the signed download url, via
//      the existing signFileUrl ($lib/repertoire/fileUrls), minted at read
//      time (a 60s TTL — never cached).
//
// FAIL LOUDLY: non-2xx read, no screenshot property, missing or corrupt
// doodle_layer (strokes.ts's own parse — no silent repair), or a signing
// failure all reject.
//
// REVIEW ROUND (#395, F1): `description` is OPTIONAL on the type — the
// schema of record (mvox-schema-extensions.ts) puts no `mandatory` on the
// field — so a feedback that is a screenshot plus ink and no typed words is a
// schema-valid record. It reads as '' (the house pattern for every optional text prop:
// repertoireData.ts, linkData.ts, eventDetail.ts) instead of rejecting — a
// hard throw made such a submission permanently unviewable. The three loud
// rejections above stay: they ARE load-bearing.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
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

// (*MVOX:Palestrina* — #395 slice 2/2 GREEN)
