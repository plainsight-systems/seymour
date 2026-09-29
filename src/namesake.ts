// An easter egg for anyone who opens the developer console: who the site is
// named for. The README only hints at it.

export const NAMESAKE_TITLE = 'Hello, curious one. Seymour is named for Seymour Cray.';

export const NAMESAKE_BODY = [
  'Cray designed the CDC 6600 (1964), widely called the first supercomputer, and then the Cray-1 (1976), the machine that made vector processing famous.',
  'The Cray-1 had vector registers holding 64 numbers each, so a single instruction could add or multiply a whole row of numbers instead of one at a time.',
  'That idea, one instruction for many numbers, is the ancestor of the SIMD units in every modern CPU and of the GPU this site takes apart.',
  'He also knew that fast math is worthless if memory cannot keep it fed. That is the whole story of Acts 1 through 4.',
].join('\n');

/** Writes the note once. The console is passed in so the output can be tested. */
export function greetTheConsole(target: Pick<Console, 'info'>): void {
  target.info(`%c${NAMESAKE_TITLE}%c\n\n${NAMESAKE_BODY}`, 'font-weight: bold; font-size: 1.1em', '');
}
