import { Lexer } from "./lexer.js";
import { type Token, TokenType } from "./tokens.js";
import { fastDeserialize } from "./fast-deserializer.js";

// Compiled constraint types
interface CompiledField {
	type?: "string" | "int" | "float" | "bool" | "number";
	pattern?: RegExp;
	enumValues?: (string | number | boolean | null)[];
	min?: number;
	max?: number;
	minExclusive?: number;
	maxExclusive?: number;
	required?: boolean;
	nested?: CompiledSchema;
	arrayItem?: CompiledField;
}

interface CompiledSchema {
	fields: Map<string, CompiledField>;
}

export interface CueValidator {
	validate: (data: unknown) => void;
	validateSafe: (data: unknown) => { success: boolean; errors: string[] };
}

// ── Token-stream helpers ──────────────────────────────────────────────

type Cursor = { pos: number };

function peek(tokens: Token[], cur: Cursor): Token {
	return tokens[cur.pos] ?? tokens[tokens.length - 1]!;
}

function advance(tokens: Token[], cur: Cursor): Token {
	const t = tokens[cur.pos] ?? tokens[tokens.length - 1]!;
	cur.pos++;
	return t;
}

function expect(tokens: Token[], cur: Cursor, type: TokenType): Token {
	const t = advance(tokens, cur);
	if (t.type !== type) {
		throw new Error(
			`Expected ${TokenType[type]} but got ${TokenType[t.type]} ("${t.value}") at ${t.line}:${t.column}`,
		);
	}
	return t;
}

function skipComments(tokens: Token[], cur: Cursor): void {
	while (peek(tokens, cur).type === TokenType.COMMENT) {
		cur.pos++;
	}
}

// ── Extraction ────────────────────────────────────────────────────────

function extractDefinitions(tokens: Token[]): Map<string, CompiledSchema> {
	const definitions = new Map<string, CompiledSchema>();
	const cur: Cursor = { pos: 0 };

	while (peek(tokens, cur).type !== TokenType.EOF) {
		skipComments(tokens, cur);
		const t = peek(tokens, cur);

		// Look for #Name: { ... }
		if (t.type === TokenType.HASH) {
			cur.pos++; // skip #
			const nameTok = peek(tokens, cur);
			if (nameTok.type === TokenType.IDENT) {
				const name = nameTok.value;
				cur.pos++; // skip name
				skipComments(tokens, cur);

				if (peek(tokens, cur).type === TokenType.COLON) {
					cur.pos++; // skip :
					skipComments(tokens, cur);

					if (peek(tokens, cur).type === TokenType.LBRACE) {
						const schema = parseStructSchema(tokens, cur, definitions);
						definitions.set(name, schema);
						continue;
					}
				}
			}
			// Not a definition we understand, skip to next line-ish
			skipToNextTopLevel(tokens, cur);
			continue;
		}

		// Skip non-definition top-level fields (data fields)
		cur.pos++;
	}

	return definitions;
}

function skipToNextTopLevel(tokens: Token[], cur: Cursor): void {
	let depth = 0;
	while (peek(tokens, cur).type !== TokenType.EOF) {
		const t = peek(tokens, cur);
		if (t.type === TokenType.LBRACE || t.type === TokenType.LBRACKET || t.type === TokenType.LPAREN) {
			depth++;
			cur.pos++;
		} else if (t.type === TokenType.RBRACE || t.type === TokenType.RBRACKET || t.type === TokenType.RPAREN) {
			if (depth === 0) return;
			depth--;
			cur.pos++;
		} else if (depth === 0 && (t.type === TokenType.HASH || t.type === TokenType.IDENT || t.type === TokenType.STRING)) {
			// Possible start of next top-level item — check if we are truly at depth 0
			return;
		} else {
			cur.pos++;
		}
	}
}

