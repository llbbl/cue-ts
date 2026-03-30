mod tokens;
mod lexer;
mod error;
mod deserializer;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn deserialize(input: &str, strict: bool) -> Result<JsValue, JsError> {
    let mut lexer = lexer::Lexer::new(input);
    let tokens = lexer
        .tokenize()
        .map_err(|e| JsError::new(&format!("{} at line {}, column {}", e.message, e.line, e.column)))?;
    let mut deser = deserializer::Deserializer::new(tokens, strict);
    let value = deser
        .deserialize()
        .map_err(|e| JsError::new(&format!("{} at line {}, column {}", e.message, e.line, e.column)))?;
    serde_wasm_bindgen::to_value(&value).map_err(|e| JsError::new(&e.to_string()))
}
