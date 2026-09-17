// Terminal output for the CLI and the app server: stdout for results, stderr for notes.

export function print(line: string): void {
  process.stdout.write(line + "\n");
}

export function note(line: string): void {
  process.stderr.write(line + "\n");
}
