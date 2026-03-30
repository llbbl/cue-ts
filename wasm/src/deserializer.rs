use crate::error::CueError;
use crate::tokens::{Token, TokenType};
use regex_lite::Regex;
use serde_json::Value;

/// Sentinel for type-only expressions (no concrete data).
const TYPE_ONLY_TAG: &str = "__type_only__";

fn is_type_only(v: &Value) -> bool {
    matches!(v, Value::String(s) if s == TYPE_ONLY_TAG)
}

fn type_only() -> Value {
    Value::String(TYPE_ONLY_TAG.to_string())
}

/// Schema information collected during deserialization for strict-mode validation.
#[derive(Debug, Clone, Default)]
struct FieldSchema {
    type_name: Option<String>,
    constraints: Vec<Constraint>,
    disjunction_values: Option<Vec<Value>>,
}

#[derive(Debug, Clone)]
struct Constraint {
    operator: String,
    operand: Value,
}

/// Internal expression representation before resolution.
#[derive(Debug, Clone)]
enum ExprNode {
    Literal {
        value: Value,
    },
    Ident {
        name: String,
    },
    TypeKeyword {
        name: String,
    },
    ConstraintExpr {
        operator: String,
        operand: Box<ExprNode>,
    },
    Disjunction {
        elements: Vec<ExprNode>,
    },
    Unification {
        left: Box<ExprNode>,
        right: Box<ExprNode>,
    },
}

struct ResolveResult {
    value: Value,
    schema: Option<FieldSchema>,
}

pub struct Deserializer {
    tokens: Vec<Token>,
    pos: usize,
    strict: bool,
}

impl Deserializer {
    pub fn new(tokens: Vec<Token>, strict: bool) -> Self {
        Self {
            tokens,
            pos: 0,
            strict,
        }
    }

    pub fn deserialize(&mut self) -> Result<Value, CueError> {
        let obj = self.deserialize_declarations(&TokenType::Eof)?;
        Ok(obj)
    }

    // ── Token helpers ──────────────────────────────────────────────────

    fn peek(&self) -> Result<&Token, CueError> {
        self.tokens.get(self.pos).ok_or_else(|| {
            CueError::new("Unexpected end of token stream", 0, 0)
        })
    }

    fn advance(&mut self) -> Result<&Token, CueError> {
        let token = self.tokens.get(self.pos).ok_or_else(|| {
            CueError::new("Unexpected end of token stream", 0, 0)
        })?;
        self.pos += 1;
        Ok(token)
    }

    /// Advance and take ownership of the token, avoiding a clone.
    fn advance_owned(&mut self) -> Result<Token, CueError> {
        if self.pos >= self.tokens.len() {
            return Err(CueError::new("Unexpected end of token stream", 0, 0));
        }
        let mut token = Token::new(TokenType::Eof, "", 0, 0);
        std::mem::swap(&mut token, &mut self.tokens[self.pos]);
        self.pos += 1;
        Ok(token)
    }

    fn expect(&mut self, expected: &TokenType) -> Result<Token, CueError> {
        let token = self.peek()?;
        if &token.token_type != expected {
            let line = token.line;
            let col = token.column;
            return Err(CueError::new(
                format!("Expected {:?} but got {:?}", expected, token.token_type),
                line,
                col,
            ));
        }
        let t = self.advance_owned()?;
        Ok(t)
    }

    fn skip_comments(&mut self) -> Result<(), CueError> {
        while self.peek()?.token_type == TokenType::Comment {
            self.advance()?;
        }
        Ok(())
    }

    fn skip_separators(&mut self) -> Result<(), CueError> {
        while self.peek()?.token_type == TokenType::Comma {
            self.advance()?;
        }
        Ok(())
    }

    // ── Declarations ───────────────────────────────────────────────────

