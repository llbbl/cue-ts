interface WasmModule {
	default: () => Promise<void>;
	deserialize: (input: string, strict: boolean) => Record<string, unknown>;
}

let wasmModule: WasmModule | null = null;
let wasmPromise: Promise<boolean> | null = null;

export async function loadWasm(): Promise<boolean> {
	if (wasmPromise) return wasmPromise;
	wasmPromise = (async () => {
		try {
			// Try to import the WASM glue code
			const mod = await import("../wasm/pkg/cue_wasm.js");
			await mod.default(); // Initialize WASM
			wasmModule = mod;
			return true;
		} catch {
			return false;
		}
	})();
	return wasmPromise;
}

export function getWasmModule(): WasmModule | null {
	return wasmModule;
}

export function isWasmLoaded(): boolean {
	return wasmModule !== null;
}

/**
 * Reset internal state. Only use in tests.
 */
export function _resetWasmState(): void {
	wasmModule = null;
	wasmPromise = null;
}
