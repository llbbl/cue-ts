import { CueParseError } from "./errors.js";
import { Lexer } from "./lexer.js";
import { type Token, TokenType } from "./tokens.js";

export interface DeserializeOptions {
	strict?: boolean; // default: true -- validate type constraints
	engine?: "auto" | "wasm" | "ts"; // default: "auto"
}

/** Sentinel marking a value expression that is type-only (no concrete data). */
const TYPE_ONLY = Symbol("type_only");

type DeserializedValue =
	| string
	| number
	| boolean
	| null
	| Record<string, unknown>
	| unknown[]
	| typeof TYPE_ONLY;

/**
 * Schema information collected during deserialization for strict-mode validation.
 */
interface FieldSchema {
	type?: string; // "string" | "int" | "float" | "bool" | "number" | "bytes"
	constraints?: Array<{ operator: string; operand: number | string }>;
	disjunctionValues?: Array<string | number | boolean | null>;
}

const TYPE_KEYWORDS = new Set<TokenType>([
	TokenType.STRING_TYPE,
	TokenType.INT_TYPE,
	TokenType.FLOAT_TYPE,
	TokenType.BOOL_TYPE,
	TokenType.NUMBER_TYPE,
	TokenType.BYTES_TYPE,
]);

/**
 * Fast CUE config loader that returns plain JS objects.
 * Reuses the existing Lexer for tokenization and performs a single-pass
 * recursive descent to build plain objects directly (no AST).
 */
export function deserializeTs(
	input: string,
	options?: DeserializeOptions,
): Record<string, unknown> {
	const strict = options?.strict ?? true;
	const lexer = new Lexer(input);
	const tokens = lexer.tokenize();
	const d = new Deserializer(tokens, strict);
	return d.deserializeTop();
}

class Deserializer {
	private tokens: Token[];
	private pos: number;
	private strict: boolean;

	constructor(tokens: Token[], strict: boolean) {
		this.tokens = tokens;
		this.pos = 0;
		this.strict = strict;
	}

	deserializeTop(): Record<string, unknown> {
		return this.deserializeDeclarations(TokenType.EOF);
	}

	// ── Token helpers ──────────────────────────────────────────────────

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

	// ── Declarations ───────────────────────────────────────────────────

