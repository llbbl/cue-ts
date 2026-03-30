import { describe, it, expect } from "vitest";
import { parse, CueParseError } from "../src/index.js";

describe("Error handling", () => {
  describe("CueParseError is thrown for malformed input", () => {
    it("should throw CueParseError for missing colon", () => {
      expect(() => parse('name "hello"')).toThrow(CueParseError);
    });

    it("should throw CueParseError for unexpected token in value position", () => {
      expect(() => parse("name: :")).toThrow(CueParseError);
    });

    it("should throw CueParseError for unclosed struct", () => {
      expect(() => parse("config: { name: 1")).toThrow(CueParseError);
    });

    it("should throw CueParseError for unclosed list", () => {
      expect(() => parse("items: [1, 2")).toThrow(CueParseError);
    });
  });

  describe("error has correct line and column", () => {
    it("should report line 1 for error on first line", () => {
      try {
        parse('name "hello"');
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(1);
        expect(e.column).toBeGreaterThan(0);
      }
    });

    it("should report correct line for multiline input", () => {
      try {
        parse('name: "ok"\nbad input');
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(2);
      }
    });

    it("should report correct column for indented error", () => {
      try {
        parse("config: {\n  bad :");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(2);
        expect(e.column).toBeGreaterThan(1);
      }
    });
  });

  describe("various error scenarios", () => {
    it("should throw on unterminated string", () => {
      expect(() => parse('name: "hello')).toThrow(/Unterminated string/);
    });

    it("should throw on unterminated string with newline", () => {
      expect(() => parse('name: "hello\n')).toThrow(/Unterminated string/);
    });

    it("should throw on unexpected token: bare colon as value", () => {
      expect(() => parse("x: :")).toThrow(CueParseError);
    });

    it("should throw on invalid character in input", () => {
      expect(() => parse("x: @")).toThrow(/Unexpected character/);
    });

    it("should throw on empty definition name", () => {
      expect(() => parse("#: string")).toThrow(CueParseError);
    });

    it("should include descriptive message in error", () => {
      try {
        parse('name "hello"');
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.message).toContain("Expected");
        expect(e.message).toContain("COLON");
      }
    });
  });

  describe("lexer errors produce CueParseError with line/column", () => {
    it("should throw CueParseError for unterminated string", () => {
      try {
        parse('name: "hello');
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(1);
        expect(e.column).toBe(7);
        expect(e.message).toContain("Unterminated string");
      }
    });

    it("should throw CueParseError for unterminated string at newline", () => {
      try {
        parse('name: "hello\n');
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(1);
        expect(e.column).toBe(7);
        expect(e.message).toContain("Unterminated string");
      }
    });

    it("should throw CueParseError for invalid character with correct column", () => {
      try {
        parse("x: @");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(1);
        expect(e.column).toBe(4);
        expect(e.message).toContain("Unexpected character");
      }
    });

    it("should throw CueParseError for invalid character on second line", () => {
      try {
        parse("x: 1\ny: @");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(2);
        expect(e.column).toBe(4);
        expect(e.message).toContain("Unexpected character");
      }
    });

    it("should throw CueParseError for invalid escape sequence", () => {
      try {
        parse('x: "hello\\z"');
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CueParseError);
        const e = error as CueParseError;
        expect(e.line).toBe(1);
        expect(e.message).toContain("Invalid escape sequence");
      }
    });
  });
});
