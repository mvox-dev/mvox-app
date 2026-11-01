// #1066 RED — safeLinkUrl(url): the one check for what a link may point at.
// Allowed: an own-surface path (one leading '/') or an absolute http, https, mailto or tel url.
import { describe, expect, it } from 'vitest';
import { linkHref, linkScheme, safeLinkUrl } from './safeLinkUrl';

describe('#1066 — allowed', () => {
	it.each([
		'https://crede.ee/x',
		'http://crede.ee',
		'HTTPS://CREDE.EE/x',
		'/salvestused',
		'/',
		'/path?q=1#frag',
		'mailto:info@crede.ee',
		'tel:+3725551234',
		'MAILTO:info@crede.ee'
	])('%s', (url) => {
		expect(safeLinkUrl(url)).toBe(true);
	});
});

describe('#1066 — refused', () => {
	it.each([
		'javascript:alert(1)',
		' JavaScript:alert(1)',
		'java\tscript:alert(1)',
		'JAVASCRIPT:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:msgbox(1)',
		'file:///etc/passwd',
		'ftp://files.crede.ee/y',
		'//evil.example/x',
		'/\\evil.example/x',
		'/\t/evil.example/x',
		'\\\\evil.example/x',
		'example.com/x',
		'',
		'http://',
		'   '
	])('%j', (url) => {
		expect(safeLinkUrl(url)).toBe(false);
	});
});

describe('#1066 — linkScheme names the scheme for a report, never the url', () => {
	it.each([
		['javascript:alert(1)', 'javascript'],
		[' JavaScript:alert(1)', 'javascript'],
		['data:text/html,x', 'data'],
		['ftp://a.ee/x', 'ftp'],
		['example.com/x', 'none'],
		['//evil.example/x', 'none']
	])('%j -> %s', (url, scheme) => {
		expect(linkScheme(url)).toBe(scheme);
	});
});

describe('#1066 — linkHref: what a stored url renders as, or null for plain text', () => {
	it.each([
		['https://crede.ee/x', 'https://crede.ee/x'],
		['/salvestused', '/salvestused'],
		['mailto:a@b.ee', 'mailto:a@b.ee'],
		['example.com/x', 'https://example.com/x'],
		['//crede.ee/x', 'https://crede.ee/x'],
		['javascript:alert(1)', null],
		[' JavaScript:alert(1)', null],
		['data:text/html,hi', null],
		['/\\evil.example', null],
		['ex ample.com/x', null],
		['', null]
	])('%j -> %j', (url, href) => {
		expect(linkHref(url)).toBe(href);
	});
});

// (*MVOX:Josquin*)
