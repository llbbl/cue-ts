import type { CueFile } from "./ast.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";

/**
 * Parse a CUE input string and return the AST.
 */
export function parse(input: string): CueFile {
	const lexer = new Lexer(input);
	const tokens = lexer.tokenize();
	const parser = new Parser(tokens);
	return parser.parse();
}

export type {
	CueBinaryExpr,
	CueBinaryOperator,
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
// Smart deserialize with WASM auto-detection and fallback
export {
	deserialize,
	deserializeAsync,
	initWasm,
} from "./deserialize.js";
export type { DeserializeOptions } from "./deserializer.js";
// Direct access to the TS-only deserializer
export { deserializeTs } from "./deserializer.js";
export { CueParseError } from "./errors.js";
export { fastDeserialize } from "./fast-deserializer.js";
export { compileSchema, createDeserializer, stripDefinitions, type CueValidator } from "./compiled-schema.js";
export { Lexer } from "./lexer.js";
export { type Token, TokenType } from "./tokens.js";
