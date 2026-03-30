export class CueParseError extends Error {
	line: number;
	column: number;

	constructor(message: string, line: number, column: number) {
		super(`${message} at line ${line}, column ${column}`);
		this.name = "CueParseError";
		this.line = line;
		this.column = column;
	}
}
