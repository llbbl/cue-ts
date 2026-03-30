import type {
	CueBinaryExpr,
	CueComment,
	CueDefinition,
	CueDisjunction,
	CueEllipsis,
	CueField,
	CueFile,
	CueIdent,
	CueList,
	CueLiteral,
	CueNode,
	CueStruct,
	CueType,
	CueUnaryExpr,
	CueUnaryOperator,
} from "./ast.js";
import { CueParseError } from "./errors.js";
import { type Token, TokenType } from "./tokens.js";

export class Parser {
	private tokens: Token[];
	private pos: number;

	constructor(tokens: Token[]) {
		this.tokens = tokens;
		this.pos = 0;
	}

	parse(): CueFile {
		const declarations = this.parseDeclarations(TokenType.EOF);
		return { kind: "file", declarations };
	}

	private peek(): Token {
		const token = this.tokens[this.pos];
		if (token === undefined) {
			throw new CueParseError("Unexpected end of token stream", 0, 0);
		}
		return token;
	}

	private advance(): Token {
		const token = this.tokens[this.pos];
		if (token === undefined) {
			throw new CueParseError("Unexpected end of token stream", 0, 0);
		}
		this.pos++;
		return token;
	}

	private expect(type: TokenType): Token {
		const token = this.peek();
		if (token.type !== type) {
			throw new CueParseError(
				`Expected ${TokenType[type]} but got ${TokenType[token.type]}`,
				token.line,
				token.column,
			);
		}
		return this.advance();
	}

	private skipComments(): void {
		while (this.peek().type === TokenType.COMMENT) {
			this.advance();
		}
	}

	private skipSeparators(): void {
		while (this.peek().type === TokenType.COMMA) {
			this.advance();
		}
	}

	/**
	 * Parse a list of declarations (fields, definitions, comments) until the given closing token type.
	 * Used for both top-level (until EOF) and struct bodies (until RBRACE).
	 */
	private parseDeclarations(closingToken: TokenType): CueNode[] {
		const declarations: CueNode[] = [];

		while (this.peek().type !== closingToken) {
			// Collect comments as CueComment nodes
			while (this.peek().type === TokenType.COMMENT) {
				const commentToken = this.advance();
				// Strip the leading "// " or "//" prefix
				const raw = commentToken.value;
				const text = raw.startsWith("// ")
					? raw.slice(3)
					: raw.startsWith("//")
						? raw.slice(2)
						: raw;
				declarations.push({ kind: "comment", text } as CueComment);
			}

			if (this.peek().type === closingToken) {
				break;
			}

			// Check for definition: HASH IDENT COLON value
			if (this.peek().type === TokenType.HASH) {
				declarations.push(this.parseDefinition());
			} else if (this.peek().type === TokenType.IDENT || this.peek().type === TokenType.STRING) {
				declarations.push(this.parseField());
			} else {
				const token = this.peek();
				throw new CueParseError(
					`Expected field or definition but got ${TokenType[token.type]}`,
					token.line,
					token.column,
				);
			}
			this.skipSeparators();
		}

		return declarations;
	}

	/**
	 * Parse a definition: HASH IDENT COLON value
	 */
	private parseDefinition(): CueDefinition {
		this.expect(TokenType.HASH);
		const nameToken = this.expect(TokenType.IDENT);
		this.expect(TokenType.COLON);
		const value = this.parseValue();

		return {
			kind: "definition",
			name: nameToken.value,
			value,
		};
	}

	/**
	 * Parse a field: (IDENT | STRING) [QUESTION] COLON value
	 */
	private parseField(): CueField {
		const labelToken =
			this.peek().type === TokenType.STRING ? this.advance() : this.expect(TokenType.IDENT);

		// Check for optional marker: ?
		let optional = false;
		if (this.peek().type === TokenType.QUESTION) {
			this.advance();
			optional = true;
		}

		this.expect(TokenType.COLON);
		const value = this.parseValue();

		return {
			kind: "field",
			label: labelToken.value,
			optional,
			value,
		};
	}

	/**
	 * Parse a value expression. This is the right-hand side of a field.
	 * Handles disjunctions (|) at the lowest precedence level,
	 * then unification (&) at a higher precedence level.
	 */
	private parseValue(): CueNode {
		// First parse a & expression (higher precedence)
		const first = this.parseUnification();

		// Then check for | (disjunction) operator — lower precedence than &
		if (this.peek().type === TokenType.PIPE) {
			const elements: CueNode[] = [first];
			while (this.peek().type === TokenType.PIPE) {
				this.advance(); // consume |
				elements.push(this.parseUnification());
			}
			return { kind: "disjunction", elements } as CueDisjunction;
		}

		return first;
	}

	/**
	 * Parse a unification expression (& operator).
	 */
	private parseUnification(): CueNode {
		let left = this.parseConstraintOrPrimary();

		while (this.peek().type === TokenType.AMP) {
			this.advance(); // consume &
			const right = this.parseConstraintOrPrimary();
			left = {
				kind: "binary_expr",
				operator: "&",
				left,
				right,
			} as CueBinaryExpr;
		}

		return left;
	}

