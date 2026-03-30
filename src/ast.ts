export interface CueFile {
	kind: "file";
	declarations: CueNode[];
}

export interface CueField {
	kind: "field";
	label: string;
	optional: boolean;
	value: CueNode;
}

export interface CueStruct {
	kind: "struct";
	fields: CueNode[];
}

export interface CueList {
	kind: "list";
	elements: CueNode[];
}

export interface CueLiteral {
	kind: "literal";
	type: "string" | "number" | "bool" | "null";
	value: string | number | boolean | null;
}

export interface CueIdent {
	kind: "ident";
	name: string;
}

export interface CueType {
	kind: "type";
	name: "string" | "int" | "float" | "bool" | "number" | "bytes" | "top" | "bottom";
}

export type CueUnaryOperator = ">=" | "<=" | ">" | "<" | "=~" | "!~";

export type CueBinaryOperator = "&";

export interface CueUnaryExpr {
	kind: "unary_expr";
	operator: CueUnaryOperator;
	operand: CueNode;
}

export interface CueBinaryExpr {
	kind: "binary_expr";
	operator: CueBinaryOperator;
	left: CueNode;
	right: CueNode;
}

export interface CueDisjunction {
	kind: "disjunction";
	elements: CueNode[];
}

export interface CueDefinition {
	kind: "definition";
	name: string;
	value: CueNode;
}

export interface CueComment {
	kind: "comment";
	text: string;
}

export interface CueEllipsis {
	kind: "ellipsis";
	type?: CueNode;
}

export type CueNode =
	| CueFile
	| CueField
	| CueStruct
	| CueList
	| CueLiteral
	| CueIdent
	| CueType
	| CueUnaryExpr
	| CueBinaryExpr
	| CueDisjunction
	| CueDefinition
	| CueComment
	| CueEllipsis;