function parseStructSchema(
	tokens: Token[],
	cur: Cursor,
	definitions: Map<string, CompiledSchema>,
): CompiledSchema {
	expect(tokens, cur, TokenType.LBRACE);
	const fields = new Map<string, CompiledField>();

	while (peek(tokens, cur).type !== TokenType.RBRACE && peek(tokens, cur).type !== TokenType.EOF) {
		skipComments(tokens, cur);

		if (peek(tokens, cur).type === TokenType.RBRACE) break;

		// Handle ellipsis: ...
		if (peek(tokens, cur).type === TokenType.ELLIPSIS) {
			cur.pos++;
			// May be followed by a type constraint — skip it
			skipTypeExpression(tokens, cur);
			skipComma(tokens, cur);
			continue;
		}

		// Handle [string]: type (open struct constraint) — skip
		if (peek(tokens, cur).type === TokenType.LBRACKET) {
			skipBracketed(tokens, cur);
			if (peek(tokens, cur).type === TokenType.COLON) cur.pos++;
			skipTypeExpression(tokens, cur);
			skipComma(tokens, cur);
			continue;
		}

		// Field name
		let fieldName: string;
		if (peek(tokens, cur).type === TokenType.IDENT) {
			fieldName = advance(tokens, cur).value;
		} else if (peek(tokens, cur).type === TokenType.STRING) {
			fieldName = advance(tokens, cur).value;
		} else {
			// Unknown token in struct, skip
			cur.pos++;
			continue;
		}

		skipComments(tokens, cur);

		// Optional: ?
		let required = true;
		if (peek(tokens, cur).type === TokenType.QUESTION) {
			required = false;
			cur.pos++;
		}

		skipComments(tokens, cur);

		// Colon
		if (peek(tokens, cur).type !== TokenType.COLON) {
			skipTypeExpression(tokens, cur);
			skipComma(tokens, cur);
			continue;
		}
		cur.pos++; // skip :
		skipComments(tokens, cur);

		const field = parseFieldType(tokens, cur, definitions);
		field.required = required;
		fields.set(fieldName, field);

		skipComma(tokens, cur);
	}

	if (peek(tokens, cur).type === TokenType.RBRACE) {
		cur.pos++;
	}

	return { fields };
}

function parseFieldType(
	tokens: Token[],
	cur: Cursor,
	definitions: Map<string, CompiledSchema>,
): CompiledField {
	skipComments(tokens, cur);
	const field: CompiledField = {};

	// Collect all parts of the type expression (handling & chains and | disjunctions)
	parseTypeAtom(tokens, cur, definitions, field);

	// Handle & (unification) chains
	while (peek(tokens, cur).type === TokenType.AMP) {
		cur.pos++; // skip &
		skipComments(tokens, cur);
		parseTypeAtom(tokens, cur, definitions, field);
	}

	return field;
}

