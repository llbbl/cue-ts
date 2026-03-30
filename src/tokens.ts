export enum TokenType {
	// Literals
	STRING,
	NUMBER,
	IDENT,

	// Keywords
	NULL,
	TRUE,
	FALSE,

	// Type keywords
	STRING_TYPE, // "string"
	INT_TYPE, // "int"
	FLOAT_TYPE, // "float"
	BOOL_TYPE, // "bool"
	NUMBER_TYPE, // "number"
	BYTES_TYPE, // "bytes"

	// Punctuation
	LBRACE, // {
	RBRACE, // }
	LBRACKET, // [
	RBRACKET, // ]
	COLON, // :
	COMMA, // ,
	LPAREN, // (
	RPAREN, // )

	// Operators
	PIPE, // |
	AMP, // &
	GTE, // >=
	LTE, // <=
	GT, // >
	LT, // <
	EQ, // ==
	NEQ, // !=
	MATCH, // =~
	NOT_MATCH, // !~

	// Special
	COMMENT, // // ...
	ELLIPSIS, // ...
	QUESTION, // ?
	HASH, // #
	UNDERSCORE, // _ (top)
	BOTTOM, // _|_

	EOF,
}

export interface Token {
	type: TokenType;
	value: string;
	line: number;
	column: number;
}