    fn deserialize_declarations(
        &mut self,
        closing_token: &TokenType,
    ) -> Result<Value, CueError> {
        let mut map = serde_json::Map::new();

        while self.peek()?.token_type != *closing_token {
            self.skip_comments()?;
            if self.peek()?.token_type == *closing_token {
                break;
            }

            let peek_type = self.peek()?.token_type.clone();

            if peek_type == TokenType::Hash {
                // Definition: #IDENT: value -- skip
                self.parse_definition()?;
            } else if peek_type == TokenType::Ident || peek_type == TokenType::String {
                let label = self.advance_owned()?.value;

                // Skip optional marker
                if self.peek()?.token_type == TokenType::Question {
                    self.advance()?;
                }

                self.expect(&TokenType::Colon)?;

                let result = self.deserialize_value_with_schema()?;

                if !is_type_only(&result.value) {
                    if self.strict {
                        if let Some(ref schema) = result.schema {
                            self.validate(&result.value, schema, &label)?;
                        }
                    }
                    map.insert(label, result.value);
                }
            } else if peek_type == TokenType::Ellipsis {
                // Skip ellipsis in structs
                self.advance()?;
                // May be followed by a type
                let next = self.peek()?.token_type.clone();
                if next != TokenType::Comma
                    && next != TokenType::RBrace
                    && next != TokenType::Eof
                {
                    self.deserialize_value()?;
                }
            } else {
                let token = self.peek()?;
                let line = token.line;
                let col = token.column;
                let tt = format!("{:?}", token.token_type);
                return Err(CueError::new(
                    format!("Expected field or definition but got {}", tt),
                    line,
                    col,
                ));
            }

            self.skip_separators()?;
        }

        Ok(Value::Object(map))
    }

    fn parse_definition(&mut self) -> Result<(), CueError> {
        self.expect(&TokenType::Hash)?;
        self.expect(&TokenType::Ident)?;
        self.expect(&TokenType::Colon)?;
        // Consume the value but discard it
        self.deserialize_value()?;
        Ok(())
    }

    // ── Value parsing ──────────────────────────────────────────────────

    fn deserialize_value_with_schema(&mut self) -> Result<ResolveResult, CueError> {
        let expr = self.parse_expression()?;
        self.resolve_expression(&expr)
    }

    fn parse_expression(&mut self) -> Result<ExprNode, CueError> {
        let first = self.parse_unification_expr()?;

        // Check for | (disjunction)
        if self.peek()?.token_type == TokenType::Pipe {
            let mut elements = vec![first];
            while self.peek()?.token_type == TokenType::Pipe {
                self.advance()?;
                elements.push(self.parse_unification_expr()?);
            }
            return Ok(ExprNode::Disjunction { elements });
        }

        Ok(first)
    }

    fn parse_unification_expr(&mut self) -> Result<ExprNode, CueError> {
        let mut left = self.parse_constraint_or_primary()?;

        while self.peek()?.token_type == TokenType::Amp {
            self.advance()?;
            let right = self.parse_constraint_or_primary()?;
            left = ExprNode::Unification {
                left: Box::new(left),
                right: Box::new(right),
            };
        }

        Ok(left)
    }

    fn parse_constraint_or_primary(&mut self) -> Result<ExprNode, CueError> {
        let tt = self.peek()?.token_type.clone();
        match tt {
            TokenType::Gte
            | TokenType::Lte
            | TokenType::Gt
            | TokenType::Lt
            | TokenType::Match
            | TokenType::NotMatch => {
                let op = self.advance_owned()?.value;
                let operand = self.parse_primary_expr()?;
                Ok(ExprNode::ConstraintExpr {
                    operator: op,
                    operand: Box::new(operand),
                })
            }
            _ => self.parse_primary_expr(),
        }
    }

