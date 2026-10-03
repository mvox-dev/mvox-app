// Mocked paraglide modules, { m }: vi.mock(path, async () => (await import(here)).echoMessages()).
type Message = (params?: Record<string, unknown>) => string;
export type Copy = Record<string, (params: never) => string>;

// [key {"n":1}] | key {"n":1} | [key] | key; 'plain' drops empty params, 'raw' keeps them
export type EchoFormat = 'params' | 'plain' | 'raw' | 'bracket' | 'bare';

function echo(key: string, format: EchoFormat): Message {
	if (format === 'bare') return () => key;
	if (format === 'bracket') return () => `[${key}]`;
	if (format === 'plain')
		return (params) =>
			params && Object.keys(params).length > 0 ? `${key} ${JSON.stringify(params)}` : key;
	if (format === 'raw')
		return (params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);
	return (params) => (params ? `[${key} ${JSON.stringify(params)}]` : `[${key}]`);
}

export function echoMessages(format: EchoFormat = 'params', copy: Copy = {}): { m: Copy } {
	return {
		m: new Proxy(copy, {
			get: (target, key) => target[String(key)] ?? echo(String(key), format)
		})
	};
}

export function englishMessages(copy: Copy): { m: Copy } {
	return { m: copy }; // no echo: other keys are undefined
}

// (*MVOX:Josquin*)
