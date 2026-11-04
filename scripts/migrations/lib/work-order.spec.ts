// What a work order file must hold before the runner will act on it.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { assertGoFresh, authorizedByFromGo, parseWorkOrder, withResult } from './work-order';

const NAME = '2026-11-01-phantom-file.yaml';
const ENTITY = '6ae5fb5ad665720a18b9e400';
const PROPERTY = '6ae5fb5ad665720a18b9e420';

function orderText(over: Record<string, string> = {}): string {
	const parts = {
		db: 'db: mvox_crede',
		why: 'why: drop a file property whose upload never landed',
		ref: "ref: 'mihkel:2026-11-01'",
		go: [
			'go:',
			'  by: Mihkel',
			"  at: '2026-11-01T23:53:00+02:00'",
			'  quote: yes, delete it'
		].join('\n'),
		ops: [
			'ops:',
			'  - op: delete-property',
			`    entity: '${ENTITY}'`,
			`    property: '${PROPERTY}'`,
			'    expect:',
			'      type: photo',
			'      filesize: 0'
		].join('\n'),
		...over
	};
	return Object.values(parts).filter(Boolean).join('\n') + '\n';
}

describe('parseWorkOrder accepts a whole order', () => {
	it('returns the db, go and ops as written', () => {
		const order = parseWorkOrder(orderText(), NAME);
		expect(order.db).toBe('mvox_crede');
		expect(order.go).toEqual({ by: 'Mihkel', at: '2026-11-01T23:53:00+02:00', quote: 'yes, delete it' });
		expect(order.ops).toEqual([
			{
				op: 'delete-property',
				entity: ENTITY,
				property: PROPERTY,
				expect: { type: 'photo', filesize: 0 }
			}
		]);
	});
});

describe('parseWorkOrder expect', () => {
	it('takes filetype beside filesize, and filesize null for a file that never got a size', () => {
		const order = parseWorkOrder(orderText().replace('filesize: 0', 'filesize: null\n      filetype: application/pdf'), NAME);
		expect(order.ops[0].expect).toEqual({ type: 'photo', filesize: null, filetype: 'application/pdf' });
	});
});

describe('parseWorkOrder refuses', () => {
	const cases: Array<[string, () => void, string]> = [
		['an order with no go', () => parseWorkOrder(orderText({ go: '' }), NAME), 'go'],
		[
			'a go not from Mihkel',
			() => parseWorkOrder(orderText({ go: "go:\n  by: Perotin\n  at: '2026-11-01T23:53:00Z'\n  quote: ok" }), NAME),
			'go.by'
		],
		[
			'a go with no time of day',
			() => parseWorkOrder(orderText({ go: "go:\n  by: Mihkel\n  at: '2026-11-01'\n  quote: ok" }), NAME),
			'go.at'
		],
		[
			'a go with a blank quote',
			() => parseWorkOrder(orderText({ go: "go:\n  by: Mihkel\n  at: '2026-11-01T23:53:00Z'\n  quote: ' '" }), NAME),
			'go.quote'
		],
		['polyphony', () => parseWorkOrder(orderText({ db: 'db: polyphony' }), NAME), 'frozen'],
		['a db name that is not one', () => parseWorkOrder(orderText({ db: 'db: ../crede' }), NAME), 'db'],
		[
			'a spent order',
			() => parseWorkOrder(orderText() + "result:\n  ran_at: '2026-11-02T00:10:00Z'\n", NAME),
			'spent'
		],
		[
			'an unknown op',
			() => parseWorkOrder(orderText({ ops: `ops:\n  - op: delete-entity\n    entity: '${ENTITY}'` }), NAME),
			"unknown op 'delete-entity'"
		],
		['an empty op list', () => parseWorkOrder(orderText({ ops: 'ops: []' }), NAME), 'ops'],
		[
			'a property id that is not an Entu id',
			() => parseWorkOrder(orderText().replace(PROPERTY, '6ae5fb5a'), NAME),
			'ops[0].property'
		],
		[
			'an entity id that is not an Entu id',
			() => parseWorkOrder(orderText().replace(ENTITY, 'ZZe5fb5ad665720a18b9e400'), NAME),
			'ops[0].entity'
		],
		[
			'an expect with no type',
			() => parseWorkOrder(orderText().replace('      type: photo\n', ''), NAME),
			'ops[0].expect.type'
		],
		[
			'an expect naming a field that may hold personal data',
			() => parseWorkOrder(orderText().replace('filesize: 0', 'filesize: 0\n      string: Jaan Tamm'), NAME),
			"ops[0].expect.string"
		],
		[
			'a filename in expect: it can carry a personal name',
			() => parseWorkOrder(orderText().replace('filesize: 0', 'filesize: 0\n      filename: Jaan Tamm.pdf'), NAME),
			'ops[0].expect.filename'
		],
		[
			'an expect with no filesize',
			() => parseWorkOrder(orderText().replace('      filesize: 0\n', ''), NAME),
			'ops[0].expect.filesize'
		],
		[
			'a filesize that is not a number',
			() => parseWorkOrder(orderText().replace('filesize: 0', "filesize: '0'"), NAME),
			'ops[0].expect.filesize'
		],
		...['_owner', 'photo?x=1', 'photo&props=email', 'Photo', '9photo', 'pho to'].map(
			(type): [string, () => void, string] => [
				`a type that is not a plain property name: ${type}`,
				() => parseWorkOrder(orderText().replace('type: photo', `type: '${type}'`), NAME),
				'ops[0].expect.type'
			]
		),
		[
			'an op with a key it does not use',
			() => parseWorkOrder(orderText().replace('    expect:', '    also: x\n    expect:'), NAME),
			'ops[0].also'
		],
		['an unknown top-level key', () => parseWorkOrder(orderText({ extra: 'note: x' }), NAME), "'note'"],
		[
			'an email anywhere in the order',
			() => parseWorkOrder(orderText({ why: 'why: asked by a@b.ee' }), NAME),
			'@'
		],
		['a file name off the pattern', () => parseWorkOrder(orderText(), 'phantom.yaml'), 'YYYY-MM-DD'],
		['text that is not YAML', () => parseWorkOrder('db: [', NAME), 'YAML']
	];
	it.each(cases)('%s', (_label, run, message) => {
		expect(run).toThrow(message);
	});
});