    fn parse_primary_expr(&mut self) -> Result<ExprNode, CueError> {
        let tt = self.peek()?.token_type.clone();

        match tt {
            TokenType::String => {
                let t = self.advance_owned()?;
                Ok(ExprNode::Literal {
                    value: Value::String(t.value),
                })
            }
            TokenType::Number => {
                let t = self.advance_owned()?;
                let num_value = if t.value.contains('.') {
                    let num: f64 = t.value.parse().map_err(|_| {
                        CueError::new(format!("Invalid number: {}", t.value), t.line, t.column)
                    })?;
                    let serde_num = serde_json::Number::from_f64(num).ok_or_else(|| {
                        CueError::new("Invalid number (NaN/Infinity)", t.line, t.column)
                    })?;
                    Value::Number(serde_num)
                } else {
                    let num: i64 = t.value.parse().map_err(|_| {
                        CueError::new(format!("Invalid number: {}", t.value), t.line, t.column)
                    })?;
                    Value::Number(serde_json::Number::from(num))
                };
                Ok(ExprNode::Literal {
                    value: num_value,
                })
            }
            TokenType::True => {
                self.advance()?;
                Ok(ExprNode::Literal {
                    value: Value::Bool(true),
                })
            }
            TokenType::False => {
                self.advance()?;
                Ok(ExprNode::Literal {
                    value: Value::Bool(false),
                })
            }
            TokenType::Null => {
                self.advance()?;
                Ok(ExprNode::Literal {
                    value: Value::Null,
                })
            }
            TokenType::LBrace => {
                self.expect(&TokenType::LBrace)?;
                let obj = self.deserialize_declarations(&TokenType::RBrace)?;
                self.expect(&TokenType::RBrace)?;
                Ok(ExprNode::Literal {
                    value: obj,
                })
            }
            TokenType::LBracket => {
                let arr = self.deserialize_list()?;
                Ok(ExprNode::Literal {
                    value: Value::Array(arr),
                })
            }
            TokenType::Ident => {
                let t = self.advance_owned()?;
                Ok(ExprNode::Ident { name: t.value })
            }
            TokenType::Underscore => {
                self.advance()?;
                Ok(ExprNode::TypeKeyword {
                    name: "top".to_string(),
                })
            }
            TokenType::Bottom => {
                self.advance()?;
                Ok(ExprNode::TypeKeyword {
                    name: "bottom".to_string(),
                })
            }
            TokenType::LParen => {
                self.advance()?; // consume (
                let inner = self.parse_expression()?;
                self.expect(&TokenType::RParen)?;
                Ok(inner)
            }
            TokenType::Hash => {
                // #Reference (type reference like #Address, #User) -- treat as type-only
                self.advance()?; // consume #
                if self.peek()?.token_type == TokenType::Ident {
                    self.advance()?; // consume the reference name
                }
                Ok(ExprNode::TypeKeyword {
                    name: "definition_ref".to_string(),
                })
            }
            TokenType::StringType
            | TokenType::IntType
            | TokenType::FloatType
            | TokenType::BoolType
            | TokenType::NumberType
            | TokenType::BytesType => {
                let t = self.advance_owned()?;
                Ok(ExprNode::TypeKeyword { name: t.value })
            }
            _ => {
                let token = self.peek()?;
                let line = token.line;
                let col = token.column;
                let tt_str = format!("{:?}", token.token_type);
                Err(CueError::new(
                    format!("Unexpected token {}", tt_str),
                    line,
                    col,
                ))
            }
        }
    }

    fn deserialize_list(&mut self) -> Result<Vec<Value>, CueError> {
        self.expect(&TokenType::LBracket)?;
        let mut elements = Vec::new();

        self.skip_comments()?;

        if self.peek()?.token_type == TokenType::RBracket {
            self.advance()?;
            return Ok(elements);
        }

        // Check for typed list: [...type] -- skip
        if self.peek()?.token_type == TokenType::Ellipsis {
            self.advance()?;
            self.deserialize_value()?; // consume the type
            self.skip_comments()?;
            self.expect(&TokenType::RBracket)?;
            return Ok(elements);
        }

        let val = self.deserialize_value()?;
        if !is_type_only(&val) {
            elements.push(val);
        }

        while self.peek()?.token_type == TokenType::Comma {
            self.advance()?;
            self.skip_comments()?;
            if self.peek()?.token_type == TokenType::RBracket {
                break;
            }
            let v = self.deserialize_value()?;
            if !is_type_only(&v) {
                elements.push(v);
            }
        }

        self.skip_comments()?;
        self.expect(&TokenType::RBracket)?;
        Ok(elements)
    }

