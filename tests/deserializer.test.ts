import { describe, it, expect } from "vitest";
import { deserializeTs as deserialize } from "../src/deserializer.js";
import { CueParseError } from "../src/errors.js";

describe("deserialize", () => {
	describe("basic values", () => {
		it("should deserialize a string field", () => {
			const result = deserialize('name: "Alice"');
			expect(result).toEqual({ name: "Alice" });
		});

		it("should deserialize an integer field", () => {
			const result = deserialize("count: 42");
			expect(result).toEqual({ count: 42 });
		});

		it("should deserialize a float field", () => {
			const result = deserialize("ratio: 3.14");
			expect(result).toEqual({ ratio: 3.14 });
		});

		it("should deserialize a negative number field", () => {
			const result = deserialize("offset: -10");
			expect(result).toEqual({ offset: -10 });
		});

		it("should deserialize a boolean true field", () => {
			const result = deserialize("active: true");
			expect(result).toEqual({ active: true });
		});

		it("should deserialize a boolean false field", () => {
			const result = deserialize("active: false");
			expect(result).toEqual({ active: false });
		});

		it("should deserialize a null field", () => {
			const result = deserialize("data: null");
			expect(result).toEqual({ data: null });
		});

		it("should deserialize multiple fields", () => {
			const input = `
				name: "Alice"
				age: 30
				active: true
			`;
			const result = deserialize(input);
			expect(result).toEqual({
				name: "Alice",
				age: 30,
				active: true,
			});
		});
	});

	describe("nested structs", () => {
		it("should deserialize a simple nested struct", () => {
			const input = `
				address: {
					city: "Portland"
					state: "OR"
				}
			`;
			const result = deserialize(input);
			expect(result).toEqual({
				address: {
					city: "Portland",
					state: "OR",
				},
			});
		});

		it("should deserialize deeply nested structs", () => {
			const input = `
				a: {
					b: {
						c: {
							value: 42
						}
					}
				}
			`;
			const result = deserialize(input);
			expect(result).toEqual({
				a: { b: { c: { value: 42 } } },
			});
		});
	});

	describe("lists", () => {
		it("should deserialize a string list", () => {
			const input = 'tags: ["a", "b", "c"]';
			const result = deserialize(input);
			expect(result).toEqual({ tags: ["a", "b", "c"] });
		});

		it("should deserialize a number list", () => {
			const input = "nums: [1, 2, 3]";
			const result = deserialize(input);
			expect(result).toEqual({ nums: [1, 2, 3] });
		});

		it("should deserialize a nested list", () => {
			const input = "matrix: [[1, 2], [3, 4]]";
			const result = deserialize(input);
			expect(result).toEqual({ matrix: [[1, 2], [3, 4]] });
		});

		it("should deserialize a mixed type list", () => {
			const input = 'mixed: [1, "hello", true, null]';
			const result = deserialize(input);
			expect(result).toEqual({ mixed: [1, "hello", true, null] });
		});

		it("should deserialize an empty list", () => {
			const input = "items: []";
			const result = deserialize(input);
			expect(result).toEqual({ items: [] });
		});
	});

	describe("type-only fields are skipped", () => {
		it("should skip a type keyword field (name: string)", () => {
			const input = "name: string";
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should skip int type keyword", () => {
			const input = "age: int";
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should skip constrained type (age: int & >=0)", () => {
			const input = "age: int & >=0";
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should skip disjunction enum (role: \"admin\" | \"user\")", () => {
			const input = 'role: "admin" | "user"';
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should skip definition (#Person: {...})", () => {
			const input = `
				#Person: {
					name: string
					age: int
				}
			`;
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should skip bool type keyword", () => {
			const input = "active: bool";
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should skip float type keyword", () => {
			const input = "ratio: float";
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should skip number type keyword", () => {
			const input = "val: number";
			const result = deserialize(input);
			expect(result).toEqual({});
		});
	});

	describe("mixed concrete and type fields", () => {
		it("should keep concrete fields and skip type fields", () => {
			const input = `
				name: "Alice"
				email: string
				age: 30
				score: float
			`;
			const result = deserialize(input);
			expect(result).toEqual({
				name: "Alice",
				age: 30,
			});
		});

		it("should handle real-world config with definitions and data", () => {
			const input = `
				#Config: {
					host: string
					port: int
				}
				server: {
					host: "localhost"
					port: 8080
				}
				debug: false
			`;
			const result = deserialize(input);
			expect(result).toEqual({
				server: {
					host: "localhost",
					port: 8080,
				},
				debug: false,
			});
		});
	});

	describe("strict mode validation", () => {
		it("should validate value against type constraint with &", () => {
			// value & type -- concrete value unified with a type
			const input = 'name: "Alice" & string';
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ name: "Alice" });
		});

		it("should throw on type mismatch in strict mode", () => {
			// This is unusual in CUE but tests the validation path:
			// a number unified with string type
			const input = "name: 42 & string";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should validate number constraint >=", () => {
			const input = "age: 25 & >=0";
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ age: 25 });
		});

		it("should throw on failed >= constraint", () => {
			const input = "age: -5 & >=0";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should validate number constraint <=", () => {
			const input = "val: 50 & <=100";
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ val: 50 });
		});

		it("should throw on failed <= constraint", () => {
			const input = "val: 150 & <=100";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should validate number constraint >", () => {
			const input = "val: 10 & >0";
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ val: 10 });
		});

		it("should validate number constraint <", () => {
			const input = "val: 5 & <10";
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ val: 5 });
		});

		it("should validate regex match constraint =~", () => {
			const input = 'email: "test@example.com" & =~"@"';
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ email: "test@example.com" });
		});

		it("should throw on failed regex match constraint", () => {
			const input = 'email: "invalid" & =~"@"';
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should validate regex not-match constraint !~", () => {
			const input = 'name: "Alice" & !~"^[0-9]"';
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ name: "Alice" });
		});

		it("should throw on failed regex not-match constraint", () => {
			const input = 'name: "123abc" & !~"^[0-9]"';
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should validate disjunction membership", () => {
			const input = 'role: "admin" & ("admin" | "user")';
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ role: "admin" });
		});

		it("should throw on disjunction membership failure", () => {
			const input = 'role: "guest" & ("admin" | "user")';
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should default to strict: true", () => {
			const input = "val: -5 & >=0";
			expect(() => deserialize(input)).toThrow(CueParseError);
		});
	});

	describe("strict: false", () => {
		it("should skip all validation", () => {
			// Would fail strict validation but should pass with strict: false
			const input = "age: -5 & >=0";
			const result = deserialize(input, { strict: false });
			expect(result).toEqual({ age: -5 });
		});

		it("should skip type validation", () => {
			const input = "name: 42 & string";
			const result = deserialize(input, { strict: false });
			expect(result).toEqual({ name: 42 });
		});

		it("should still extract values correctly", () => {
			const input = `
				name: "Alice"
				age: 30
				tags: ["a", "b"]
			`;
			const result = deserialize(input, { strict: false });
			expect(result).toEqual({
				name: "Alice",
				age: 30,
				tags: ["a", "b"],
			});
		});

		it("should still skip type-only fields", () => {
			const input = `
				name: string
				age: int
				value: "hello"
			`;
			const result = deserialize(input, { strict: false });
			expect(result).toEqual({ value: "hello" });
		});
	});

	describe("edge cases", () => {
		it("should return empty object for empty input", () => {
			const result = deserialize("");
			expect(result).toEqual({});
		});

		it("should return empty object for whitespace only", () => {
			const result = deserialize("   \n\t\n   ");
			expect(result).toEqual({});
		});

		it("should return empty object for comments only", () => {
			const input = `
				// this is a comment
				// another comment
			`;
			const result = deserialize(input);
			expect(result).toEqual({});
		});

		it("should handle quoted field labels", () => {
			const input = '"my-field": "value"';
			const result = deserialize(input);
			expect(result).toEqual({ "my-field": "value" });
		});

		it("should treat identifier as value (best effort string)", () => {
			const input = "kind: someVar";
			const result = deserialize(input);
			expect(result).toEqual({ kind: "someVar" });
		});

		it("should handle optional field markers", () => {
			const input = 'name?: "Alice"';
			const result = deserialize(input);
			expect(result).toEqual({ name: "Alice" });
		});

		it("should handle trailing commas in structs", () => {
			const input = `
				a: 1,
				b: 2,
			`;
			const result = deserialize(input);
			expect(result).toEqual({ a: 1, b: 2 });
		});

		it("should handle trailing commas in lists", () => {
			const input = "items: [1, 2, 3,]";
			const result = deserialize(input);
			expect(result).toEqual({ items: [1, 2, 3] });
		});
	});

	describe("real-world CUE config", () => {
		it("should parse a realistic config with definitions, types, and values", () => {
			const input = `
				// Schema definitions
				#Database: {
					host: string
					port: int & >=1 & <=65535
					name: string
				}

				#Server: {
					listen: string
					debug: bool
				}

				// Concrete configuration
				database: {
					host: "db.example.com"
					port: 5432
					name: "myapp"
				}

				server: {
					listen: ":8080"
					debug: false
				}

				version: "1.0.0"
				replicas: 3
				tags: ["production", "us-east"]
			`;

			const result = deserialize(input);
			expect(result).toEqual({
				database: {
					host: "db.example.com",
					port: 5432,
					name: "myapp",
				},
				server: {
					listen: ":8080",
					debug: false,
				},
				version: "1.0.0",
				replicas: 3,
				tags: ["production", "us-east"],
			});
		});

		it("should handle a config mixing types and values in same struct", () => {
			const input = `
				app: {
					name: "myapp"
					version: string
					port: 3000
					host: string
				}
			`;
			const result = deserialize(input);
			expect(result).toEqual({
				app: {
					name: "myapp",
					port: 3000,
				},
			});
		});
	});

	describe("code review fixes", () => {
		it("should throw CueParseError on invalid regex pattern (ReDoS / malformed)", () => {
			const input = 'email: "test@example.com" & =~"[invalid"';
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
			expect(() => deserialize(input, { strict: true })).toThrow(
				/invalid regex pattern/,
			);
		});

		it("should throw CueParseError on invalid regex pattern with !~ operator", () => {
			const input = 'name: "Alice" & !~"[bad"';
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
			expect(() => deserialize(input, { strict: true })).toThrow(
				/invalid regex pattern/,
			);
		});

		it("should accept boundary value: >=0 accepts 0", () => {
			const input = "val: 0 & >=0";
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ val: 0 });
		});

		it("should reject boundary value: <10 rejects 10", () => {
			const input = "val: 10 & <10";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should accept boundary value: <=100 accepts 100", () => {
			const input = "val: 100 & <=100";
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ val: 100 });
		});

		it("should reject boundary value: >0 rejects 0", () => {
			const input = "val: 0 & >0";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should validate multiple constraints together", () => {
			// score passes >=0 but fails <=100
			const input = "score: 150 & int & >=0 & <=100";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
		});

		it("should pass multiple constraints when value is in range", () => {
			const input = "score: 50 & int & >=0 & <=100";
			const result = deserialize(input, { strict: true });
			expect(result).toEqual({ score: 50 });
		});

		it("should throw on invalid constraint operand (boolean literal)", () => {
			// Construct a CUE expression where a boolean is used as a constraint operand
			// >=true is nonsensical but tests the operand validation path
			const input = "val: 5 & >=true";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
			expect(() => deserialize(input, { strict: true })).toThrow(
				/Invalid constraint operand/,
			);
		});

		it("should throw on invalid constraint operand (null literal)", () => {
			const input = "val: 5 & >=null";
			expect(() => deserialize(input, { strict: true })).toThrow(CueParseError);
			expect(() => deserialize(input, { strict: true })).toThrow(
				/Invalid constraint operand/,
			);
		});
	});
});
