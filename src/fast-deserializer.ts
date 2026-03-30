/**
 * Fast single-pass CUE deserializer.
 * Reads directly from the input string -- no tokenization, no intermediate AST.
 * Optimized for data-only CUE (config values, not schemas).
 */

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

// Char codes for fast comparison
const CH_SPACE = 32; // ' '
const CH_TAB = 9; // '\t'
const CH_CR = 13; // '\r'
const CH_LF = 10; // '\n'
const CH_SLASH = 47; // '/'
const CH_DQUOTE = 34; // '"'
const CH_LBRACE = 123; // '{'
const CH_RBRACE = 125; // '}'
const CH_LBRACKET = 91; // '['
const CH_RBRACKET = 93; // ']'
const CH_COLON = 58; // ':'
const CH_COMMA = 44; // ','
const CH_HASH = 35; // '#'
const CH_QUESTION = 63; // '?'
const CH_DOT = 46; // '.'
const CH_MINUS = 45; // '-'
const CH_UNDERSCORE = 95; // '_'
const CH_PIPE = 124; // '|'
const CH_AMP = 38; // '&'
const CH_LPAREN = 40; // '('
const CH_RPAREN = 41; // ')'
const CH_BACKSLASH = 92; // '\\'
const CH_GT = 62; // '>'
const CH_LT = 60; // '<'
const CH_EQ = 61; // '='
const CH_BANG = 33; // '!'
const CH_TILDE = 126; // '~'

const CH_0 = 48;
const CH_9 = 57;
const CH_a = 97;
const CH_z = 122;
const CH_A = 65;
const CH_Z = 90;
const CH_f = 102;
const CH_F = 70;
const _CH_u = 117;
const _CH_U = 85;

const TYPE_KEYWORDS = new Set(["string", "int", "float", "bool", "number", "bytes"]);