function parseTypeAtom(
	tokens: Token[],
	cur: Cursor,
	definitions: Map<string, CompiledSchema>,
	field: CompiledField,
): void {
	skipComments(tokens, cur);
	const t = peek(tokens, cur);

	// Type keywords
	if (t.type === TokenType.STRING_TYPE) {
		field.type = "string";
		cur.pos++;
		return;
	}
	if (t.type === TokenType.INT_TYPE) {
		field.type = "int";
		cur.pos++;
		return;
	}
	if (t.type === TokenType.FLOAT_TYPE) {
		field.type = "float";
		cur.pos++;
		return;
	}
	if (t.type === TokenType.BOOL_TYPE) {
		field.type = "bool";
		cur.pos++;
		return;
	}
	if (t.type === TokenType.NUMBER_TYPE) {
		field.type = "number";
		cur.pos++;
		return;
	}

	// Regex pattern: =~ "pattern"
	if (t.type === TokenType.MATCH) {
		cur.pos++; // skip =~
		skipComments(tokens, cur);
		if (peek(tokens, cur).type === TokenType.STRING) {
			const pattern = advance(tokens, cur).value;
			try {
				field.pattern = new RegExp(pattern);
			} catch {
				// Invalid regex, skip
			}
		}
		return;
	}

	// Range constraints: >= N, <= N, > N, < N
	if (t.type === TokenType.GTE) {
		cur.pos++;
		skipComments(tokens, cur);
		if (peek(tokens, cur).type === TokenType.NUMBER) {
			field.min = Number(advance(tokens, cur).value);
		}
		return;
	}
	if (t.type === TokenType.LTE) {
		cur.pos++;
		skipComments(tokens, cur);
		if (peek(tokens, cur).type === TokenType.NUMBER) {
			field.max = Number(advance(tokens, cur).value);
		}
		return;
	}
	if (t.type === TokenType.GT) {
		cur.pos++;
		skipComments(tokens, cur);
		if (peek(tokens, cur).type === TokenType.NUMBER) {
			field.minExclusive = Number(advance(tokens, cur).value);
		}
		return;
	}
	if (t.type === TokenType.LT) {
		cur.pos++;
		skipComments(tokens, cur);
		if (peek(tokens, cur).type === TokenType.NUMBER) {
			field.maxExclusive = Number(advance(tokens, cur).value);
		}
		return;
	}

	// Definition reference: #Name
	if (t.type === TokenType.HASH) {
		cur.pos++; // skip #
		if (peek(tokens, cur).type === TokenType.IDENT) {
			const refName = advance(tokens, cur).value;
			const refSchema = definitions.get(refName);
			if (refSchema) {
				field.nested = refSchema;
			}
		}
		return;
	}

	// Inline struct: { ... }
	if (t.type === TokenType.LBRACE) {
		const schema = parseStructSchema(tokens, cur, definitions);
		field.nested = schema;
		return;
	}

	// Array: [...Type] or [...#Ref]
	if (t.type === TokenType.LBRACKET) {
		cur.pos++; // skip [
		skipComments(tokens, cur);
		if (peek(tokens, cur).type === TokenType.ELLIPSIS) {
			cur.pos++; // skip ...
			skipComments(tokens, cur);

			const itemField: CompiledField = {};

			if (peek(tokens, cur).type === TokenType.HASH) {
				cur.pos++; // skip #
				if (peek(tokens, cur).type === TokenType.IDENT) {
					const refName = advance(tokens, cur).value;
					const refSchema = definitions.get(refName);
					if (refSchema) {
						itemField.nested = refSchema;
					}
				}
			} else if (peek(tokens, cur).type === TokenType.STRING_TYPE) {
				itemField.type = "string";
				cur.pos++;
			} else if (peek(tokens, cur).type === TokenType.INT_TYPE) {
				itemField.type = "int";
				cur.pos++;
			} else if (peek(tokens, cur).type === TokenType.BOOL_TYPE) {
				itemField.type = "bool";
				cur.pos++;
			} else if (peek(tokens, cur).type === TokenType.LBRACE) {
				// Inline struct in array: [...{ ... }]
				const schema = parseStructSchema(tokens, cur, definitions);
				itemField.nested = schema;
			} else {
				// Unknown item type, skip to ]
				skipToClosingBracket(tokens, cur);
				return;
			}

			field.arrayItem = itemField;
		}

		// Skip to closing ]
		skipToClosingBracket(tokens, cur);
		return;
	}

	// Disjunction of literals: "a" | "b" | "c" or number literals
	if (t.type === TokenType.STRING || t.type === TokenType.NUMBER || t.type === TokenType.TRUE || t.type === TokenType.FALSE || t.type === TokenType.NULL) {
		const values: (string | number | boolean | null)[] = [];
		values.push(parseLiteralValue(tokens, cur));

		while (peek(tokens, cur).type === TokenType.PIPE) {
			cur.pos++; // skip |
			skipComments(tokens, cur);
			const next = peek(tokens, cur);
			if (next.type === TokenType.STRING || next.type === TokenType.NUMBER || next.type === TokenType.TRUE || next.type === TokenType.FALSE || next.type === TokenType.NULL) {
				values.push(parseLiteralValue(tokens, cur));
			} else {
				break;
			}
		}

		if (values.length > 0) {
			field.enumValues = values;
		}
		return;
	}

	// Parenthesized expression
	if (t.type === TokenType.LPAREN) {
		cur.pos++;
		parseTypeAtom(tokens, cur, definitions, field);
		// Handle | inside parens
		while (peek(tokens, cur).type === TokenType.PIPE) {
			cur.pos++;
			skipComments(tokens, cur);
			parseTypeAtom(tokens, cur, definitions, field);
		}
		if (peek(tokens, cur).type === TokenType.RPAREN) cur.pos++;
		return;
	}

	// Unknown — skip single token
	cur.pos++;
}

