// Commitments: memory/commitments.yaml. Optional: a home opts in by creating the file (kit #30).
// A standing promise ("answer the board's email within 3 days") or watch ("if a second
// collective is provisioned, re-check the park"). It never expires and never resolves: each time
// its trigger happens it creates an obligation, which goes to obligations.yaml and is deleted
// when resolved. Only a ruling retires a commitment.

import type { Ref } from './memory-common';

export interface CommitmentsFile {
  commitments: Commitment[];
}

export interface Commitment {
  /** What happens: the event that creates an obligation. <= OBLIGATION_CHAR_CAP. */
  trigger: string;
  /** What is then owed: the created obligation's text. <= OBLIGATION_CHAR_CAP. */
  obligation: string;
  /** Who acts on each obligation it creates. */
  actor: string;
  /** Who is owed, as Obligation.owed_to: never "us" or "we", never the actor. Required here. */
  owed_to: string;
  /** From the trigger to the created obligation's deadline, in words: "3 days". */
  within: string;
  /** The promise or ruling that made it. */
  ref: Ref;
}

// No expires: a watch with an invented expiry is the finding that asked for this tier (#27).
// A to-do is neither: it goes in the home's own work queue.
