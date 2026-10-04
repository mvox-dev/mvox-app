// Message file reader with no $env imports, so node-safe specs can use it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MessageFile } from '$lib/testing/messageFile.js';

export function messages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

// (*MVOX:Josquin*)