    /// Simple value parse (used for definitions and contexts where we don't need schema).
    fn deserialize_value(&mut self) -> Result<Value, CueError> {
        let expr = self.parse_expression()?;
        let result = self.resolve_expression(&expr)?;
        Ok(result.value)
    }

    // ── Expression resolution ──────────────────────────────────────────

    fn resolve_expression(&self, expr: &ExprNode) -> Result<ResolveResult, CueError> {
        match expr {
            ExprNode::Literal { value } => Ok(ResolveResult {
                value: value.clone(),
                schema: None,
            }),
            ExprNode::Ident { name } => Ok(ResolveResult {
                value: Value::String(name.clone()),
                schema: None,
            }),
            ExprNode::TypeKeyword { name } => Ok(ResolveResult {
                value: type_only(),
                schema: Some(FieldSchema {
                    type_name: Some(name.clone()),
                    ..Default::default()
                }),
            }),
            ExprNode::ConstraintExpr { operator, operand } => {
                let operand_value = self.resolve_constraint_operand(operand)?;
                Ok(ResolveResult {
                    value: type_only(),
                    schema: Some(FieldSchema {
                        constraints: vec![Constraint {
                            operator: operator.clone(),
                            operand: operand_value,
                        }],
                        ..Default::default()
                    }),
                })
            }
            ExprNode::Disjunction { elements } => self.resolve_disjunction(elements),
            ExprNode::Unification { left, right } => self.resolve_unification(left, right),
        }
    }

    fn resolve_constraint_operand(&self, expr: &ExprNode) -> Result<Value, CueError> {
        match expr {
            ExprNode::Literal { value } => match value {
                Value::Number(_) | Value::String(_) => Ok(value.clone()),
                _ => Err(CueError::new(
                    format!(
                        "Invalid constraint operand: expected number or string, got {:?}",
                        value
                    ),
                    0,
                    0,
                )),
            },
            _ => Err(CueError::new(
                format!(
                    "Invalid constraint operand: expected a literal value, got {:?}",
                    expr
                ),
                0,
                0,
            )),
        }
    }

    fn resolve_disjunction(&self, elements: &[ExprNode]) -> Result<ResolveResult, CueError> {
        // Check if all elements are literals -- this is an enum pattern
        let all_literals = elements.iter().all(|e| matches!(e, ExprNode::Literal { .. }));

        if all_literals {
            let vals: Vec<Value> = elements
                .iter()
                .map(|e| match e {
                    ExprNode::Literal { value } => value.clone(),
                    _ => Value::Null,
                })
                .collect();
            return Ok(ResolveResult {
                value: type_only(),
                schema: Some(FieldSchema {
                    disjunction_values: Some(vals),
                    ..Default::default()
                }),
            });
        }

        // Mixed: try to find a concrete value among the elements
        let mut concrete_value = type_only();
        let mut disj_vals: Vec<Value> = Vec::new();

        for el in elements {
            let resolved = self.resolve_expression(el)?;
            if !is_type_only(&resolved.value) && is_type_only(&concrete_value) {
                concrete_value = resolved.value;
            }
            if let ExprNode::Literal { value } = el {
                disj_vals.push(value.clone());
            }
        }

        Ok(ResolveResult {
            value: concrete_value,
            schema: if !disj_vals.is_empty() {
                Some(FieldSchema {
                    disjunction_values: Some(disj_vals),
                    ..Default::default()
                })
            } else {
                None
            },
        })
    }