describe('parseWorkOrder add-entity-type', () => {
	const addOp = (lines: string[]) => orderText({ ops: ['ops:', '  - op: add-entity-type', ...lines].join('\n') });

	it('takes a type name and nothing else', () => {
		expect(parseWorkOrder(addOp(['    type: ink_layer']), NAME).ops).toEqual([
			{ op: 'add-entity-type', type: 'ink_layer' }
		]);
	});

	it.each([
		['no type', [], 'ops[0].type'],
		['a type that is not a plain name', ["    type: 'ink_layer&props=email'"], 'ops[0].type'],
		['a definition inline: the schema of record holds it', ['    type: ink_layer', '    sharing: public'], 'ops[0].sharing'],
		['a person in the text', ['    type: ink_layer', '    label: Jaan Tamm'], 'ops[0].label']
	])('refuses %s', (_label, lines, message) => {
		expect(() => parseWorkOrder(addOp(lines), NAME)).toThrow(message);
	});
});

describe('authorizedByFromGo', () => {
	it('names who, when and which order, from the go alone', () => {
		const order = parseWorkOrder(orderText(), NAME);
		expect(authorizedByFromGo(order.go, NAME)).toBe(
			`Mihkel, 2026-11-01T23:53:00+02:00, work order ${NAME}`
		);
	});
});

describe('withResult', () => {
	it('adds the result and keeps the rest of the file as written', () => {
		const text = '# note kept\n' + orderText();
		const out = withResult(text, {
			ran_at: '2026-11-02T00:10:00.000Z',
			outcome: 'done',
			ledger: 'scripts/migrations/seed-results/crede-instance/x.json',
			ops: [{ op: 'delete-property', property: PROPERTY, outcome: 'deleted' }]
		});
		expect(out.startsWith(text.trimEnd())).toBe(true);
		expect(parse(out).result.ops).toEqual([{ op: 'delete-property', property: PROPERTY, outcome: 'deleted' }]);
		expect(() => parseWorkOrder(out, NAME)).toThrow('spent');
	});
});

describe('assertGoFresh: a live run needs a go from the last 7 days', () => {
	const go = { by: 'Mihkel', at: '2026-11-01T23:53:00+02:00', quote: 'yes' };
	const at = Date.parse(go.at);
	const DAY = 24 * 60 * 60 * 1000;
	it('an hour old passes', () => {
		expect(() => assertGoFresh(go, new Date(at + 3600_000))).not.toThrow();
	});
	it('a go in the future is refused', () => {
		expect(() => assertGoFresh(go, new Date(at - 60_000))).toThrow('in the future');
	});
	it('a go older than 7 days is refused', () => {
		expect(() => assertGoFresh(go, new Date(at + 7 * DAY + 60_000))).toThrow('older than 7 days');
	});
});
