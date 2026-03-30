import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer.js";
import { TokenType } from "../src/tokens.js";

function tokenize(input: string) {
  return new Lexer(input).tokenize();
}

function tokenTypes(input: string) {
  return tokenize(input).map((t) => t.type);
}

function tokenValues(input: string) {
  return tokenize(input).map((t) => t.value);
}

describe("Lexer", () => {
  describe("punctuation tokens", () => {
    it("should tokenize all punctuation", () => {
      const tokens = tokenize("{ } [ ] : , ( )");
      expect(tokenTypes("{ } [ ] : , ( )")).toEqual([
        TokenType.LBRACE,
        TokenType.RBRACE,
        TokenType.LBRACKET,
        TokenType.RBRACKET,
        TokenType.COLON,
        TokenType.COMMA,
        TokenType.LPAREN,
        TokenType.RPAREN,
        TokenType.EOF,
      ]);
    });
  });

  describe("operator tokens", () => {
    it("should tokenize all operators", () => {
      expect(tokenTypes("| & >= <= > < == != =~ !~")).toEqual([
        TokenType.PIPE,
        TokenType.AMP,
        TokenType.GTE,
        TokenType.LTE,
        TokenType.GT,
        TokenType.LT,
        TokenType.EQ,
        TokenType.NEQ,
        TokenType.MATCH,
        TokenType.NOT_MATCH,
        TokenType.EOF,
      ]);
    });

    it("should tokenize > and < without following =", () => {
      const tokens = tokenize("> <");
      expect(tokens[0]!.type).toBe(TokenType.GT);
      expect(tokens[1]!.type).toBe(TokenType.LT);
    });
  });

  describe("string literals", () => {
    it("should tokenize a simple string", () => {
      const tokens = tokenize('"hello"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("hello");
    });

    it("should tokenize a string with escape sequences", () => {
      const tokens = tokenize('"line1\\nline2\\t\\"quoted\\\\"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe('line1\nline2\t"quoted\\');
    });

    it("should tokenize an empty string", () => {
      const tokens = tokenize('""');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("");
    });

    it("should tokenize a multi-line triple-quoted string", () => {
      const tokens = tokenize('"""hello\nworld"""');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("hello\nworld");
    });

    it("should throw on unterminated string", () => {
      expect(() => tokenize('"hello')).toThrow(/Unterminated string/);
    });

    it("should throw on newline in single-quoted string", () => {
      expect(() => tokenize('"hello\n')).toThrow(/Unterminated string/);
    });
  });

  describe("number literals", () => {
    it("should tokenize integers", () => {
      const tokens = tokenize("42 0 100");
      expect(tokens[0]!.type).toBe(TokenType.NUMBER);
      expect(tokens[0]!.value).toBe("42");
      expect(tokens[1]!.value).toBe("0");
      expect(tokens[2]!.value).toBe("100");
    });

    it("should tokenize floats", () => {
      const tokens = tokenize("3.14 0.5");
      expect(tokens[0]!.type).toBe(TokenType.NUMBER);
      expect(tokens[0]!.value).toBe("3.14");
      expect(tokens[1]!.value).toBe("0.5");
    });

    it("should tokenize negative numbers", () => {
      const tokens = tokenize("-1 -3.14");
      expect(tokens[0]!.type).toBe(TokenType.NUMBER);
      expect(tokens[0]!.value).toBe("-1");
      expect(tokens[1]!.type).toBe(TokenType.NUMBER);
      expect(tokens[1]!.value).toBe("-3.14");
    });
  });

  describe("boolean and null keywords", () => {
    it("should tokenize true, false, null", () => {
      expect(tokenTypes("true false null")).toEqual([
        TokenType.TRUE,
        TokenType.FALSE,
        TokenType.NULL,
        TokenType.EOF,
      ]);
    });

    it("should tokenize keyword values correctly", () => {
      expect(tokenValues("true false null")).toEqual([
        "true",
        "false",
        "null",
        "",
      ]);
    });
  });

  describe("type keywords", () => {
    it("should tokenize all type keywords", () => {
      expect(tokenTypes("string int float bool number bytes")).toEqual([
        TokenType.STRING_TYPE,
        TokenType.INT_TYPE,
        TokenType.FLOAT_TYPE,
        TokenType.BOOL_TYPE,
        TokenType.NUMBER_TYPE,
        TokenType.BYTES_TYPE,
        TokenType.EOF,
      ]);
    });
  });

  describe("identifiers", () => {
    it("should tokenize simple identifiers", () => {
      const tokens = tokenize("foo bar_baz Abc123");
      expect(tokens[0]!.type).toBe(TokenType.IDENT);
      expect(tokens[0]!.value).toBe("foo");
      expect(tokens[1]!.value).toBe("bar_baz");
      expect(tokens[2]!.value).toBe("Abc123");
    });

    it("should not confuse identifiers starting with keywords", () => {
      const tokens = tokenize("trueValue nullable");
      expect(tokens[0]!.type).toBe(TokenType.IDENT);
      expect(tokens[0]!.value).toBe("trueValue");
      expect(tokens[1]!.type).toBe(TokenType.IDENT);
      expect(tokens[1]!.value).toBe("nullable");
    });
  });

  describe("comments", () => {
    it("should tokenize a single-line comment", () => {
      const tokens = tokenize("// this is a comment");
      expect(tokens[0]!.type).toBe(TokenType.COMMENT);
      expect(tokens[0]!.value).toBe("// this is a comment");
    });

    it("should tokenize a comment followed by more tokens", () => {
      const tokens = tokenize("foo // comment\nbar");
      expect(tokens[0]!.type).toBe(TokenType.IDENT);
      expect(tokens[1]!.type).toBe(TokenType.COMMENT);
      expect(tokens[2]!.type).toBe(TokenType.IDENT);
      expect(tokens[2]!.value).toBe("bar");
    });
  });

  describe("special tokens", () => {
    it("should tokenize ellipsis", () => {
      const tokens = tokenize("...");
      expect(tokens[0]!.type).toBe(TokenType.ELLIPSIS);
      expect(tokens[0]!.value).toBe("...");
    });

    it("should tokenize question mark", () => {
      const tokens = tokenize("?");
      expect(tokens[0]!.type).toBe(TokenType.QUESTION);
    });

    it("should tokenize hash", () => {
      const tokens = tokenize("#");
      expect(tokens[0]!.type).toBe(TokenType.HASH);
    });

    it("should tokenize standalone underscore as UNDERSCORE", () => {
      const tokens = tokenize("_");
      expect(tokens[0]!.type).toBe(TokenType.UNDERSCORE);
      expect(tokens[0]!.value).toBe("_");
    });

    it("should tokenize _|_ as BOTTOM", () => {
      const tokens = tokenize("_|_");
      expect(tokens[0]!.type).toBe(TokenType.BOTTOM);
      expect(tokens[0]!.value).toBe("_|_");
    });

    it("should distinguish _ from _|_ from identifiers starting with _", () => {
      const tokens = tokenize("_ _|_ _foo");
      expect(tokens[0]!.type).toBe(TokenType.UNDERSCORE);
      expect(tokens[1]!.type).toBe(TokenType.BOTTOM);
      expect(tokens[2]!.type).toBe(TokenType.IDENT);
      expect(tokens[2]!.value).toBe("_foo");
    });
  });

  describe("mixed input (real CUE-like)", () => {
    it("should tokenize a struct-like input", () => {
      const input = `{
  name: "Alice"
  age:  30
  active: true
}`;
      const types = tokenTypes(input);
      expect(types).toEqual([
        TokenType.LBRACE,
        TokenType.IDENT,
        TokenType.COLON,
        TokenType.STRING,
        TokenType.IDENT,
        TokenType.COLON,
        TokenType.NUMBER,
        TokenType.IDENT,
        TokenType.COLON,
        TokenType.TRUE,
        TokenType.RBRACE,
        TokenType.EOF,
      ]);
    });

    it("should tokenize a constraint expression", () => {
      const input = "age: int & >=0 & <=150";
      const types = tokenTypes(input);
      expect(types).toEqual([
        TokenType.IDENT,
        TokenType.COLON,
        TokenType.INT_TYPE,
        TokenType.AMP,
        TokenType.GTE,
        TokenType.NUMBER,
        TokenType.AMP,
        TokenType.LTE,
        TokenType.NUMBER,
        TokenType.EOF,
      ]);
    });

    it("should tokenize a disjunction", () => {
      const input = 'status: "active" | "inactive"';
      const types = tokenTypes(input);
      expect(types).toEqual([
        TokenType.IDENT,
        TokenType.COLON,
        TokenType.STRING,
        TokenType.PIPE,
        TokenType.STRING,
        TokenType.EOF,
      ]);
    });

    it("should tokenize a definition with optional field", () => {
      const input = "#Schema: { name?: string }";
      const types = tokenTypes(input);
      expect(types).toEqual([
        TokenType.HASH,
        TokenType.IDENT,
        TokenType.COLON,
        TokenType.LBRACE,
        TokenType.IDENT,
        TokenType.QUESTION,
        TokenType.COLON,
        TokenType.STRING_TYPE,
        TokenType.RBRACE,
        TokenType.EOF,
      ]);
    });

    it("should tokenize a list with ellipsis", () => {
      const input = "[1, 2, ...]";
      const types = tokenTypes(input);
      expect(types).toEqual([
        TokenType.LBRACKET,
        TokenType.NUMBER,
        TokenType.COMMA,
        TokenType.NUMBER,
        TokenType.COMMA,
        TokenType.ELLIPSIS,
        TokenType.RBRACKET,
        TokenType.EOF,
      ]);
    });
  });

  describe("unicode escapes", () => {
    it("should tokenize \\u0041 as 'A'", () => {
      const tokens = tokenize('"hello \\u0041"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("hello A");
    });

    it("should tokenize \\U0001F600 as emoji", () => {
      const tokens = tokenize('"\\U0001F600"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("\u{1F600}");
    });

    it("should throw on incomplete \\u escape", () => {
      expect(() => tokenize('"\\u00"')).toThrow(/Invalid unicode escape/);
    });

    it("should throw on incomplete \\U escape", () => {
      expect(() => tokenize('"\\U0001"')).toThrow(/Invalid unicode escape/);
    });
  });

  describe("additional escape characters", () => {
    it("should tokenize \\a as bell character", () => {
      const tokens = tokenize('"\\a"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("\x07");
    });

    it("should tokenize \\b as backspace", () => {
      const tokens = tokenize('"\\b"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("\x08");
    });

    it("should tokenize \\f as form feed", () => {
      const tokens = tokenize('"\\f"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("\x0C");
    });

    it("should tokenize \\v as vertical tab", () => {
      const tokens = tokenize('"\\v"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("\x0B");
    });

    it("should tokenize \\/ as solidus", () => {
      const tokens = tokenize('"\\/"');
      expect(tokens[0]!.type).toBe(TokenType.STRING);
      expect(tokens[0]!.value).toBe("/");
    });
  });

  describe("error cases", () => {
    it("should throw on invalid character", () => {
      expect(() => tokenize("@")).toThrow(/Unexpected character '@'/);
    });

    it("should include line and column in error", () => {
      expect(() => tokenize("foo\n  @")).toThrow(/line 2, column 3/);
    });
  });

  describe("line/column tracking", () => {
    it("should track line and column for first token", () => {
      const tokens = tokenize("foo");
      expect(tokens[0]!.line).toBe(1);
      expect(tokens[0]!.column).toBe(1);
    });

    it("should track column after spaces", () => {
      const tokens = tokenize("  foo");
      expect(tokens[0]!.line).toBe(1);
      expect(tokens[0]!.column).toBe(3);
    });

    it("should track line after newlines", () => {
      const tokens = tokenize("foo\nbar\nbaz");
      expect(tokens[0]!.line).toBe(1);
      expect(tokens[0]!.column).toBe(1);
      expect(tokens[1]!.line).toBe(2);
      expect(tokens[1]!.column).toBe(1);
      expect(tokens[2]!.line).toBe(3);
      expect(tokens[2]!.column).toBe(1);
    });

    it("should track column correctly on second line", () => {
      const tokens = tokenize("a\n  b");
      expect(tokens[1]!.line).toBe(2);
      expect(tokens[1]!.column).toBe(3);
    });
  });
});