    fn resolve_unification(
        &self,
        left: &ExprNode,
        right: &ExprNode,
    ) -> Result<ResolveResult, CueError> {
        let l_res = self.resolve_expression(left)?;
        let r_res = self.resolve_expression(right)?;

        let schema = merge_schemas(l_res.schema, r_res.schema);

        if !is_type_only(&l_res.value) && is_type_only(&r_res.value) {
            return Ok(ResolveResult {
                value: l_res.value,
                schema,
            });
        }
        if !is_type_only(&r_res.value) && is_type_only(&l_res.value) {
            return Ok(ResolveResult {
                value: r_res.value,
                schema,
            });
        }
        // Both concrete -- prefer left
        if !is_type_only(&l_res.value) {
            return Ok(ResolveResult {
                value: l_res.value,
                schema,
            });
        }
        // Both type-only
        Ok(ResolveResult {
            value: type_only(),
            schema,
        })
    }

    // ── Validation ─────────────────────────────────────────────────────

    fn validate(
        &self,
        value: &Value,
        schema: &FieldSchema,
        label: &str,
    ) -> Result<(), CueError> {
        if is_type_only(value) {
            return Ok(());
        }

        if let Some(ref type_name) = schema.type_name {
            self.validate_type(value, type_name, label)?;
        }

        for c in &schema.constraints {
            self.validate_constraint(value, &c.operator, &c.operand, label)?;
        }

        if let Some(ref disj) = schema.disjunction_values {
            self.validate_disjunction(value, disj, label)?;
        }

        Ok(())
    }

