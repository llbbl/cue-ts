import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { CueParseError } from "../src/errors.js";
import type {
  CueFile,
  CueField,
  CueStruct,
  CueList,
  CueLiteral,
  CueIdent,
  CueType,
  CueUnaryExpr,
  CueBinaryExpr,
  CueDisjunction,
  CueDefinition,
  CueComment,
  CueEllipsis,
} from "../src/ast.js";

function parse(input: string): CueFile {
  const tokens = new Lexer(input).tokenize();
  return new Parser(tokens).parse();
}

describe("Parser", () => {
  describe("single field", () => {
    it("should parse a single string field", () => {
      const result = parse('name: "hello"');

      expect(result.kind).toBe("file");
      expect(result.declarations).toHaveLength(1);

      const field = result.declarations[0] as CueField;
      expect(field.kind).toBe("field");
      expect(field.label).toBe("name");
      expect(field.optional).toBe(false);

      const value = field.value as CueLiteral;
      expect(value.kind).toBe("literal");
      expect(value.type).toBe("string");
      expect(value.value).toBe("hello");
    });
  });

  describe("multiple fields", () => {
    it("should parse multiple fields separated by newlines", () => {
      const result = parse('name: "hello"\nage: 42');

      expect(result.declarations).toHaveLength(2);

      const nameField = result.declarations[0] as CueField;
      expect(nameField.label).toBe("name");
      const nameValue = nameField.value as CueLiteral;
      expect(nameValue.type).toBe("string");
      expect(nameValue.value).toBe("hello");

      const ageField = result.declarations[1] as CueField;
      expect(ageField.label).toBe("age");
      const ageValue = ageField.value as CueLiteral;
      expect(ageValue.type).toBe("number");
      expect(ageValue.value).toBe(42);
    });
  });

  describe("nested struct", () => {
    it('should parse outer: { inner: "value" }', () => {
      const result = parse('outer: { inner: "value" }');

      expect(result.declarations).toHaveLength(1);

      const outerField = result.declarations[0] as CueField;
      expect(outerField.label).toBe("outer");

      const struct = outerField.value as CueStruct;
      expect(struct.kind).toBe("struct");
      expect(struct.fields).toHaveLength(1);

      const innerField = struct.fields[0] as CueField;
      expect(innerField.label).toBe("inner");
      const innerValue = innerField.value as CueLiteral;
      expect(innerValue.type).toBe("string");
      expect(innerValue.value).toBe("value");
    });
  });

  describe("boolean and null fields", () => {
    it("should parse boolean and null values", () => {
      const result = parse("active: true\ndata: null");

      expect(result.declarations).toHaveLength(2);

      const activeField = result.declarations[0] as CueField;
      expect(activeField.label).toBe("active");
      const activeValue = activeField.value as CueLiteral;
      expect(activeValue.kind).toBe("literal");
      expect(activeValue.type).toBe("bool");
      expect(activeValue.value).toBe(true);

      const dataField = result.declarations[1] as CueField;
      expect(dataField.label).toBe("data");
      const dataValue = dataField.value as CueLiteral;
      expect(dataValue.kind).toBe("literal");
      expect(dataValue.type).toBe("null");
      expect(dataValue.value).toBe(null);
    });

    it("should parse false boolean", () => {
      const result = parse("disabled: false");

      const field = result.declarations[0] as CueField;
      const value = field.value as CueLiteral;
      expect(value.type).toBe("bool");
      expect(value.value).toBe(false);
    });
  });

  describe("deeply nested struct", () => {
    it("should parse structs nested multiple levels deep", () => {
      const result = parse('a: { b: { c: "deep" } }');

      const aField = result.declarations[0] as CueField;
      expect(aField.label).toBe("a");

      const aStruct = aField.value as CueStruct;
      expect(aStruct.kind).toBe("struct");

      const bField = aStruct.fields[0] as CueField;
      expect(bField.label).toBe("b");

      const bStruct = bField.value as CueStruct;
      expect(bStruct.kind).toBe("struct");

      const cField = bStruct.fields[0] as CueField;
      expect(cField.label).toBe("c");

      const cValue = cField.value as CueLiteral;
      expect(cValue.type).toBe("string");
      expect(cValue.value).toBe("deep");
    });
  });

  describe("identifier as value", () => {
    it("should parse an identifier on the right-hand side", () => {
      const result = parse("kind: someValue");

      const field = result.declarations[0] as CueField;
      expect(field.label).toBe("kind");

      const value = field.value as CueIdent;
      expect(value.kind).toBe("ident");
      expect(value.name).toBe("someValue");
    });
  });

  describe("empty struct", () => {
    it("should parse config: {}", () => {
      const result = parse("config: {}");

      const field = result.declarations[0] as CueField;
      expect(field.label).toBe("config");

      const struct = field.value as CueStruct;
      expect(struct.kind).toBe("struct");
      expect(struct.fields).toHaveLength(0);
    });
  });

  describe("comma-separated fields", () => {
    it("should parse fields separated by commas inside a struct", () => {
      const result = parse('data: { x: 1, y: 2 }');

      const field = result.declarations[0] as CueField;
      const struct = field.value as CueStruct;
      expect(struct.fields).toHaveLength(2);

      const xField = struct.fields[0] as CueField;
      expect(xField.label).toBe("x");
      expect((xField.value as CueLiteral).value).toBe(1);

      const yField = struct.fields[1] as CueField;
      expect(yField.label).toBe("y");
      expect((yField.value as CueLiteral).value).toBe(2);
    });
  });

  describe("lists", () => {
    it("should parse a simple number list", () => {
      const result = parse("items: [1, 2, 3]");

      const field = result.declarations[0] as CueField;
      expect(field.label).toBe("items");

      const list = field.value as CueList;
      expect(list.kind).toBe("list");
      expect(list.elements).toHaveLength(3);
      expect((list.elements[0] as CueLiteral).value).toBe(1);
      expect((list.elements[1] as CueLiteral).value).toBe(2);
      expect((list.elements[2] as CueLiteral).value).toBe(3);
    });

    it("should parse a string list", () => {
      const result = parse('tags: ["a", "b"]');

      const field = result.declarations[0] as CueField;
      const list = field.value as CueList;
      expect(list.kind).toBe("list");
      expect(list.elements).toHaveLength(2);
      expect((list.elements[0] as CueLiteral).value).toBe("a");
      expect((list.elements[1] as CueLiteral).value).toBe("b");
    });

    it("should parse an empty list", () => {
      const result = parse("data: []");

      const field = result.declarations[0] as CueField;
      const list = field.value as CueList;
      expect(list.kind).toBe("list");
      expect(list.elements).toHaveLength(0);
    });

    it("should parse a nested list", () => {
      const result = parse("matrix: [[1, 2], [3, 4]]");

      const field = result.declarations[0] as CueField;
      const list = field.value as CueList;
      expect(list.kind).toBe("list");
      expect(list.elements).toHaveLength(2);

      const inner1 = list.elements[0] as CueList;
      expect(inner1.kind).toBe("list");
      expect(inner1.elements).toHaveLength(2);
      expect((inner1.elements[0] as CueLiteral).value).toBe(1);
      expect((inner1.elements[1] as CueLiteral).value).toBe(2);

      const inner2 = list.elements[1] as CueList;
      expect(inner2.kind).toBe("list");
      expect(inner2.elements).toHaveLength(2);
      expect((inner2.elements[0] as CueLiteral).value).toBe(3);
      expect((inner2.elements[1] as CueLiteral).value).toBe(4);
    });

    it("should parse a typed list with ellipsis", () => {
      const result = parse("names: [...string]");

      const field = result.declarations[0] as CueField;
      const list = field.value as CueList;
      expect(list.kind).toBe("list");
      expect(list.elements).toHaveLength(1);

      const ellipsis = list.elements[0] as CueEllipsis;
      expect(ellipsis.kind).toBe("ellipsis");

      const type = ellipsis.type as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("string");
    });

    it("should parse a list with mixed element types", () => {
      const result = parse('mixed: [1, "two", true]');

      const field = result.declarations[0] as CueField;
      const list = field.value as CueList;
      expect(list.elements).toHaveLength(3);
      expect((list.elements[0] as CueLiteral).type).toBe("number");
      expect((list.elements[1] as CueLiteral).type).toBe("string");
      expect((list.elements[2] as CueLiteral).type).toBe("bool");
    });
  });

  describe("type keywords", () => {
    it("should parse string type", () => {
      const result = parse("name: string");

      const field = result.declarations[0] as CueField;
      expect(field.label).toBe("name");

      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("string");
    });

    it("should parse int type", () => {
      const result = parse("age: int");

      const field = result.declarations[0] as CueField;
      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("int");
    });

    it("should parse bool type", () => {
      const result = parse("ok: bool");

      const field = result.declarations[0] as CueField;
      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("bool");
    });

    it("should parse top type (_)", () => {
      const result = parse("anything: _");

      const field = result.declarations[0] as CueField;
      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("top");
    });

    it("should parse bottom type (_|_)", () => {
      const result = parse("never: _|_");

      const field = result.declarations[0] as CueField;
      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("bottom");
    });

    it("should parse float type", () => {
      const result = parse("ratio: float");

      const field = result.declarations[0] as CueField;
      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("float");
    });

    it("should parse number type", () => {
      const result = parse("val: number");

      const field = result.declarations[0] as CueField;
      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("number");
    });

    it("should parse bytes type", () => {
      const result = parse("raw: bytes");

      const field = result.declarations[0] as CueField;
      const type = field.value as CueType;
      expect(type.kind).toBe("type");
      expect(type.name).toBe("bytes");
    });
  });

  describe("constraints", () => {
    it("should parse a simple constraint: int & >=0", () => {
      const result = parse("age: int & >=0");

      const field = result.declarations[0] as CueField;
      expect(field.label).toBe("age");

      const expr = field.value as CueBinaryExpr;
      expect(expr.kind).toBe("binary_expr");
      expect(expr.operator).toBe("&");

      const left = expr.left as CueType;
      expect(left.kind).toBe("type");
      expect(left.name).toBe("int");

      const right = expr.right as CueUnaryExpr;
      expect(right.kind).toBe("unary_expr");
      expect(right.operator).toBe(">=");

      const operand = right.operand as CueLiteral;
      expect(operand.kind).toBe("literal");
      expect(operand.value).toBe(0);
    });

    it("should parse a pattern constraint: string & =~\"@\"", () => {
      const result = parse('email: string & =~"@"');

      const field = result.declarations[0] as CueField;
      const expr = field.value as CueBinaryExpr;
      expect(expr.kind).toBe("binary_expr");
      expect(expr.operator).toBe("&");

      const left = expr.left as CueType;
      expect(left.kind).toBe("type");
      expect(left.name).toBe("string");

      const right = expr.right as CueUnaryExpr;
      expect(right.kind).toBe("unary_expr");
      expect(right.operator).toBe("=~");

      const operand = right.operand as CueLiteral;
      expect(operand.kind).toBe("literal");
      expect(operand.value).toBe("@");
    });

    it("should parse multiple constraints: int & >=0 & <100", () => {
      const result = parse("score: int & >=0 & <100");

      const field = result.declarations[0] as CueField;

      // Should nest as: (int & >=0) & <100
      const outer = field.value as CueBinaryExpr;
      expect(outer.kind).toBe("binary_expr");
      expect(outer.operator).toBe("&");

      const inner = outer.left as CueBinaryExpr;
      expect(inner.kind).toBe("binary_expr");
      expect(inner.operator).toBe("&");

      const intType = inner.left as CueType;
      expect(intType.kind).toBe("type");
      expect(intType.name).toBe("int");

      const gte = inner.right as CueUnaryExpr;
      expect(gte.operator).toBe(">=");
      expect((gte.operand as CueLiteral).value).toBe(0);

      const lt = outer.right as CueUnaryExpr;
      expect(lt.operator).toBe("<");
      expect((lt.operand as CueLiteral).value).toBe(100);
    });
  });

  describe("disjunctions", () => {
    it('should parse role: "admin" | "user"', () => {
      const result = parse('role: "admin" | "user"');

      const field = result.declarations[0] as CueField;
      expect(field.label).toBe("role");

      const disj = field.value as CueDisjunction;
      expect(disj.kind).toBe("disjunction");
      expect(disj.elements).toHaveLength(2);
      expect((disj.elements[0] as CueLiteral).value).toBe("admin");
      expect((disj.elements[1] as CueLiteral).value).toBe("user");
    });

    it("should parse value: 1 | 2 | 3", () => {
      const result = parse("value: 1 | 2 | 3");

      const field = result.declarations[0] as CueField;
      const disj = field.value as CueDisjunction;
      expect(disj.kind).toBe("disjunction");
      expect(disj.elements).toHaveLength(3);
      expect((disj.elements[0] as CueLiteral).value).toBe(1);
      expect((disj.elements[1] as CueLiteral).value).toBe(2);
      expect((disj.elements[2] as CueLiteral).value).toBe(3);
    });

    it("should parse kind: int | string", () => {
      const result = parse("kind: int | string");

      const field = result.declarations[0] as CueField;
      const disj = field.value as CueDisjunction;
      expect(disj.kind).toBe("disjunction");
      expect(disj.elements).toHaveLength(2);
      expect((disj.elements[0] as CueType).name).toBe("int");
      expect((disj.elements[1] as CueType).name).toBe("string");
    });

    it("should bind & tighter than |: age: int & >=0 | string", () => {
      const result = parse("age: int & >=0 | string");

      const field = result.declarations[0] as CueField;
      const disj = field.value as CueDisjunction;
      expect(disj.kind).toBe("disjunction");
      expect(disj.elements).toHaveLength(2);

      // First element: int & >=0
      const constraint = disj.elements[0] as CueBinaryExpr;
      expect(constraint.kind).toBe("binary_expr");
      expect(constraint.operator).toBe("&");
      expect((constraint.left as CueType).name).toBe("int");
      expect((constraint.right as CueUnaryExpr).operator).toBe(">=");

      // Second element: string
      const strType = disj.elements[1] as CueType;
      expect(strType.kind).toBe("type");
      expect(strType.name).toBe("string");
    });
  });

  describe("definitions", () => {
    it("should parse #Name: string", () => {
      const result = parse("#Name: string");

      expect(result.declarations).toHaveLength(1);
      const def = result.declarations[0] as CueDefinition;
      expect(def.kind).toBe("definition");
      expect(def.name).toBe("Name");

      const value = def.value as CueType;
      expect(value.kind).toBe("type");
      expect(value.name).toBe("string");
    });

    it("should parse #Config: { host: string, port: int }", () => {
      const result = parse("#Config: { host: string, port: int }");

      const def = result.declarations[0] as CueDefinition;
      expect(def.kind).toBe("definition");
      expect(def.name).toBe("Config");

      const struct = def.value as CueStruct;
      expect(struct.kind).toBe("struct");
      expect(struct.fields).toHaveLength(2);

      const hostField = struct.fields[0] as CueField;
      expect(hostField.label).toBe("host");
      expect((hostField.value as CueType).name).toBe("string");

      const portField = struct.fields[1] as CueField;
      expect(portField.label).toBe("port");
      expect((portField.value as CueType).name).toBe("int");
    });
  });

  describe("optional fields", () => {
    it("should parse name?: string", () => {
      const result = parse("name?: string");

      const field = result.declarations[0] as CueField;
      expect(field.kind).toBe("field");
      expect(field.label).toBe("name");
      expect(field.optional).toBe(true);

      const value = field.value as CueType;
      expect(value.kind).toBe("type");
      expect(value.name).toBe("string");
    });

    it("should parse mix of optional and required fields", () => {
      const result = parse("name: string\nage?: int");

      expect(result.declarations).toHaveLength(2);

      const nameField = result.declarations[0] as CueField;
      expect(nameField.label).toBe("name");
      expect(nameField.optional).toBe(false);

      const ageField = result.declarations[1] as CueField;
      expect(ageField.label).toBe("age");
      expect(ageField.optional).toBe(true);
      expect((ageField.value as CueType).name).toBe("int");
    });
  });

  describe("comments", () => {
    it("should parse a top-level comment", () => {
      const result = parse("// a comment\nname: string");

      expect(result.declarations).toHaveLength(2);

      const comment = result.declarations[0] as CueComment;
      expect(comment.kind).toBe("comment");
      expect(comment.text).toBe("a comment");

      const field = result.declarations[1] as CueField;
      expect(field.label).toBe("name");
    });

    it("should preserve comments between fields", () => {
      const result = parse('name: string\n// middle comment\nage: 42');

      expect(result.declarations).toHaveLength(3);

      expect((result.declarations[0] as CueField).label).toBe("name");

      const comment = result.declarations[1] as CueComment;
      expect(comment.kind).toBe("comment");
      expect(comment.text).toBe("middle comment");

      expect((result.declarations[2] as CueField).label).toBe("age");
    });

    it("should have correct comment text content", () => {
      const result = parse("// hello world");

      expect(result.declarations).toHaveLength(1);
      const comment = result.declarations[0] as CueComment;
      expect(comment.kind).toBe("comment");
      expect(comment.text).toBe("hello world");
    });
  });

  describe("trailing commas", () => {
    it("should parse trailing comma in struct", () => {
      const result = parse("config: { a: 1, b: 2, }");

      const field = result.declarations[0] as CueField;
      const struct = field.value as CueStruct;
      expect(struct.kind).toBe("struct");
      expect(struct.fields).toHaveLength(2);

      const aField = struct.fields[0] as CueField;
      expect(aField.label).toBe("a");
      expect((aField.value as CueLiteral).value).toBe(1);

      const bField = struct.fields[1] as CueField;
      expect(bField.label).toBe("b");
      expect((bField.value as CueLiteral).value).toBe(2);
    });

    it("should parse trailing comma in list", () => {
      const result = parse("items: [1, 2,]");

      const field = result.declarations[0] as CueField;
      const list = field.value as CueList;
      expect(list.kind).toBe("list");
      expect(list.elements).toHaveLength(2);
      expect((list.elements[0] as CueLiteral).value).toBe(1);
      expect((list.elements[1] as CueLiteral).value).toBe(2);
    });
  });

  describe("nested definitions", () => {
    it("should parse #Outer: { #Inner: { x: int } }", () => {
      const result = parse("#Outer: { #Inner: { x: int } }");

      expect(result.declarations).toHaveLength(1);
      const outerDef = result.declarations[0] as CueDefinition;
      expect(outerDef.kind).toBe("definition");
      expect(outerDef.name).toBe("Outer");

      const outerStruct = outerDef.value as CueStruct;
      expect(outerStruct.kind).toBe("struct");
      expect(outerStruct.fields).toHaveLength(1);

      const innerDef = outerStruct.fields[0] as CueDefinition;
      expect(innerDef.kind).toBe("definition");
      expect(innerDef.name).toBe("Inner");

      const innerStruct = innerDef.value as CueStruct;
      expect(innerStruct.kind).toBe("struct");
      expect(innerStruct.fields).toHaveLength(1);

      const xField = innerStruct.fields[0] as CueField;
      expect(xField.label).toBe("x");
      expect((xField.value as CueType).name).toBe("int");
    });
  });

  describe("empty and whitespace-only input", () => {
    it("should parse empty string to CueFile with empty declarations", () => {
      const result = parse("");
      expect(result.kind).toBe("file");
      expect(result.declarations).toHaveLength(0);
    });

    it("should parse whitespace-only input to CueFile with empty declarations", () => {
      const result = parse("   \n  ");
      expect(result.kind).toBe("file");
      expect(result.declarations).toHaveLength(0);
    });
  });

  describe("quoted field labels", () => {
    it('should parse "my-key": "value"', () => {
      const result = parse('"my-key": "value"');

      expect(result.declarations).toHaveLength(1);
      const field = result.declarations[0] as CueField;
      expect(field.kind).toBe("field");
      expect(field.label).toBe("my-key");
      expect(field.optional).toBe(false);

      const value = field.value as CueLiteral;
      expect(value.kind).toBe("literal");
      expect(value.type).toBe("string");
      expect(value.value).toBe("value");
    });

    it("should parse quoted labels inside structs", () => {
      const result = parse('config: { "content-type": "json" }');

      const field = result.declarations[0] as CueField;
      const struct = field.value as CueStruct;
      expect(struct.fields).toHaveLength(1);

      const innerField = struct.fields[0] as CueField;
      expect(innerField.label).toBe("content-type");
      expect((innerField.value as CueLiteral).value).toBe("json");
    });
  });

  describe("structs with mixed comments and definitions", () => {
    it("should parse struct with comments between fields", () => {
      const input = `config: {
  // The hostname
  host: "localhost"
  // The port number
  port: 8080
}`;
      const result = parse(input);

      const field = result.declarations[0] as CueField;
      const struct = field.value as CueStruct;
      expect(struct.fields).toHaveLength(4);

      expect((struct.fields[0] as CueComment).kind).toBe("comment");
      expect((struct.fields[0] as CueComment).text).toBe("The hostname");

      expect((struct.fields[1] as CueField).label).toBe("host");

      expect((struct.fields[2] as CueComment).kind).toBe("comment");
      expect((struct.fields[2] as CueComment).text).toBe("The port number");

      expect((struct.fields[3] as CueField).label).toBe("port");
    });

    it("should parse struct with comments and definitions", () => {
      const input = `{
  // A definition
  #Name: string
  // A field
  name: "test"
}`;
      const result = parse("config: " + input);

      const field = result.declarations[0] as CueField;
      const struct = field.value as CueStruct;
      expect(struct.fields).toHaveLength(4);

      expect((struct.fields[0] as CueComment).kind).toBe("comment");
      expect((struct.fields[1] as CueDefinition).kind).toBe("definition");
      expect((struct.fields[2] as CueComment).kind).toBe("comment");
      expect((struct.fields[3] as CueField).kind).toBe("field");
    });
  });

  describe("error handling", () => {
    it("should throw CueParseError on missing colon", () => {
      expect(() => parse('name "hello"')).toThrow(CueParseError);
      expect(() => parse('name "hello"')).toThrow(/Expected COLON/);
    });

    it("should throw CueParseError on unexpected token in value position", () => {
      expect(() => parse("name: :")).toThrow(CueParseError);
    });

    it("should include line and column in error", () => {
      try {
        parse('name "hello"');
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const parseError = error as CueParseError;
        expect(parseError.line).toBe(1);
        expect(parseError.column).toBeGreaterThan(0);
      }
    });

    it("should throw on unclosed struct", () => {
      expect(() => parse("config: { name: 1")).toThrow(CueParseError);
    });
  });
});