	private deserializeDeclarations(
		closingToken: TokenType,
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		while (this.peek().type !== closingToken) {
			this.skipComments();
			if (this.peek().type === closingToken) break;

			// Definition: # IDENT : value  -- skip (store internally only)
			if (this.peek().type === TokenType.HASH) {
				this.parseDefinition();
			} else if (
				this.peek().type === TokenType.IDENT ||
				this.peek().type === TokenType.STRING
			) {
				const label = this.advance().value;

				// Skip optional marker
				if (this.peek().type === TokenType.QUESTION) {
					this.advance();
				}

				this.expect(TokenType.COLON);

				const { value, schema } = this.deserializeValueWithSchema();

				if (value !== TYPE_ONLY) {
					// Strict validation
					if (this.strict && schema) {
						this.validate(value, schema, label);
					}
					result[label] = value;
				}
			} else if (this.peek().type === TokenType.ELLIPSIS) {
				// Skip ellipsis in structs
				this.advance();
				// May be followed by a type
				if (
					this.peek().type !== TokenType.COMMA &&
					this.peek().type !== TokenType.RBRACE &&
					this.peek().type !== TokenType.EOF
				) {
					this.deserializeValue();
				}
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

		return result;
	}

	private parseDefinition(): void {
		this.expect(TokenType.HASH);
		this.expect(TokenType.IDENT);
		this.expect(TokenType.COLON);
		// Consume the value but discard it
		this.deserializeValue();
	}

	// ── Value parsing ──────────────────────────────────────────────────

	/**
	 * Parse a value and also extract any schema information for validation.
	 * Handles the & (unification) operator to split concrete values from constraints.
	 */
	private deserializeValueWithSchema(): {
		value: DeserializedValue;
		schema: FieldSchema | null;
	} {
		// Parse the full expression considering operator precedence
		const expr = this.parseExpression();
		return this.resolveExpression(expr);
	}

	/**
	 * Internal expression representation before resolution.
	 */
	private parseExpression(): ExprNode {
		const first = this.parseUnificationExpr();

		// Check for | (disjunction)
		if (this.peek().type === TokenType.PIPE) {
			const elements: ExprNode[] = [first];
			while (this.peek().type === TokenType.PIPE) {
				this.advance();
				elements.push(this.parseUnificationExpr());
			}
			return { kind: "disjunction", elements };
		}

		return first;
	}

	private parseUnificationExpr(): ExprNode {
		let left = this.parseConstraintOrPrimary();

		while (this.peek().type === TokenType.AMP) {
			this.advance();
			const right = this.parseConstraintOrPrimary();
			left = { kind: "unification", left, right };
		}

		return left;
	}

	private parseConstraintOrPrimary(): ExprNode {
		const token = this.peek();

		switch (token.type) {
			case TokenType.GTE:
			case TokenType.LTE:
			case TokenType.GT:
			case TokenType.LT:
			case TokenType.MATCH:
			case TokenType.NOT_MATCH: {
				const op = this.advance();
				const operand = this.parsePrimaryExpr();
				return { kind: "constraint", operator: op.value, operand };
			}
			default:
				return this.parsePrimaryExpr();
		}
	}

	private parsePrimaryExpr(): ExprNode {
		const token = this.peek();

		switch (token.type) {
			case TokenType.STRING: {
				const t = this.advance();
				return { kind: "literal", value: t.value, type: "string" };
			}
			case TokenType.NUMBER: {
				const t = this.advance();
				return { kind: "literal", value: Number(t.value), type: "number" };
			}
			case TokenType.TRUE: {
				this.advance();
				return { kind: "literal", value: true, type: "bool" };
			}
			case TokenType.FALSE: {
				this.advance();
				return { kind: "literal", value: false, type: "bool" };
			}
			case TokenType.NULL: {
				this.advance();
				return { kind: "literal", value: null, type: "null" };
			}
			case TokenType.LBRACE: {
				this.expect(TokenType.LBRACE);
				const obj = this.deserializeDeclarations(TokenType.RBRACE);
				this.expect(TokenType.RBRACE);
				return { kind: "literal", value: obj, type: "object" };
			}
			case TokenType.LBRACKET: {
				const arr = this.deserializeList();
				return { kind: "literal", value: arr, type: "array" };
			}
			case TokenType.IDENT: {
				const t = this.advance();
				return { kind: "ident", name: t.value };
			}
			case TokenType.UNDERSCORE: {
				this.advance();
				return { kind: "type_keyword", name: "top" };
			}
			case TokenType.BOTTOM: {
				this.advance();
				return { kind: "type_keyword", name: "bottom" };
			}
			case TokenType.LPAREN: {
				this.advance(); // consume (
				const inner = this.parseExpression();
				this.expect(TokenType.RPAREN);
				return inner;
			}
			default: {
				if (TYPE_KEYWORDS.has(token.type)) {
					const t = this.advance();
					return { kind: "type_keyword", name: t.value };
				}
				throw new CueParseError(
					`Unexpected token ${TokenType[token.type]}`,
					token.line,
					token.column,
				);
			}
		}
	}

	private deserializeList(): unknown[] {
		this.expect(TokenType.LBRACKET);
		const elements: unknown[] = [];

		this.skipComments();

		if (this.peek().type === TokenType.RBRACKET) {
			this.advance();
			return elements;
		}

		// Check for typed list: [...type] -- skip
		if (this.peek().type === TokenType.ELLIPSIS) {
			this.advance();
			this.deserializeValue(); // consume the type
			this.skipComments();
			this.expect(TokenType.RBRACKET);
			return elements;
		}

		const val = this.deserializeValue();
		if (val !== TYPE_ONLY) {
			elements.push(val);
		}

		while (this.peek().type === TokenType.COMMA) {
			this.advance();
			this.skipComments();
			if (this.peek().type === TokenType.RBRACKET) break;
			const v = this.deserializeValue();
			if (v !== TYPE_ONLY) {
				elements.push(v);
			}
		}

		this.skipComments();
		this.expect(TokenType.RBRACKET);
		return elements;
	}

	/**
	 * Simple value parse (used for definitions and contexts where we don't need schema).
	 */
	private deserializeValue(): DeserializedValue {
		const expr = this.parseExpression();
		const { value } = this.resolveExpression(expr);
		return value;
	}

	// ── Expression resolution ──────────────────────────────────────────

	private resolveExpression(expr: ExprNode): {
		value: DeserializedValue;
		schema: FieldSchema | null;
	} {
		switch (expr.kind) {
			case "literal":
				return { value: expr.value, schema: null };

			case "ident":
				// Identifier reference -- include as string (best effort)
				return { value: expr.name, schema: null };

			case "type_keyword":
				return { value: TYPE_ONLY, schema: { type: expr.name } };

			case "constraint":
				return {
					value: TYPE_ONLY,
					schema: {
						constraints: [
							{
								operator: expr.operator,
								operand: this.resolveConstraintOperand(expr.operand),
							},
						],
					},
				};

			case "disjunction":
				return this.resolveDisjunction(expr.elements);

			case "unification":
				return this.resolveUnification(expr.left, expr.right);
		}
	}

	private resolveConstraintOperand(expr: ExprNode): number | string {
		if (expr.kind === "literal") {
			if (typeof expr.value === "number" || typeof expr.value === "string") {
				return expr.value;
			}
			throw new CueParseError(
				`Invalid constraint operand: expected number or string, got ${typeof expr.value}`,
				0,
				0,
			);
		}
		throw new CueParseError(
			`Invalid constraint operand: expected a literal value, got ${expr.kind}`,
			0,
			0,
		);
	}

	private resolveDisjunction(elements: ExprNode[]): {
		value: DeserializedValue;
		schema: FieldSchema | null;
	} {
		// Check if all elements are literals -- this is an enum pattern
		const allLiterals = elements.every((e) => e.kind === "literal");
		if (allLiterals) {
			const vals = elements.map((e) => {
				if (e.kind === "literal") return e.value as string | number | boolean | null;
				return null;
			});
			return {
				value: TYPE_ONLY,
				schema: { disjunctionValues: vals },
			};
		}

		// Mixed: try to find a concrete value among the elements
		let concreteValue: DeserializedValue = TYPE_ONLY;
		const disjVals: Array<string | number | boolean | null> = [];

		for (const el of elements) {
			const resolved = this.resolveExpression(el);
			if (resolved.value !== TYPE_ONLY && concreteValue === TYPE_ONLY) {
				concreteValue = resolved.value;
			}
			if (el.kind === "literal") {
				disjVals.push(el.value as string | number | boolean | null);
			}
		}

		return {
			value: concreteValue,
			schema: disjVals.length > 0 ? { disjunctionValues: disjVals } : null,
		};
	}

	private resolveUnification(
		left: ExprNode,
		right: ExprNode,
	): { value: DeserializedValue; schema: FieldSchema | null } {
		const lRes = this.resolveExpression(left);
		const rRes = this.resolveExpression(right);

		// Merge schemas
		const schema = this.mergeSchemas(lRes.schema, rRes.schema);

		// If one side has a concrete value and the other is type-only, use the concrete value
		if (lRes.value !== TYPE_ONLY && rRes.value === TYPE_ONLY) {
			return { value: lRes.value, schema };
		}
		if (rRes.value !== TYPE_ONLY && lRes.value === TYPE_ONLY) {
			return { value: rRes.value, schema };
		}
		// Both concrete -- prefer left
		if (lRes.value !== TYPE_ONLY) {
			return { value: lRes.value, schema };
		}
		// Both type-only
		return { value: TYPE_ONLY, schema };
	}

	private mergeSchemas(
		a: FieldSchema | null,
		b: FieldSchema | null,
	): FieldSchema | null {
		if (!a && !b) return null;
		if (!a) return b;
		if (!b) return a;

		return {
			type: a.type ?? b.type,
			constraints: [
				...(a.constraints ?? []),
				...(b.constraints ?? []),
			],
			disjunctionValues: a.disjunctionValues ?? b.disjunctionValues,
		};
	}

	// ── Validation ─────────────────────────────────────────────────────

	private validate(
		value: DeserializedValue,
		schema: FieldSchema,
		label: string,
	): void {
		if (value === TYPE_ONLY) return;

		// Type validation
		if (schema.type) {
			this.validateType(value, schema.type, label);
		}

		// Constraint validation
		if (schema.constraints) {
			for (const c of schema.constraints) {
				this.validateConstraint(value, c.operator, c.operand, label);
			}
		}

		// Disjunction membership validation
		if (schema.disjunctionValues) {
			this.validateDisjunction(value, schema.disjunctionValues, label);
		}
	}

	private validateType(
		value: DeserializedValue,
		typeName: string,
		label: string,
	): void {
		switch (typeName) {
			case "string":
				if (typeof value !== "string") {
					throw new CueParseError(
						`Field "${label}": expected string, got ${typeof value}`,
						0,
						0,
					);
				}
				break;
			case "int":
				if (typeof value !== "number" || !Number.isInteger(value)) {
					throw new CueParseError(
						`Field "${label}": expected int, got ${typeof value === "number" ? "float" : typeof value}`,
						0,
						0,
					);
				}
				break;
			case "float":
			case "number":
				if (typeof value !== "number") {
					throw new CueParseError(
						`Field "${label}": expected ${typeName}, got ${typeof value}`,
						0,
						0,
					);
				}
				break;
			case "bool":
				if (typeof value !== "boolean") {
					throw new CueParseError(
						`Field "${label}": expected bool, got ${typeof value}`,
						0,
						0,
					);
				}
				break;
		}
	}

	private validateConstraint(
		value: DeserializedValue,
		operator: string,
		operand: number | string,
		label: string,
	): void {
		if (typeof value === "number" && typeof operand === "number") {
			let valid = false;
			switch (operator) {
				case ">=":
					valid = value >= operand;
					break;
				case "<=":
					valid = value <= operand;
					break;
				case ">":
					valid = value > operand;
					break;
				case "<":
					valid = value < operand;
					break;
				default:
					return; // unknown operator for numbers
			}
			if (!valid) {
				throw new CueParseError(
					`Field "${label}": value ${value} does not satisfy constraint ${operator} ${operand}`,
					0,
					0,
				);
			}
		}

		if (typeof value === "string" && typeof operand === "string") {
			if (operator === "=~" || operator === "!~") {
				let regex: RegExp;
				try {
					regex = new RegExp(operand);
				} catch {
					throw new CueParseError(
						`Field "${label}": invalid regex pattern: ${operand}`,
						0,
						0,
					);
				}
				if (operator === "=~") {
					if (!regex.test(value)) {
						throw new CueParseError(
							`Field "${label}": value "${value}" does not match pattern ${operand}`,
							0,
							0,
						);
					}
				} else {
					if (regex.test(value)) {
						throw new CueParseError(
							`Field "${label}": value "${value}" must not match pattern ${operand}`,
							0,
							0,
						);
					}
				}
			}
		}
	}

	private validateDisjunction(
		value: DeserializedValue,
		allowed: Array<string | number | boolean | null>,
		label: string,
	): void {
		if (!allowed.some((v) => v === value)) {
			throw new CueParseError(
				`Field "${label}": value ${JSON.stringify(value)} is not one of the allowed values: ${JSON.stringify(allowed)}`,
				0,
				0,
			);
		}
	}
}

// ── Internal expression types ────────────────────────────────────────

type LiteralType = "string" | "number" | "bool" | "null" | "object" | "array";

type ExprNode =
	| { kind: "literal"; value: string | number | boolean | null | Record<string, unknown> | unknown[]; type: LiteralType }
	| { kind: "ident"; name: string }
	| { kind: "type_keyword"; name: string }
	| { kind: "constraint"; operator: string; operand: ExprNode }
	| { kind: "disjunction"; elements: ExprNode[] }
	| { kind: "unification"; left: ExprNode; right: ExprNode };
