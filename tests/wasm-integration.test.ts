import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
	deserialize,
	deserializeAsync,
	initWasm,
	deserializeTs,
} from "../src/index.js";
import { _resetWasmState } from "../src/wasm-loader.js";

describe("WASM integration", () => {
	describe('engine: "ts" always works', () => {
		it("deserializes basic config", () => {
			const result = deserialize('name: "Alice"\nage: 42', {
				engine: "ts",
			});
			expect(result).toEqual({ name: "Alice", age: 42 });
		});
	});

	describe('engine: "auto" falls back to TS when WASM not loaded', () => {
		beforeEach(() => {
			_resetWasmState();
		});

		it("works without WASM initialized", () => {
			const result = deserialize('name: "Alice"', { engine: "auto" });
			expect(result).toEqual({ name: "Alice" });
		});
	});

	describe('engine: "wasm" throws if not loaded', () => {
		beforeEach(() => {
			_resetWasmState();
		});

		it("throws descriptive error", () => {
			expect(() =>
				deserialize('name: "Alice"', { engine: "wasm" }),
			).toThrow(/WASM/);
		});
	});

	describe("concurrent initWasm()", () => {
		beforeEach(() => {
			_resetWasmState();
		});

		it("concurrent initWasm() calls do not conflict", async () => {
			_resetWasmState();
			const results = await Promise.all([initWasm(), initWasm(), initWasm()]);
			expect(new Set(results).size).toBe(1);
		});
	});

	// WASM tests - these test the async path
	describe("with WASM loaded", () => {
		let wasmAvailable = false;

		beforeAll(async () => {
			try {
				wasmAvailable = await initWasm();
			} catch {
				wasmAvailable = false;
			}
		});

		it("deserializeAsync uses WASM when available", async () => {
			const result = await deserializeAsync('name: "Alice"\nage: 42');
			expect(result).toEqual({ name: "Alice", age: 42 });
		});

		// Skip WASM-specific tests if WASM module couldn't load
		it.skipIf(!wasmAvailable)(
			"WASM produces same output as TS for basic values",
			() => {
				const input = 'name: "Alice"\nage: 42\nactive: true';
				const tsResult = deserialize(input, { engine: "ts" });
				const wasmResult = deserialize(input, { engine: "wasm" });
				expect(wasmResult).toEqual(tsResult);
			},
		);

		it.skipIf(!wasmAvailable)(
			"WASM produces same output as TS for nested structs",
			() => {
				const input =
					'person: {\n  name: "Alice"\n  address: {\n    city: "Portland"\n  }\n}';
				const tsResult = deserialize(input, { engine: "ts" });
				const wasmResult = deserialize(input, { engine: "wasm" });
				expect(wasmResult).toEqual(tsResult);
			},
		);

		it.skipIf(!wasmAvailable)(
			"WASM produces same output as TS for lists",
			() => {
				const input = 'tags: ["a", "b", "c"]\nnums: [1, 2, 3]';
				const tsResult = deserialize(input, { engine: "ts" });
				const wasmResult = deserialize(input, { engine: "wasm" });
				expect(wasmResult).toEqual(tsResult);
			},
		);

		it.skipIf(!wasmAvailable)(
			"WASM skips type-only fields same as TS",
			() => {
				const input = 'name: "Alice"\nage: int\nrole: string';
				const tsResult = deserialize(input, { engine: "ts" });
				const wasmResult = deserialize(input, { engine: "wasm" });
				expect(wasmResult).toEqual(tsResult);
			},
		);
	});
});