function parseLiteralValue(tokens: Token[], cur: Cursor): string | number | boolean | null {
	const t = advance(tokens, cur);
	switch (t.type) {
		case TokenType.STRING:
			return t.value;
		case TokenType.NUMBER:
			return Number(t.value);
		case TokenType.TRUE:
			return true;
		case TokenType.FALSE:
			return false;
		case TokenType.NULL:
			return null;
		default:
			return t.value;
	}
}

function skipComma(tokens: Token[], cur: Cursor): void {
	skipComments(tokens, cur);
	if (peek(tokens, cur).type === TokenType.COMMA) {
		cur.pos++;
	}
}

function skipBracketed(tokens: Token[], cur: Cursor): void {
	if (peek(tokens, cur).type !== TokenType.LBRACKET) return;
	cur.pos++;
	let depth = 1;
	while (depth > 0 && peek(tokens, cur).type !== TokenType.EOF) {
		const t = peek(tokens, cur);
		if (t.type === TokenType.LBRACKET) depth++;
		else if (t.type === TokenType.RBRACKET) depth--;
		cur.pos++;
	}
}

function skipToClosingBracket(tokens: Token[], cur: Cursor): void {
	while (peek(tokens, cur).type !== TokenType.RBRACKET && peek(tokens, cur).type !== TokenType.EOF) {
		if (peek(tokens, cur).type === TokenType.LBRACE) {
			skipBraced(tokens, cur);
		} else if (peek(tokens, cur).type === TokenType.LBRACKET) {
			skipBracketed(tokens, cur);
		} else {
			cur.pos++;
		}
	}
	if (peek(tokens, cur).type === TokenType.RBRACKET) {
		cur.pos++;
	}
}

function skipBraced(tokens: Token[], cur: Cursor): void {
	if (peek(tokens, cur).type !== TokenType.LBRACE) return;
	cur.pos++;
	let depth = 1;
	while (depth > 0 && peek(tokens, cur).type !== TokenType.EOF) {
		const t = peek(tokens, cur);
		if (t.type === TokenType.LBRACE) depth++;
		else if (t.type === TokenType.RBRACE) depth--;
		cur.pos++;
	}
}

function skipTypeExpression(tokens: Token[], cur: Cursor): void {
	// Skip tokens until we hit a comma, closing brace, or EOF at depth 0
	let depth = 0;
	while (peek(tokens, cur).type !== TokenType.EOF) {
		const t = peek(tokens, cur);
		if (t.type === TokenType.LBRACE || t.type === TokenType.LBRACKET || t.type === TokenType.LPAREN) {
			depth++;
			cur.pos++;
		} else if (t.type === TokenType.RBRACE || t.type === TokenType.RBRACKET || t.type === TokenType.RPAREN) {
			if (depth === 0) return;
			depth--;
			cur.pos++;
		} else if (depth === 0 && t.type === TokenType.COMMA) {
			return;
		} else {
			cur.pos++;
		}
	}
}

// ── Validation ────────────────────────────────────────────────────────

function validateValue(data: unknown, definitions: Map<string, CompiledSchema>): string[] {
	if (data === null || data === undefined) {
		return [];
	}

	if (typeof data !== "object" || Array.isArray(data)) {
		return ["Expected top-level object"];
	}

	const errors: string[] = [];

	// If there are definitions, try to find a top-level field that references one
	// and validate its data against the definition.
	// For now, walk through data and validate any nested objects against
	// matching definitions by structure.
	validateObject(data as Record<string, unknown>, definitions, errors, "");

	return errors;
}

