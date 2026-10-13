// Lessons: memory/lessons/<slug>.md, indexed by memory/lessons/index.yaml.
// Read at the moment of use, not on spawn -- which is why bodies are free and rules are not.

import type { IsoDate, Ref } from './memory-common';

export interface LessonIndexFile {
  /** GENERATED from the lesson files, never hand-carried. */
  lessons: LessonIndexLine[];
}

export interface LessonIndexLine {
  slug: string;
  /** <= LESSON_INDEX_LINE_CAP. What it is for, not what it says. */
  summary: string;
  learned: IsoDate;
  ref: Ref;
  /** Stated, never assumed. 'recognition' = nothing fires it; the reader must remember. */
  enforcement: 'hooked' | 'linted' | 'recognition';
  /** Present when 'hooked': what an adapter matches on. Tool-shaped only. */
  trigger?: string;
}

/** The YAML front matter that opens every lesson file: the index line minus `slug` (the slug
 *  is the file name). The index is generated from it by tools/lesson-index.py; the lint fails
 *  a lesson with no front matter, or an index row that differs from it. */
export type LessonFrontMatter = Omit<LessonIndexLine, 'slug'>;

// Body (after the front matter): When -- Why -- What to do -- What not to do.
