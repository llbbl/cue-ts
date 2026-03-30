import { deserializeTs, type DeserializeOptions } from "./deserializer.js";
import { loadWasm, getWasmModule, isWasmLoaded } from "./wasm-loader.js";

/**
 * Synchronous deserialize -- uses WASM if already loaded, otherwise TS.
 * For guaranteed WASM usage, call `initWasm()` first at app startup.
 */
export function deserialize(
	input: string,
	options?: DeserializeOptions,
): Record<string, unknown> {
	const engine = options?.engine ?? "auto";
	const strict = options?.strict ?? true;

	if (engine === "ts") {
		return deserializeTs(input, options);
	}

	if (engine === "wasm") {
		const wasm = getWasmModule();
		if (!wasm) {
			throw new Error(
				"WASM module not loaded. Call initWasm() first or use engine: 'auto'",
			);
		}
		return wasm.deserialize(input, strict);
	}

	// auto: use WASM if loaded, otherwise TS
	if (isWasmLoaded()) {
		const wasm = getWasmModule();
		if (wasm) return wasm.deserialize(input, strict);
	}

	return deserializeTs(input, options);
}

/**
 * Async version that ensures WASM is loaded first (if available).
 * Falls back to TS engine if WASM cannot be loaded.
 */
export async function deserializeAsync(
	input: string,
	options?: DeserializeOptions,
): Promise<Record<string, unknown>> {
	const engine = options?.engine ?? "auto";

	if (engine !== "ts") {
		const loaded = await loadWasm(); // Try to load WASM
		if (engine === "wasm" && !loaded) {
			throw new Error(
				"WASM module failed to load. The .wasm binary may be missing.",
			);
		}
	}

	return deserialize(input, options);
}

/**
 * Explicitly initialize WASM module.
 * Call once at app startup for best performance with the sync `deserialize()`.
 * Returns true if WASM loaded successfully, false otherwise.
 */
export async function initWasm(): Promise<boolean> {
	return loadWasm();
}