function validateObject(
	data: Record<string, unknown>,
	definitions: Map<string, CompiledSchema>,
	errors: string[],
	path: string,
): void {
	// Try to validate against all definitions by checking if any definition's
	// field names match the data's keys. This is a heuristic approach.
	// A more precise approach would track which definition each field references.
	for (const [, schema] of definitions) {
		if (schemaMatchesObject(schema, data)) {
			validateObjectAgainstSchema(data, schema, definitions, errors, path);
			return;
		}
	}

	// Recurse into nested objects
	for (const [key, value] of Object.entries(data)) {
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			validateObject(value as Record<string, unknown>, definitions, errors, `${path}.${key}`);
		} else if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				const item = value[i];
				if (item !== null && typeof item === "object" && !Array.isArray(item)) {
					validateObject(item as Record<string, unknown>, definitions, errors, `${path}.${key}[${i}]`);
				}
			}
		}
	}
}

function schemaMatchesObject(schema: CompiledSchema, data: Record<string, unknown>): boolean {
	// A schema "matches" if at least 50% of its required fields are present in data
	let requiredCount = 0;
	let matchCount = 0;
	for (const [fieldName, field] of schema.fields) {
		if (field.required !== false) {
			requiredCount++;
			if (fieldName in data) matchCount++;
		}
	}
	return requiredCount > 0 && matchCount >= requiredCount * 0.5;
}

function validateObjectAgainstSchema(
	data: Record<string, unknown>,
	schema: CompiledSchema,
	definitions: Map<string, CompiledSchema>,
	errors: string[],
	path: string,
): void {
	for (const [fieldName, field] of schema.fields) {
		const fullPath = path ? `${path}.${fieldName}` : fieldName;
		const value = data[fieldName];

		if (value === undefined || value === null) {
			if (field.required) {
				errors.push(`${fullPath}: required field missing`);
			}
			continue;
		}

		validateFieldValue(value, field, definitions, errors, fullPath);
	}
}