    fn validate_type(
        &self,
        value: &Value,
        type_name: &str,
        label: &str,
    ) -> Result<(), CueError> {
        match type_name {
            "string" => {
                if !value.is_string() {
                    return Err(CueError::new(
                        format!(
                            "Field \"{}\": expected string, got {}",
                            label,
                            value_type_name(value)
                        ),
                        0,
                        0,
                    ));
                }
            }
            "int" => {
                if let Some(n) = value.as_f64() {
                    if n.fract() != 0.0 {
                        return Err(CueError::new(
                            format!("Field \"{}\": expected int, got float", label),
                            0,
                            0,
                        ));
                    }
                } else {
                    return Err(CueError::new(
                        format!(
                            "Field \"{}\": expected int, got {}",
                            label,
                            value_type_name(value)
                        ),
                        0,
                        0,
                    ));
                }
            }
            "float" | "number" => {
                if !value.is_number() {
                    return Err(CueError::new(
                        format!(
                            "Field \"{}\": expected {}, got {}",
                            label,
                            type_name,
                            value_type_name(value)
                        ),
                        0,
                        0,
                    ));
                }
            }
            "bool" => {
                if !value.is_boolean() {
                    return Err(CueError::new(
                        format!(
                            "Field \"{}\": expected bool, got {}",
                            label,
                            value_type_name(value)
                        ),
                        0,
                        0,
                    ));
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn validate_constraint(
        &self,
        value: &Value,
        operator: &str,
        operand: &Value,
        label: &str,
    ) -> Result<(), CueError> {
        // Numeric constraints
        if let (Some(val), Some(op)) = (value.as_f64(), operand.as_f64()) {
            let valid = match operator {
                ">=" => val >= op,
                "<=" => val <= op,
                ">" => val > op,
                "<" => val < op,
                _ => return Ok(()),
            };
            if !valid {
                return Err(CueError::new(
                    format!(
                        "Field \"{}\": value {} does not satisfy constraint {} {}",
                        label, val, operator, op
                    ),
                    0,
                    0,
                ));
            }
        }

        // Regex constraints
        if let (Some(val_str), Some(pattern)) = (value.as_str(), operand.as_str()) {
            if operator == "=~" || operator == "!~" {
                let re = Regex::new(pattern).map_err(|_| {
                    CueError::new(
                        format!("Field \"{}\": invalid regex pattern: {}", label, pattern),
                        0,
                        0,
                    )
                })?;
                if operator == "=~" {
                    if !re.is_match(val_str) {
                        return Err(CueError::new(
                            format!(
                                "Field \"{}\": value \"{}\" does not match pattern {}",
                                label, val_str, pattern
                            ),
                            0,
                            0,
                        ));
                    }
                } else if re.is_match(val_str) {
                    return Err(CueError::new(
                        format!(
                            "Field \"{}\": value \"{}\" must not match pattern {}",
                            label, val_str, pattern
                        ),
                        0,
                        0,
                    ));
                }
            }
        }

        Ok(())
    }

    fn validate_disjunction(
        &self,
        value: &Value,
        allowed: &[Value],
        label: &str,
    ) -> Result<(), CueError> {
        if !allowed.iter().any(|v| v == value) {
            return Err(CueError::new(
                format!(
                    "Field \"{}\": value {} is not one of the allowed values: {}",
                    label,
                    serde_json::to_string(value).unwrap_or_default(),
                    serde_json::to_string(allowed).unwrap_or_default()
                ),
                0,
                0,
            ));
        }
        Ok(())
    }
}

fn merge_schemas(a: Option<FieldSchema>, b: Option<FieldSchema>) -> Option<FieldSchema> {
    match (a, b) {
        (None, None) => None,
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (Some(a), Some(b)) => {
            let mut constraints = a.constraints;
            constraints.extend(b.constraints);
            Some(FieldSchema {
                type_name: a.type_name.or(b.type_name),
                constraints,
                disjunction_values: a.disjunction_values.or(b.disjunction_values),
            })
        }
    }
}

fn value_type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::Lexer;

    fn deser(input: &str) -> Value {
        deser_strict(input, true)
    }

    fn deser_strict(input: &str, strict: bool) -> Value {
        let mut lexer = Lexer::new(input);
        let tokens = lexer.tokenize().unwrap();
        let mut d = Deserializer::new(tokens, strict);
        d.deserialize().unwrap()
    }

    fn deser_err(input: &str) -> CueError {
        let mut lexer = Lexer::new(input);
        let tokens = lexer.tokenize().unwrap();
        let mut d = Deserializer::new(tokens, true);
        d.deserialize().unwrap_err()
    }

    #[test]
    fn test_basic_string_field() {
        let result = deser(r#"name: "Alice""#);
        assert_eq!(result["name"], "Alice");
    }

    #[test]
    fn test_basic_number_field() {
        let result = deser("age: 30");
        assert_eq!(result["age"], 30);
    }

    #[test]
    fn test_basic_float_field() {
        let result = deser("score: 3.14");
        assert_eq!(result["score"], 3.14);
    }

    #[test]
    fn test_basic_bool_fields() {
        let result = deser("active: true, disabled: false");
        assert_eq!(result["active"], true);
        assert_eq!(result["disabled"], false);
    }

    #[test]
    fn test_basic_null_field() {
        let result = deser("value: null");
        assert_eq!(result["value"], Value::Null);
    }

    #[test]
    fn test_nested_struct() {
        let result = deser(r#"server: { host: "localhost", port: 8080 }"#);
        assert_eq!(result["server"]["host"], "localhost");
        assert_eq!(result["server"]["port"], 8080);
    }

    #[test]
    fn test_simple_list() {
        let result = deser(r#"tags: ["a", "b", "c"]"#);
        let arr = result["tags"].as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0], "a");
        assert_eq!(arr[1], "b");
        assert_eq!(arr[2], "c");
    }

    #[test]
    fn test_empty_list() {
        let result = deser("items: []");
        let arr = result["items"].as_array().unwrap();
        assert!(arr.is_empty());
    }

    #[test]
    fn test_nested_list() {
        let result = deser("matrix: [[1, 2], [3, 4]]");
        let arr = result["matrix"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0].as_array().unwrap()[0], 1);
    }

    #[test]
    fn test_type_only_fields_skipped() {
        let result = deser("name: string, age: int");
        assert!(result.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_mixed_concrete_and_type() {
        let result = deser(r#"name: "Alice", age: int"#);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.len(), 1);
        assert_eq!(obj["name"], "Alice");
    }

    #[test]
    fn test_unification_concrete_with_type() {
        let result = deser(r#"name: "Alice" & string"#);
        assert_eq!(result["name"], "Alice");
    }

    #[test]
    fn test_unification_type_with_concrete() {
        let result = deser("age: int & 25");
        assert_eq!(result["age"], 25);
    }

    #[test]
    fn test_disjunction_all_literals_skipped() {
        let result = deser(r#"status: "active" | "inactive""#);
        assert!(result.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_strict_type_mismatch() {
        let err = deser_err(r#"age: "hello" & int"#);
        assert!(err.message.contains("expected int"));
    }

    #[test]
    fn test_strict_constraint_violation() {
        let err = deser_err("age: 5 & int & >=18");
        assert!(err.message.contains("does not satisfy constraint"));
    }

    #[test]
    fn test_strict_disjunction_rejection() {
        let err = deser_err(r#"status: "unknown" & ("active" | "inactive")"#);
        assert!(err.message.contains("not one of the allowed values"));
    }

    #[test]
    fn test_non_strict_skips_validation() {
        let result = deser_strict(r#"age: "hello" & int"#, false);
        assert_eq!(result["age"], "hello");
    }

    #[test]
    fn test_empty_input() {
        let result = deser("");
        assert!(result.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_comments_ignored() {
        let result = deser(
            r#"// This is a comment
name: "Alice"
// Another comment
age: 30"#,
        );
        assert_eq!(result["name"], "Alice");
        assert_eq!(result["age"], 30);
    }

    #[test]
    fn test_definition_skipped() {
        let result = deser(
            r#"#Schema: {
    name: string
}
name: "Alice""#,
        );
        let obj = result.as_object().unwrap();
        assert_eq!(obj.len(), 1);
        assert_eq!(obj["name"], "Alice");
    }

    #[test]
    fn test_optional_field_marker() {
        let result = deser(r#"name?: "Alice""#);
        assert_eq!(result["name"], "Alice");
    }

    #[test]
    fn test_ident_as_value() {
        let result = deser("env: production");
        assert_eq!(result["env"], "production");
    }

    #[test]
    fn test_real_world_config() {
        let input = r#"
// Server configuration
server: {
    host: "0.0.0.0"
    port: 8080
    debug: false
}

database: {
    url: "postgres://localhost/mydb"
    maxConns: 10 & int & >=1
    timeout: 30
}

tags: ["web", "api", "v2"]
"#;
        let result = deser(input);
        assert_eq!(result["server"]["host"], "0.0.0.0");
        assert_eq!(result["server"]["port"], 8080);
        assert_eq!(result["server"]["debug"], false);
        assert_eq!(result["database"]["url"], "postgres://localhost/mydb");
        assert_eq!(result["database"]["maxConns"], 10);
        assert_eq!(result["database"]["timeout"], 30);
        assert_eq!(result["tags"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn test_ellipsis_in_struct() {
        let result = deser(r#"name: "Alice", ..."#);
        assert_eq!(result["name"], "Alice");
    }

    #[test]
    fn test_negative_number() {
        let result = deser("temp: -10");
        assert_eq!(result["temp"], -10);
    }

    #[test]
    fn test_constraint_with_type_and_value() {
        let result = deser("age: 25 & int & >=0 & <=150");
        assert_eq!(result["age"], 25);
    }

    #[test]
    fn test_regex_match_validation() {
        // Valid match
        let result = deser(r#"email: "user@example.com" & =~"@""#);
        assert_eq!(result["email"], "user@example.com");
    }

    #[test]
    fn test_regex_match_failure() {
        let err = deser_err(r#"email: "userexample" & =~"@""#);
        assert!(err.message.contains("does not match pattern"));
    }

    #[test]
    fn test_regex_not_match_validation() {
        let result = deser(r#"name: "Alice" & !~"[0-9]""#);
        assert_eq!(result["name"], "Alice");
    }

    #[test]
    fn test_regex_not_match_failure() {
        let err = deser_err(r#"name: "Alice123" & !~"[0-9]""#);
        assert!(err.message.contains("must not match pattern"));
    }
}