export function fastDeserialize(input: string): Record<string, unknown> {
	let pos = 0;
	const len = input.length;

	// --- Inline helpers ---

	function ch(): number {
		return pos < len ? input.charCodeAt(pos) : -1;
	}

	function isWhitespace(c: number): boolean {
		return c === CH_SPACE || c === CH_TAB || c === CH_CR || c === CH_LF;
	}

	function isDigit(c: number): boolean {
		return c >= CH_0 && c <= CH_9;
	}

	function isIdentStart(c: number): boolean {
		return (c >= CH_a && c <= CH_z) || (c >= CH_A && c <= CH_Z) || c === CH_UNDERSCORE;
	}

	function isIdentPart(c: number): boolean {
		return isIdentStart(c) || isDigit(c);
	}

	function isHexDigit(c: number): boolean {
		return (c >= CH_0 && c <= CH_9) || (c >= CH_a && c <= CH_f) || (c >= CH_A && c <= CH_F);
	}

	// --- Scanning ---

	function skipWhitespaceAndComments(): void {
		while (pos < len) {
			const c = input.charCodeAt(pos);
			if (isWhitespace(c)) {
				pos++;
				continue;
			}
			// Line comment: //
			if (c === CH_SLASH && pos + 1 < len && input.charCodeAt(pos + 1) === CH_SLASH) {
				const nl = input.indexOf("\n", pos + 2);
				pos = nl === -1 ? len : nl + 1;
				continue;
			}
			break;
		}
	}

	function readString(): string {
		pos++; // skip opening "

		// Check for triple-quoted string: """
		if (
			pos + 1 < len &&
			input.charCodeAt(pos) === CH_DQUOTE &&
			input.charCodeAt(pos + 1) === CH_DQUOTE
		) {
			pos += 2; // skip the remaining ""
			return readTripleQuotedString();
		}

		// Fast path: scan for closing quote without escapes
		const start = pos;
		const closingIdx = input.indexOf('"', start);
		if (closingIdx === -1) {
			throw new Error(`Unterminated string at position ${start - 1}`);
		}

		// Check if there are any backslashes before the closing quote
		const backslashIdx = input.indexOf("\\", start);
		if (backslashIdx === -1 || backslashIdx >= closingIdx) {
			// No escapes -- fast slice
			const result = input.slice(start, closingIdx);
			pos = closingIdx + 1;
			return result;
		}

		// Slow path: has escapes
		return readStringWithEscapes(start);
	}

	function readTripleQuotedString(): string {
		const start = pos;
		while (pos < len) {
			if (
				input.charCodeAt(pos) === CH_DQUOTE &&
				pos + 2 < len &&
				input.charCodeAt(pos + 1) === CH_DQUOTE &&
				input.charCodeAt(pos + 2) === CH_DQUOTE
			) {
				const result = input.slice(start, pos);
				pos += 3;
				return result;
			}
			pos++;
		}
		throw new Error(`Unterminated triple-quoted string at position ${start}`);
	}

	function readStringWithEscapes(start: number): string {
		pos = start;
		let result = "";
		let segStart = pos;

		while (pos < len) {
			const c = input.charCodeAt(pos);

			if (c === CH_DQUOTE) {
				result += input.slice(segStart, pos);
				pos++;
				return result;
			}

			if (c === CH_LF) {
				throw new Error(`Unterminated string at position ${start - 1}`);
			}

			if (c === CH_BACKSLASH) {
				result += input.slice(segStart, pos);
				pos++;
				if (pos >= len) throw new Error(`Unterminated escape at position ${pos}`);

				const escChar = input[pos] as string;
				const mapped = ESCAPE_MAP[escChar];
				if (mapped !== undefined) {
					result += mapped;
					pos++;
				} else if (escChar === "u") {
					pos++;
					result += readUnicodeEscape(4);
				} else if (escChar === "U") {
					pos++;
					result += readUnicodeEscape(8);
				} else {
					throw new Error(`Invalid escape '\\${escChar}' at position ${pos - 1}`);
				}
				segStart = pos;
			} else {
				pos++;
			}
		}

		throw new Error(`Unterminated string at position ${start - 1}`);
	}

	function readUnicodeEscape(digits: number): string {
		const start = pos;
		for (let i = 0; i < digits; i++) {
			if (pos >= len || !isHexDigit(input.charCodeAt(pos))) {
				throw new Error(`Invalid unicode escape at position ${start}`);
			}
			pos++;
		}
		const codePoint = parseInt(input.slice(start, pos), 16);
		return digits === 4 ? String.fromCharCode(codePoint) : String.fromCodePoint(codePoint);
	}

	function readNumber(): number {
		const start = pos;

		if (input.charCodeAt(pos) === CH_MINUS) pos++;

		while (pos < len && isDigit(input.charCodeAt(pos))) pos++;

		// Float
		if (
			pos < len &&
			input.charCodeAt(pos) === CH_DOT &&
			pos + 1 < len &&
			isDigit(input.charCodeAt(pos + 1))
		) {
			pos++; // skip '.'
			while (pos < len && isDigit(input.charCodeAt(pos))) pos++;
		}

		// Exponent
		if (pos < len) {
			const ec = input.charCodeAt(pos);
			if (ec === 101 /* e */ || ec === 69 /* E */) {
				pos++;
				const sc = pos < len ? input.charCodeAt(pos) : -1;
				if (sc === CH_MINUS || sc === 43 /* + */) pos++;
				while (pos < len && isDigit(input.charCodeAt(pos))) pos++;
			}
		}

		return Number(input.slice(start, pos));
	}

	function readIdent(): string {
		const start = pos;
		while (pos < len && isIdentPart(input.charCodeAt(pos))) {
			pos++;
		}
		return input.slice(start, pos);
	}

	/**
	 * Skip an expression we don't care about (type constraints, definitions).
	 * Balances braces/brackets/parens so nested structures are fully consumed.
	 * Tracks whether we've crossed a newline to detect field boundaries.
	 */
	function skipExpression(): void {
		let depth = 0;
		let seenNewline = false;
		let consumedAny = false;

		while (pos < len) {
			// Skip whitespace but track newlines
			while (pos < len) {
				const wc = input.charCodeAt(pos);
				if (wc === CH_LF) {
					seenNewline = true;
					pos++;
				} else if (wc === CH_SPACE || wc === CH_TAB || wc === CH_CR) {
					pos++;
				} else if (wc === CH_SLASH && pos + 1 < len && input.charCodeAt(pos + 1) === CH_SLASH) {
					const nl = input.indexOf("\n", pos + 2);
					pos = nl === -1 ? len : nl + 1;
					seenNewline = true;
				} else {
					break;
				}
			}
			if (pos >= len) return;

			const c = ch();

			// Top-level terminators (only if not nested)
			if (depth === 0) {
				if (c === CH_COMMA || c === CH_RBRACE || c === CH_RBRACKET || c === -1) {
					return;
				}
				// After consuming something and crossing a newline, if we see
				// an identifier, #, or string (field start), stop — it's a new field
				if (consumedAny && seenNewline) {
					if (isIdentStart(c) || c === CH_HASH || c === CH_DQUOTE || c === CH_DOT) {
						return;
					}
				}
			}

			consumedAny = true;

			if (c === CH_LBRACE || c === CH_LBRACKET || c === CH_LPAREN) {
				depth++;
				pos++;
				seenNewline = false;
			} else if (c === CH_RBRACE || c === CH_RBRACKET || c === CH_RPAREN) {
				if (depth === 0) return;
				depth--;
				pos++;
			} else if (c === CH_DQUOTE) {
				readString(); // consume full string
			} else {
				pos++;
			}
		}
	}

	/**
	 * Skip the right-hand side of a constraint operator (>=, <=, >, <, =~, !~)
	 * and any further & chains.
	 */
	function skipConstraintTail(): void {
		// We already consumed the value. Now check for & (unification) or | (disjunction)
		// at the expression level and skip those too.
		skipWhitespaceAndComments();
		while (pos < len) {
			const c = ch();
			if (c === CH_AMP) {
				pos++;
				skipWhitespaceAndComments();
				skipExpression();
				skipWhitespaceAndComments();
			} else {
				break;
			}
		}
	}

	function isConstraintOp(): boolean {
		const c = ch();
		if (c === CH_GT || c === CH_LT) return true;
		if (pos + 1 < len) {
			const c2 = input.charCodeAt(pos + 1);
			if (c === CH_EQ && c2 === CH_TILDE) return true; // =~
			if (c === CH_BANG && c2 === CH_TILDE) return true; // !~
		}
		return false;
	}

	// --- Core value reading ---

	function readValue(): unknown {
		skipWhitespaceAndComments();
		if (pos >= len) throw new Error("Unexpected end of input");

		const c = ch();

		// String
		if (c === CH_DQUOTE) return readString();

		// Object / struct
		if (c === CH_LBRACE) {
			pos++;
			return readObject(CH_RBRACE);
		}

		// List / array
		if (c === CH_LBRACKET) return readList();

		// Number (digits or negative)
		if (isDigit(c) || (c === CH_MINUS && pos + 1 < len && isDigit(input.charCodeAt(pos + 1)))) {
			return readNumber();
		}

		// Parenthesized expression
		if (c === CH_LPAREN) {
			pos++;
			const val = readValue();
			skipWhitespaceAndComments();
			if (ch() === CH_RPAREN) pos++;
			return val;
		}

		// _|_ (bottom) or _ (top)
		if (c === CH_UNDERSCORE) {
			if (
				pos + 2 < len &&
				input.charCodeAt(pos + 1) === CH_PIPE &&
				input.charCodeAt(pos + 2) === CH_UNDERSCORE
			) {
				pos += 3;
				return undefined;
			}
			if (pos + 1 >= len || !isIdentPart(input.charCodeAt(pos + 1))) {
				pos++;
				return undefined; // top type
			}
			// Otherwise it's an identifier starting with _
		}

		// Identifier or keyword
		if (isIdentStart(c)) {
			const ident = readIdent();

			if (ident === "true") return true;
			if (ident === "false") return false;
			if (ident === "null") return null;

			// Type keywords -- skip, return undefined
			if (TYPE_KEYWORDS.has(ident)) {
				// May be followed by constraints like & >= 0
				skipConstraintTail();
				return undefined;
			}

			// Bare identifier -- return as string (best effort, like original)
			return ident;
		}

		// #Reference (type reference like #Address, #User) -- skip, return undefined
		if (c === CH_HASH) {
			pos++;
			if (pos < len && isIdentStart(ch())) {
				readIdent(); // consume the reference name
			}
			// May be followed by & with concrete value
			skipWhitespaceAndComments();
			if (pos < len && ch() === CH_AMP) {
				// Don't consume the & here — let readValueExpr handle it
			}
			return undefined;
		}

		// Constraint operators at value position -- skip entire constraint expr
		if (isConstraintOp()) {
			skipExpression();
			return undefined;
		}

		throw new Error(`Unexpected character '${input[pos]}' at position ${pos}`);
	}

	/**
	 * Read a value and then handle any trailing operators (|, &)
	 * that form disjunctions or unifications at the value level.
	 */
	function readValueExpr(): unknown {
		let value = readValue();
		const valueIsUndefined = value === undefined;

		skipWhitespaceAndComments();

		// Handle & (unification) -- pick the concrete side
		while (pos < len && ch() === CH_AMP) {
			pos++;
			skipWhitespaceAndComments();
			const right = readValue();
			skipWhitespaceAndComments();
			// If left is undefined (type), prefer right. Otherwise keep left.
			if (valueIsUndefined && right !== undefined) {
				value = right;
			}
		}

		// Handle | (disjunction) -- pick first concrete value
		if (pos < len && ch() === CH_PIPE) {
			// Make sure it's not _|_ which we already handle
			let concrete = valueIsUndefined ? undefined : value;
			while (pos < len && ch() === CH_PIPE) {
				pos++;
				skipWhitespaceAndComments();
				const alt = readValue();
				skipWhitespaceAndComments();

				// Handle & after each disjunction alternative
				while (pos < len && ch() === CH_AMP) {
					pos++;
					skipWhitespaceAndComments();
					readValue();
					skipWhitespaceAndComments();
				}

				if (concrete === undefined && alt !== undefined) {
					concrete = alt;
				}
			}
			if (concrete !== undefined) {
				value = concrete;
			}
		}

		return value;
	}

	function readObject(closingCharCode: number): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		while (true) {
			skipWhitespaceAndComments();
			if (pos >= len) {
				if (closingCharCode === -1) break; // EOF-terminated top level
				throw new Error("Unexpected end of input in object");
			}

			const c = ch();
			if (c === closingCharCode) {
				pos++;
				return result;
			}

			// Definition: #Ident: value -- skip entirely
			if (c === CH_HASH) {
				pos++;
				readIdent(); // skip definition name
				skipWhitespaceAndComments();
				if (ch() === CH_COLON) pos++;
				skipWhitespaceAndComments();
				skipExpression();
				skipSeparator();
				continue;
			}

			// Ellipsis: ... -- skip
			if (
				c === CH_DOT &&
				pos + 2 < len &&
				input.charCodeAt(pos + 1) === CH_DOT &&
				input.charCodeAt(pos + 2) === CH_DOT
			) {
				pos += 3;
				skipWhitespaceAndComments();
				// May be followed by a type expression
				const nc = ch();
				if (nc !== CH_COMMA && nc !== closingCharCode && nc !== -1) {
					skipExpression();
				}
				skipSeparator();
				continue;
			}

			// Field: label: value  or  "label": value
			let label: string;
			if (c === CH_DQUOTE) {
				label = readString();
			} else if (isIdentStart(c)) {
				label = readIdent();
			} else {
				throw new Error(`Expected field name at position ${pos}, got '${input[pos]}'`);
			}

			skipWhitespaceAndComments();

			// Optional marker: ?
			if (ch() === CH_QUESTION) pos++;

			skipWhitespaceAndComments();

			// Colon
			if (ch() !== CH_COLON) {
				throw new Error(`Expected ':' at position ${pos}`);
			}
			pos++;

			skipWhitespaceAndComments();
			const value = readValueExpr();

			if (value !== undefined) {
				result[label] = value;
			}

			skipSeparator();
		}

		return result;
	}

	function readList(): unknown[] {
		pos++; // skip [
		const elements: unknown[] = [];

		skipWhitespaceAndComments();

		if (pos < len && ch() === CH_RBRACKET) {
			pos++;
			return elements;
		}

		// Check for [...type] pattern
		if (
			ch() === CH_DOT &&
			pos + 2 < len &&
			input.charCodeAt(pos + 1) === CH_DOT &&
			input.charCodeAt(pos + 2) === CH_DOT
		) {
			pos += 3;
			skipExpression();
			skipWhitespaceAndComments();
			if (ch() === CH_RBRACKET) pos++;
			return elements;
		}

		const val = readValueExpr();
		if (val !== undefined) {
			elements.push(val);
		}

		while (true) {
			skipWhitespaceAndComments();
			if (pos >= len || ch() === CH_RBRACKET) break;

			if (ch() === CH_COMMA) {
				pos++;
				skipWhitespaceAndComments();
				if (pos >= len || ch() === CH_RBRACKET) break;

				// Ellipsis at end of list
				if (
					ch() === CH_DOT &&
					pos + 2 < len &&
					input.charCodeAt(pos + 1) === CH_DOT &&
					input.charCodeAt(pos + 2) === CH_DOT
				) {
					pos += 3;
					skipExpression();
					skipWhitespaceAndComments();
					break;
				}

				const v = readValueExpr();
				if (v !== undefined) {
					elements.push(v);
				}
			} else {
				break;
			}
		}

		skipWhitespaceAndComments();
		if (ch() === CH_RBRACKET) pos++;

		return elements;
	}

	function skipSeparator(): void {
		skipWhitespaceAndComments();
		if (pos < len && ch() === CH_COMMA) {
			pos++;
		}
	}

	// --- Entry point: top-level is an implicit struct ---
	skipWhitespaceAndComments();
	return readObject(-1); // -1 means EOF-terminated
}