function validateFieldValue(
	value: unknown,
	field: CompiledField,
	definitions: Map<string, CompiledSchema>,
	errors: string[],
	path: string,
): void {
	// Type check
	if (field.type) {
		switch (field.type) {
			case "string":
				if (typeof value !== "string") {
					errors.push(`${path}: expected string, got ${typeof value}`);
					return;
				}
				break;
			case "int":
				if (typeof value !== "number" || !Number.isInteger(value)) {
					errors.push(`${path}: expected int, got ${typeof value}`);
					return;
				}
				break;
			case "float":
				if (typeof value !== "number") {
					errors.push(`${path}: expected float, got ${typeof value}`);
					return;
				}
				break;
			case "number":
				if (typeof value !== "number") {
					errors.push(`${path}: expected number, got ${typeof value}`);
					return;
				}
				break;
			case "bool":
				if (typeof value !== "boolean") {
					errors.push(`${path}: expected bool, got ${typeof value}`);
					return;
				}
				break;
		}
	}

	// Enum check
	if (field.enumValues) {
		if (!field.enumValues.includes(value as string | number | boolean | null)) {
			errors.push(`${path}: value ${JSON.stringify(value)} not in enum [${field.enumValues.map((v) => JSON.stringify(v)).join(", ")}]`);
			return;
		}
	}

	// Pattern check
	if (field.pattern && typeof value === "string") {
		if (!field.pattern.test(value)) {
			errors.push(`${path}: value "${value}" does not match pattern ${field.pattern.source}`);
		}
	}

	// Range checks
	if (typeof value === "number") {
		if (field.min !== undefined && value < field.min) {
			errors.push(`${path}: value ${value} is less than minimum ${field.min}`);
		}
		if (field.max !== undefined && value > field.max) {
			errors.push(`${path}: value ${value} exceeds maximum ${field.max}`);
		}
		if (field.minExclusive !== undefined && value <= field.minExclusive) {
			errors.push(`${path}: value ${value} must be greater than ${field.minExclusive}`);
		}
		if (field.maxExclusive !== undefined && value >= field.maxExclusive) {
			errors.push(`${path}: value ${value} must be less than ${field.maxExclusive}`);
		}
	}

	// Nested object
	if (field.nested && typeof value === "object" && value !== null && !Array.isArray(value)) {
		validateObjectAgainstSchema(
			value as Record<string, unknown>,
			field.nested,
			definitions,
			errors,
			path,
		);
	}

	// Array validation
	if (Array.isArray(value)) {
		if (field.arrayItem) {
			for (let i = 0; i < value.length; i++) {
				validateFieldValue(value[i], field.arrayItem, definitions, errors, `${path}[${i}]`);
			}
		}
	}
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Parse a CUE schema text containing #Definitions and compile it into
 * a fast validator. The schema is parsed once; validation runs without
 * any text parsing.
 */
export function compileSchema(schemaText: string): CueValidator {
	const lexer = new Lexer(schemaText);
	const tokens = lexer.tokenize();
	const definitions = extractDefinitions(tokens);

	return {
		validate(data: unknown): void {
			const errors = validateValue(data, definitions);
			if (errors.length > 0) {
				throw new Error(`Validation failed:\n${errors.join("\n")}`);
			}
		},
		validateSafe(data: unknown): { success: boolean; errors: string[] } {
			const errors = validateValue(data, definitions);
			return { success: errors.length === 0, errors };
		},
	};
}

/**
 * Create a deserializer with a pre-compiled schema.
 * Returns a function that deserializes CUE data text and validates
 * against the compiled schema.
 */
export function createDeserializer(schemaText: string): (dataText: string) => Record<string, unknown> {
	const validator = compileSchema(schemaText);

	return (dataText: string) => {
		const data = fastDeserialize(dataText);
		validator.validate(data);
		return data;
	};
}

/**
 * Strip all #Definition blocks from CUE text, returning only data fields.
 * Also strips comments. Used to pre-process schema+data CUE text so the
 * hot path only parses the smaller data portion.
 */
export function stripDefinitions(cueText: string): string {
	const lines: string[] = [];
	let i = 0;
	const len = cueText.length;

	while (i < len) {
		// Find start of next line
		const lineStart = i;
		const lineEnd = cueText.indexOf("\n", i);
		const eol = lineEnd === -1 ? len : lineEnd;

		// Get the line content
		const line = cueText.slice(lineStart, eol);
		const trimmed = line.trimStart();

		if (trimmed.startsWith("//")) {
			// Skip comment lines
			i = eol + 1;
			continue;
		}

		if (trimmed.startsWith("#") && /^#[A-Za-z_]\w*\s*:/.test(trimmed)) {
			// This is a #Definition: ... line — skip the entire definition block
			// Count braces to find the end
			let depth = 0;
			let foundBrace = false;

			for (let j = lineStart; j < len; j++) {
				const ch = cueText.charCodeAt(j);
				if (ch === 34) { // " — skip strings
					j++;
					while (j < len && cueText.charCodeAt(j) !== 34) {
						if (cueText.charCodeAt(j) === 92) j++; // skip escaped chars
						j++;
					}
				} else if (ch === 123) { // {
					depth++;
					foundBrace = true;
				} else if (ch === 125) { // }
					depth--;
					if (foundBrace && depth === 0) {
						// Skip past the closing brace and any trailing whitespace/newline
						i = j + 1;
						if (i < len && cueText.charCodeAt(i) === 10) i++;
						break;
					}
				} else if (ch === 10 && !foundBrace) {
					// Single-line definition (no braces), skip this line
					i = j + 1;
					break;
				}
			}
			if (!foundBrace && i <= lineStart) {
				// Fallback: skip the line
				i = eol + 1;
			}
			continue;
		}

		// Regular data line — keep it
		lines.push(line);
		i = eol + 1;
	}

	return lines.join("\n");
}
