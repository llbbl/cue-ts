import { CueParseError } from "./errors.js";
import { type Token, TokenType } from "./tokens.js";

const KEYWORDS: Record<string, TokenType> = {
	null: TokenType.NULL,
	true: TokenType.TRUE,
	false: TokenType.FALSE,
	string: TokenType.STRING_TYPE,
	int: TokenType.INT_TYPE,
	float: TokenType.FLOAT_TYPE,
	bool: TokenType.BOOL_TYPE,
	number: TokenType.NUMBER_TYPE,
	bytes: TokenType.BYTES_TYPE,
};

const ESCAPE_MAP: Record<string, string> = {
	n: "\n",
	t: "\t",
	r: "\r",
	"\\": "\\",
	'"': '"',
	a: "\x07",
	b: "\x08",
	f: "\x0C",
	v: "\x0B",
	"/": "/",
};

export class Lexer {
	private input: string;
	private pos: number;
	private line: number;
	private column: number;

	constructor(input: string) {
		this.input = input;
		this.pos = 0;
		this.line = 1;
		this.column = 1;
	}

	tokenize(): Token[] {
		const tokens: Token[] = [];

		while (this.pos < this.input.length) {
			this.skipWhitespace();
			if (this.pos >= this.input.length) break;

			const token = this.nextToken();
			if (token) {
				tokens.push(token);
			}
		}

		tokens.push(this.makeToken(TokenType.EOF, "", this.line, this.column));
		return tokens;
	}

	private peek(offset = 0): string {
		return this.input[this.pos + offset] ?? "";
	}

	private advance(): string {
		const ch = this.input[this.pos];
		if (ch === undefined) {
			throw new CueParseError(`Unexpected end of input`, this.line, this.column);
		}
		this.pos++;
		if (ch === "\n") {
			this.line++;
			this.column = 1;
		} else {
			this.column++;
		}
		return ch;
	}

	private makeToken(type: TokenType, value: string, line: number, column: number): Token {
		return { type, value, line, column };
	}

