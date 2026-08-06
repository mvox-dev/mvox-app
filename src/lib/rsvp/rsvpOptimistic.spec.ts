import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyRsvp } from './rsvpData';

const { createRsvpMock, updateRsvpStatusMock, deleteRsvpMock } = vi.hoisted(() => ({
	createRsvpMock: vi.fn(),
	updateRsvpStatusMock: vi.fn(),
	deleteRsvpMock: vi.fn()
}));
vi.mock('./rsvpData', () => ({
	createRsvp: createRsvpMock,
	updateRsvpStatus: updateRsvpStatusMock,
	deleteRsvp: deleteRsvpMock
}));

import { applyRsvpChange } from './rsvpOptimistic';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };
const existing: MyRsvp = { rsvpId: 'rsvp-1', eventId: 'event-e', status: 'going' };

beforeEach(() => {
	createRsvpMock.mockReset();
	updateRsvpStatusMock.mockReset();
	deleteRsvpMock.mockReset();
});

describe('applyRsvpChange — create (no existing rsvp, a status is set)', () => {
	it('calls createRsvp with personId/eventId/memberId/status and returns its new rsvpId', async () => {
		createRsvpMock.mockResolvedValue('new-rsvp-1');
		const result = await applyRsvpChange({
			cfg,
			personId: 'person-p',
			eventId: 'event-e',
			memberId: 'member-m',
			existing: null,
			newStatus: 'going'
		});
		expect(createRsvpMock).toHaveBeenCalledWith(cfg, {
			personId: 'person-p',
			eventId: 'event-e',
			memberId: 'member-m',
			status: 'going'
		});
		expect(result).toEqual({ rsvpId: 'new-rsvp-1' });
		expect(updateRsvpStatusMock).not.toHaveBeenCalled();
		expect(deleteRsvpMock).not.toHaveBeenCalled();
	});

	it('rejects WITHOUT calling createRsvp when memberId is null (non-member data-layer backstop)', async () => {
		await expect(
			applyRsvpChange({
				cfg,
				personId: 'person-p',
				eventId: 'event-e',
				memberId: null,
				existing: null,
				newStatus: 'going'
			})
		).rejects.toThrow();
		expect(createRsvpMock).not.toHaveBeenCalled();
	});
});

describe('applyRsvpChange — update (existing rsvp, a new status is set)', () => {
	it('calls updateRsvpStatus(cfg, existing.rsvpId, newStatus) and returns the same rsvpId', async () => {
		updateRsvpStatusMock.mockResolvedValue(undefined);
		const result = await applyRsvpChange({
			cfg,
			personId: 'person-p',
			eventId: 'event-e',
			memberId: 'member-m',
			existing,
			newStatus: 'maybe'
		});
		expect(updateRsvpStatusMock).toHaveBeenCalledWith(cfg, 'rsvp-1', 'maybe');
		expect(result).toEqual({ rsvpId: 'rsvp-1' });
		expect(createRsvpMock).not.toHaveBeenCalled();
		expect(deleteRsvpMock).not.toHaveBeenCalled();
	});
});

describe('applyRsvpChange — clear (existing rsvp, tap-active-to-toggle-off)', () => {
	it('calls deleteRsvp(cfg, existing.rsvpId) and returns rsvpId:null', async () => {
		deleteRsvpMock.mockResolvedValue(undefined);
		const result = await applyRsvpChange({
			cfg,
			personId: 'person-p',
			eventId: 'event-e',
			memberId: 'member-m',
			existing,
			newStatus: null
		});
		expect(deleteRsvpMock).toHaveBeenCalledWith(cfg, 'rsvp-1');
		expect(result).toEqual({ rsvpId: null });
		expect(createRsvpMock).not.toHaveBeenCalled();
		expect(updateRsvpStatusMock).not.toHaveBeenCalled();
	});
});

describe('applyRsvpChange — no-op (no existing rsvp, no status)', () => {
	it('issues no write at all and returns rsvpId:null', async () => {
		const result = await applyRsvpChange({
			cfg,
			personId: 'person-p',
			eventId: 'event-e',
			memberId: 'member-m',
			existing: null,
			newStatus: null
		});
		expect(result).toEqual({ rsvpId: null });
		expect(createRsvpMock).not.toHaveBeenCalled();
		expect(updateRsvpStatusMock).not.toHaveBeenCalled();
		expect(deleteRsvpMock).not.toHaveBeenCalled();
	});
});

describe('applyRsvpChange — write failure propagates (caller reverts, this does not swallow)', () => {
	it('rejects when the underlying createRsvp rejects', async () => {
		createRsvpMock.mockRejectedValue(new Error('createRsvp failed: 403'));
		await expect(
			applyRsvpChange({
				cfg,
				personId: 'person-p',
				eventId: 'event-e',
				memberId: 'member-m',
				existing: null,
				newStatus: 'going'
			})
		).rejects.toThrow('createRsvp failed: 403');
	});

	it('rejects when the underlying updateRsvpStatus rejects', async () => {
		updateRsvpStatusMock.mockRejectedValue(new Error('updateRsvpStatus failed: 403'));
		await expect(
			applyRsvpChange({
				cfg,
				personId: 'person-p',
				eventId: 'event-e',
				memberId: 'member-m',
				existing,
				newStatus: 'maybe'
			})
		).rejects.toThrow('updateRsvpStatus failed: 403');
	});

	it('rejects when the underlying deleteRsvp rejects', async () => {
		deleteRsvpMock.mockRejectedValue(new Error('deleteRsvp failed: 403'));
		await expect(
			applyRsvpChange({
				cfg,
				personId: 'person-p',
				eventId: 'event-e',
				memberId: 'member-m',
				existing,
				newStatus: null
			})
		).rejects.toThrow('deleteRsvp failed: 403');
	});
});

// (*MVOX:Tallis*)
