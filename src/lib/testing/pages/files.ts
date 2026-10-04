// File readers for the i18n and a11y specs that check source and message files.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCALES } from './profile';

export type Locale = (typeof LOCALES)[number];

export type MessageFile = Record<string, unknown>;

export function readMessages(locale: Locale): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

export function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

// (*MVOX:Josquin*)
