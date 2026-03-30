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
export { CueParseError } from "./errors.js";

export { Lexer } from "./lexer.js";
export { type Token, TokenType } from "./tokens.js";
