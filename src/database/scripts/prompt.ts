import { createInterface } from 'node:readline/promises';

/** Lines read from a piped (non-TTY) stdin, filled on the first prompt. */
let pipedLines: string[] | null = null;

/** Position of the next line to hand out from `pipedLines`. */
let pipedLineIndex = 0;

/**
 * Returns the next line piped to stdin, buffering the whole input on first use.
 *
 * The buffering matters: piped writes typically arrive as one chunk, so a
 * fresh readline interface per prompt would swallow every line at the first
 * prompt and later prompts would hang waiting for data that never comes.
 *
 * @param question - Prompt text, echoed so piped runs stay readable.
 * @param echoValue - Whether to echo the consumed value (never for passwords).
 * @returns The raw line, or an empty string when the piped input ran out.
 */
async function nextPipedLine(
  question: string,
  echoValue: boolean,
): Promise<string> {
  if (pipedLines === null) {
    let content = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      content += chunk;
    }
    pipedLines = content.split(/\r?\n/);
  }

  const line = pipedLines[pipedLineIndex];
  pipedLineIndex += 1;

  if (line === undefined) {
    process.stderr.write(
      `Error: no piped input left for "${question.trim()}".\n`,
    );
    return '';
  }

  process.stdout.write(`${question}${echoValue ? line : ''}\n`);
  return line;
}

/**
 * Prompts for a line of visible input.
 *
 * With a TTY the user types the answer; with piped input the answers are
 * consumed from stdin in prompt order.
 *
 * @param question - Text shown before the cursor.
 * @returns The trimmed answer.
 */
export async function promptVisible(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return (await nextPipedLine(question, true)).trim();
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Prompts for a password without echoing it.
 *
 * Falls back to piped input when stdin is not a TTY (CI, scripted runs), never
 * echoing the value.
 *
 * @param question - Text shown before the cursor.
 * @returns The entered value (not trimmed — passwords may contain spaces).
 */
export async function promptHidden(question: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;

  if (!input.isTTY) {
    return nextPipedLine(question, false);
  }

  return new Promise<string>((resolve, reject) => {
    output.write(question);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();

    let value = '';

    const finish = (result: string | Error): void => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish(value);
          return;
        }

        if (char === '\u0003' || char === '\u0004') {
          finish(new Error('Cancelled.'));
          return;
        }

        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }

        if (char >= ' ') {
          value += char;
          output.write('*');
        }
      }
    };

    input.on('data', onData);
  });
}
