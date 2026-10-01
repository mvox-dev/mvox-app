// A stand-in for the send #611 builds; until then the editor shows the failure.
import type { CreateFeedbackInput } from './feedbackActions';

export async function sendFeedback(draft: CreateFeedbackInput): Promise<void> {
	throw new Error(`sending feedback for ${draft.pagePath} arrives with #611`);
}
