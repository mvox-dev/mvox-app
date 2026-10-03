// Mocked paraglide modules, { m }: vi.mock(path, async () => (await import(here)).echoMessages()).
type Message = (params?: Record<string, unknown>) => string;
export type Copy = Record<string, (params: never) => string>;
type MessagesModule = Record<string, unknown> & { m: Copy };

// [key {"n":1}] | key {"n":1} | key 1 | [key] | key; 'plain' drops empty params, 'raw' keeps them
export type EchoFormat = 'params' | 'plain' | 'raw' | 'spaced' | 'bracket' | 'bare';

function echo(key: string, format: EchoFormat): Message {
	if (format === 'bare') return () => key;
	if (format === 'bracket') return () => `[${key}]`;
	if (format === 'plain')
		return (params) =>
			params && Object.keys(params).length > 0 ? `${key} ${JSON.stringify(params)}` : key;
	if (format === 'spaced')
		return (params) => [key, ...Object.values(params ?? {}).map(String)].join(' ');
	if (format === 'raw')
		return (params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);
	return (params) => (params ? `[${key} ${JSON.stringify(params)}]` : `[${key}]`);
}

export function echoMessages(
	format: EchoFormat = 'params',
	copy: Copy = {},
	real: object = {} // importOriginal(): its named exports (nav_agenda, ...) echo too
): MessagesModule {
	const m = new Proxy(copy, {
		get: (target, key) =>
			Object.hasOwn(target, key) ? target[String(key)] : echo(String(key), format)
	});
	const named = Object.keys(real).filter((k) => k !== 'm');
	return { ...Object.fromEntries(named.map((k) => [k, m[k]])), m };
}

export function englishMessages(copy: Copy): MessagesModule {
	return { ...copy, m: copy }; // no echo: other keys are undefined, named or on m
}

// (*MVOX:Josquin*)