	private skipWhitespace(): void {
		while (this.pos < this.input.length) {
			const ch = this.peek();
			if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
				this.advance();
			} else {
				break;
			}
		}
	}

	private nextToken(): Token | null {
		const line = this.line;
		const column = this.column;
		const ch = this.peek();

		// Comments: //
		if (ch === "/" && this.peek(1) === "/") {
			return this.readComment(line, column);
		}

		// Strings
		if (ch === '"') {
			return this.readString(line, column);
		}

		// Numbers (including negative)
		if (this.isDigit(ch) || (ch === "-" && this.isDigit(this.peek(1)))) {
			return this.readNumber(line, column);
		}

		// _|_ (bottom) — must check before underscore and identifiers
		if (ch === "_" && this.peek(1) === "|" && this.peek(2) === "_") {
			this.advance();
			this.advance();
			this.advance();
			return this.makeToken(TokenType.BOTTOM, "_|_", line, column);
		}

		// Standalone _ (top) — not followed by identifier chars
		if (ch === "_" && !this.isIdentPart(this.peek(1))) {
			this.advance();
			return this.makeToken(TokenType.UNDERSCORE, "_", line, column);
		}

		// Identifiers and keywords
		if (this.isIdentStart(ch)) {
			return this.readIdentOrKeyword(line, column);
		}

		// ... (ellipsis)
		if (ch === "." && this.peek(1) === "." && this.peek(2) === ".") {
			this.advance();
			this.advance();
			this.advance();
			return this.makeToken(TokenType.ELLIPSIS, "...", line, column);
		}

		// Two-character operators
		const two = ch + this.peek(1);
		switch (two) {
			case ">=":
				this.advance();
				this.advance();
				return this.makeToken(TokenType.GTE, ">=", line, column);
			case "<=":
				this.advance();
				this.advance();
				return this.makeToken(TokenType.LTE, "<=", line, column);
			case "==":
				this.advance();
				this.advance();
				return this.makeToken(TokenType.EQ, "==", line, column);
			case "!=":
				this.advance();
				this.advance();
				return this.makeToken(TokenType.NEQ, "!=", line, column);
			case "=~":
				this.advance();
				this.advance();
				return this.makeToken(TokenType.MATCH, "=~", line, column);
			case "!~":
				this.advance();
				this.advance();
				return this.makeToken(TokenType.NOT_MATCH, "!~", line, column);
		}

		// Single-character tokens
		this.advance();
		switch (ch) {
			case "{":
				return this.makeToken(TokenType.LBRACE, "{", line, column);
			case "}":
				return this.makeToken(TokenType.RBRACE, "}", line, column);
			case "[":
				return this.makeToken(TokenType.LBRACKET, "[", line, column);
			case "]":
				return this.makeToken(TokenType.RBRACKET, "]", line, column);
			case ":":
				return this.makeToken(TokenType.COLON, ":", line, column);
			case ",":
				return this.makeToken(TokenType.COMMA, ",", line, column);
			case "(":
				return this.makeToken(TokenType.LPAREN, "(", line, column);
			case ")":
				return this.makeToken(TokenType.RPAREN, ")", line, column);
			case "|":
				return this.makeToken(TokenType.PIPE, "|", line, column);
			case "&":
				return this.makeToken(TokenType.AMP, "&", line, column);
			case ">":
				return this.makeToken(TokenType.GT, ">", line, column);
			case "<":
				return this.makeToken(TokenType.LT, "<", line, column);
			case "?":
				return this.makeToken(TokenType.QUESTION, "?", line, column);
			case "#":
				return this.makeToken(TokenType.HASH, "#", line, column);
			default:
				throw new CueParseError(`Unexpected character '${ch}'`, line, column);
		}
	}

	private readComment(line: number, column: number): Token {
		let value = "";
		// consume the two slashes
		this.advance();
		this.advance();
		value = "//";
		while (this.pos < this.input.length && this.peek() !== "\n") {
			value += this.advance();
		}
		return this.makeToken(TokenType.COMMENT, value, line, column);
	}

	private readString(line: number, column: number): Token {
		// Check for triple-quoted string
		if (this.peek(1) === '"' && this.peek(2) === '"') {
			return this.readTripleQuotedString(line, column);
		}

		// Consume opening quote
		this.advance();
		let value = "";

		while (this.pos < this.input.length) {
			const ch = this.peek();

			if (ch === '"') {
				this.advance();
				return this.makeToken(TokenType.STRING, value, line, column);
			}

			if (ch === "\n") {
				throw new CueParseError(`Unterminated string`, line, column);
			}

			if (ch === "\\") {
				this.advance();
				const escaped = this.peek();
				const mapped = ESCAPE_MAP[escaped];
				if (mapped !== undefined) {
					value += mapped;
					this.advance();
				} else if (escaped === "u") {
					this.advance();
					value += this.readUnicodeEscape(4);
				} else if (escaped === "U") {
					this.advance();
					value += this.readUnicodeEscape(8);
				} else {
					throw new CueParseError(`Invalid escape sequence '\\${escaped}'`, this.line, this.column);
				}
			} else {
				value += this.advance();
			}
		}

		throw new CueParseError(`Unterminated string`, line, column);
	}

	private readTripleQuotedString(line: number, column: number): Token {
		// Consume opening """
		this.advance();
		this.advance();
		this.advance();

		let value = "";

		while (this.pos < this.input.length) {
			if (this.peek() === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
				this.advance();
				this.advance();
				this.advance();
				return this.makeToken(TokenType.STRING, value, line, column);
			}
			value += this.advance();
		}

		throw new CueParseError(`Unterminated multi-line string`, line, column);
	}

	private readNumber(line: number, column: number): Token {
		let value = "";

		if (this.peek() === "-") {
			value += this.advance();
		}

		while (this.pos < this.input.length && this.isDigit(this.peek())) {
			value += this.advance();
		}

		// Check for float
		if (this.peek() === "." && this.isDigit(this.peek(1))) {
			value += this.advance(); // consume '.'
			while (this.pos < this.input.length && this.isDigit(this.peek())) {
				value += this.advance();
			}
		}

		return this.makeToken(TokenType.NUMBER, value, line, column);
	}

	private readIdentOrKeyword(line: number, column: number): Token {
		let value = "";

		while (this.pos < this.input.length && this.isIdentPart(this.peek())) {
			value += this.advance();
		}

		const keyword = KEYWORDS[value];
		if (keyword !== undefined) {
			return this.makeToken(keyword, value, line, column);
		}

		return this.makeToken(TokenType.IDENT, value, line, column);
	}

	private isDigit(ch: string): boolean {
		return ch >= "0" && ch <= "9";
	}

	private isIdentStart(ch: string): boolean {
		return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
	}

	private isIdentPart(ch: string): boolean {
		return this.isIdentStart(ch) || this.isDigit(ch);
	}

	private isHexDigit(ch: string): boolean {
		return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
	}

	private readUnicodeEscape(digits: number): string {
		let hex = "";
		for (let i = 0; i < digits; i++) {
			const ch = this.peek();
			if (!this.isHexDigit(ch)) {
				throw new CueParseError(
					`Invalid unicode escape: expected ${digits} hex digits, got ${i}`,
					this.line,
					this.column,
				);
			}
			hex += this.advance();
		}
		const codePoint = parseInt(hex, 16);
		return digits === 4 ? String.fromCharCode(codePoint) : String.fromCodePoint(codePoint);
	}
}