	/**
	 * Parse a constraint expression (unary operator + value) or a primary value.
	 * Constraint operators: >=, <=, >, <, =~, !~
	 */
	private parseConstraintOrPrimary(): CueNode {
		const token = this.peek();

		switch (token.type) {
			case TokenType.GTE:
			case TokenType.LTE:
			case TokenType.GT:
			case TokenType.LT:
			case TokenType.MATCH:
			case TokenType.NOT_MATCH: {
				const op = this.advance();
				const operand = this.parsePrimary();
				return {
					kind: "unary_expr",
					operator: op.value as CueUnaryOperator,
					operand,
				} as CueUnaryExpr;
			}
			default:
				return this.parsePrimary();
		}
	}

	/**
	 * Parse a primary (non-binary) value expression.
	 */
	private parsePrimary(): CueNode {
		const token = this.peek();

		switch (token.type) {
			case TokenType.STRING:
				return this.parseStringLiteral();
			case TokenType.NUMBER:
				return this.parseNumberLiteral();
			case TokenType.TRUE:
			case TokenType.FALSE:
				return this.parseBoolLiteral();
			case TokenType.NULL:
				return this.parseNullLiteral();
			case TokenType.LBRACE:
				return this.parseStruct();
			case TokenType.LBRACKET:
				return this.parseList();
			case TokenType.IDENT:
				return this.parseIdentifier();
			case TokenType.STRING_TYPE:
				return this.parseTypeKeyword("string");
			case TokenType.INT_TYPE:
				return this.parseTypeKeyword("int");
			case TokenType.FLOAT_TYPE:
				return this.parseTypeKeyword("float");
			case TokenType.BOOL_TYPE:
				return this.parseTypeKeyword("bool");
			case TokenType.NUMBER_TYPE:
				return this.parseTypeKeyword("number");
			case TokenType.BYTES_TYPE:
				return this.parseTypeKeyword("bytes");
			case TokenType.UNDERSCORE:
				this.advance();
				return { kind: "type", name: "top" } as CueType;
			case TokenType.BOTTOM:
				this.advance();
				return { kind: "type", name: "bottom" } as CueType;
			case TokenType.HASH: {
				// #Reference (type reference like #Address, #User)
				this.advance(); // consume #
				const refName = this.peek().type === TokenType.IDENT ? this.advance().value : "";
				return { kind: "ident", name: `#${refName}` } as CueIdent;
			}
			default:
				throw new CueParseError(
					`Unexpected token ${TokenType[token.type]}`,
					token.line,
					token.column,
				);
		}
	}

	private parseStringLiteral(): CueLiteral {
		const token = this.advance();
		return {
			kind: "literal",
			type: "string",
			value: token.value,
		};
	}

	private parseNumberLiteral(): CueLiteral {
		const token = this.advance();
		return {
			kind: "literal",
			type: "number",
			value: Number(token.value),
		};
	}

	private parseBoolLiteral(): CueLiteral {
		const token = this.advance();
		return {
			kind: "literal",
			type: "bool",
			value: token.type === TokenType.TRUE,
		};
	}

	private parseNullLiteral(): CueLiteral {
		this.advance();
		return {
			kind: "literal",
			type: "null",
			value: null,
		};
	}

	private parseStruct(): CueStruct {
		this.expect(TokenType.LBRACE);
		const fields = this.parseDeclarations(TokenType.RBRACE);
		this.expect(TokenType.RBRACE);
		return { kind: "struct", fields };
	}

	private parseList(): CueList {
		this.expect(TokenType.LBRACKET);
		const elements: CueNode[] = [];

		this.skipComments();

		if (this.peek().type === TokenType.RBRACKET) {
			this.advance();
			return { kind: "list", elements };
		}

		// Check for typed list: [...type]
		if (this.peek().type === TokenType.ELLIPSIS) {
			this.advance(); // consume ...
			const type = this.parsePrimary();
			elements.push({ kind: "ellipsis", type } as CueEllipsis);
			this.skipComments();
			this.expect(TokenType.RBRACKET);
			return { kind: "list", elements };
		}

		// Parse comma-separated elements
		elements.push(this.parseValue());
		while (this.peek().type === TokenType.COMMA) {
			this.advance(); // consume comma
			this.skipComments();
			if (this.peek().type === TokenType.RBRACKET) {
				break; // trailing comma
			}
			elements.push(this.parseValue());
		}

		this.skipComments();
		this.expect(TokenType.RBRACKET);
		return { kind: "list", elements };
	}

	private parseTypeKeyword(
		name: "string" | "int" | "float" | "bool" | "number" | "bytes",
	): CueType {
		this.advance();
		return { kind: "type", name };
	}

	private parseIdentifier(): CueIdent {
		const token = this.advance();
		return {
			kind: "ident",
			name: token.value,
		};
	}
}
