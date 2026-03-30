use crate::error::CueError;
use crate::tokens::{Token, TokenType};

fn lookup_keyword(s: &str) -> Option<TokenType> {
    match s {
        "null" => Some(TokenType::Null),
        "true" => Some(TokenType::True),
        "false" => Some(TokenType::False),
        "string" => Some(TokenType::StringType),
        "int" => Some(TokenType::IntType),
        "float" => Some(TokenType::FloatType),
        "bool" => Some(TokenType::BoolType),
        "number" => Some(TokenType::NumberType),
        "bytes" => Some(TokenType::BytesType),
        _ => None,
    }
}

fn lookup_escape(ch: char) -> Option<char> {
    match ch {
        'n' => Some('\n'),
        't' => Some('\t'),
        'r' => Some('\r'),
        '\\' => Some('\\'),
        '"' => Some('"'),
        'a' => Some('\x07'),
        'b' => Some('\x08'),
        'f' => Some('\x0C'),
        'v' => Some('\x0B'),
        '/' => Some('/'),
        _ => None,
    }
}

pub struct Lexer {
    input: Vec<char>,
    pos: usize,
    line: usize,
    column: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Self {
        Self {
            input: input.chars().collect(),
            pos: 0,
            line: 1,
            column: 1,
        }
    }

    pub fn tokenize(&mut self) -> Result<Vec<Token>, CueError> {
        let mut tokens = Vec::new();

        loop {
            self.skip_whitespace();
            if self.pos >= self.input.len() {
                break;
            }

            let token = self.next_token()?;
            tokens.push(token);
        }

        tokens.push(Token::new(TokenType::Eof, "", self.line, self.column));
        Ok(tokens)
    }

    fn peek(&self, offset: usize) -> char {
        self.input.get(self.pos + offset).copied().unwrap_or('\0')
    }

    fn current(&self) -> char {
        self.peek(0)
    }

    fn advance(&mut self) -> Result<char, CueError> {
        let ch = self.input.get(self.pos).copied().ok_or_else(|| {
            CueError::new("Unexpected end of input", self.line, self.column)
        })?;
        self.pos += 1;
        if ch == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }
        Ok(ch)
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() {
            let ch = self.current();
            if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
                let _ = self.advance();
            } else {
                break;
            }
        }
    }

    fn next_token(&mut self) -> Result<Token, CueError> {
        let line = self.line;
        let column = self.column;
        let ch = self.current();

        // Comments: //
        if ch == '/' && self.peek(1) == '/' {
            return self.read_comment(line, column);
        }

        // Strings
        if ch == '"' {
            return self.read_string(line, column);
        }

        // Numbers (including negative)
        if ch.is_ascii_digit() || (ch == '-' && self.peek(1).is_ascii_digit()) {
            return self.read_number(line, column);
        }

        // _|_ (bottom) — must check before underscore and identifiers
        if ch == '_' && self.peek(1) == '|' && self.peek(2) == '_' {
            self.advance()?;
            self.advance()?;
            self.advance()?;
            return Ok(Token::new(TokenType::Bottom, "_|_", line, column));
        }

        // Standalone _ (top) — not followed by identifier chars
        if ch == '_' && !is_ident_part(self.peek(1)) {
            self.advance()?;
            return Ok(Token::new(TokenType::Underscore, "_", line, column));
        }

        // Identifiers and keywords
        if is_ident_start(ch) {
            return self.read_ident_or_keyword(line, column);
        }

        // ... (ellipsis)
        if ch == '.' && self.peek(1) == '.' && self.peek(2) == '.' {
            self.advance()?;
            self.advance()?;
            self.advance()?;
            return Ok(Token::new(TokenType::Ellipsis, "...", line, column));
        }

        // Two-character operators
        let next = self.peek(1);
        match (ch, next) {
            ('>', '=') => {
                self.advance()?;
                self.advance()?;
                return Ok(Token::new(TokenType::Gte, ">=", line, column));
            }
            ('<', '=') => {
                self.advance()?;
                self.advance()?;
                return Ok(Token::new(TokenType::Lte, "<=", line, column));
            }
            ('=', '=') => {
                self.advance()?;
                self.advance()?;
                return Ok(Token::new(TokenType::Eq, "==", line, column));
            }
            ('!', '=') => {
                self.advance()?;
                self.advance()?;
                return Ok(Token::new(TokenType::Neq, "!=", line, column));
            }
            ('=', '~') => {
                self.advance()?;
                self.advance()?;
                return Ok(Token::new(TokenType::Match, "=~", line, column));
            }
            ('!', '~') => {
                self.advance()?;
                self.advance()?;
                return Ok(Token::new(TokenType::NotMatch, "!~", line, column));
            }
            _ => {}
        }

        // Single-character tokens
        self.advance()?;
        match ch {
            '{' => Ok(Token::new(TokenType::LBrace, "{", line, column)),
            '}' => Ok(Token::new(TokenType::RBrace, "}", line, column)),
            '[' => Ok(Token::new(TokenType::LBracket, "[", line, column)),
            ']' => Ok(Token::new(TokenType::RBracket, "]", line, column)),
            ':' => Ok(Token::new(TokenType::Colon, ":", line, column)),
            ',' => Ok(Token::new(TokenType::Comma, ",", line, column)),
            '(' => Ok(Token::new(TokenType::LParen, "(", line, column)),
            ')' => Ok(Token::new(TokenType::RParen, ")", line, column)),
            '|' => Ok(Token::new(TokenType::Pipe, "|", line, column)),
            '&' => Ok(Token::new(TokenType::Amp, "&", line, column)),
            '>' => Ok(Token::new(TokenType::Gt, ">", line, column)),
            '<' => Ok(Token::new(TokenType::Lt, "<", line, column)),
            '?' => Ok(Token::new(TokenType::Question, "?", line, column)),
            '#' => Ok(Token::new(TokenType::Hash, "#", line, column)),
            _ => Err(CueError::new(
                format!("Unexpected character '{}'", ch),
                line,
                column,
            )),
        }
    }

    fn read_comment(&mut self, line: usize, column: usize) -> Result<Token, CueError> {
        // consume the two slashes
        self.advance()?;
        self.advance()?;
        let mut value = String::from("//");
        while self.pos < self.input.len() && self.current() != '\n' {
            value.push(self.advance()?);
        }
        Ok(Token::new(TokenType::Comment, value, line, column))
    }

    fn read_string(&mut self, line: usize, column: usize) -> Result<Token, CueError> {
        // Check for triple-quoted string
        if self.peek(1) == '"' && self.peek(2) == '"' {
            return self.read_triple_quoted_string(line, column);
        }

        // Consume opening quote
        self.advance()?;
        let mut value = String::new();

        while self.pos < self.input.len() {
            let ch = self.current();

            if ch == '"' {
                self.advance()?;
                return Ok(Token::new(TokenType::String, value, line, column));
            }

            if ch == '\n' {
                return Err(CueError::new("Unterminated string", line, column));
            }

            if ch == '\\' {
                self.advance()?;
                let escaped = self.current();
                if let Some(mapped) = lookup_escape(escaped) {
                    value.push(mapped);
                    self.advance()?;
                } else if escaped == 'u' {
                    self.advance()?;
                    let s = self.read_unicode_escape(4)?;
                    value.push_str(&s);
                } else if escaped == 'U' {
                    self.advance()?;
                    let s = self.read_unicode_escape(8)?;
                    value.push_str(&s);
                } else {
                    return Err(CueError::new(
                        format!("Invalid escape sequence '\\{}'", escaped),
                        self.line,
                        self.column,
                    ));
                }
            } else {
                value.push(self.advance()?);
            }
        }

        Err(CueError::new("Unterminated string", line, column))
    }

    fn read_triple_quoted_string(
        &mut self,
        line: usize,
        column: usize,
    ) -> Result<Token, CueError> {
        // Consume opening """
        self.advance()?;
        self.advance()?;
        self.advance()?;

        let mut value = String::new();

        while self.pos < self.input.len() {
            if self.current() == '"' && self.peek(1) == '"' && self.peek(2) == '"' {
                self.advance()?;
                self.advance()?;
                self.advance()?;
                return Ok(Token::new(TokenType::String, value, line, column));
            }
            value.push(self.advance()?);
        }

        Err(CueError::new(
            "Unterminated multi-line string",
            line,
            column,
        ))
    }

    fn read_number(&mut self, line: usize, column: usize) -> Result<Token, CueError> {
        let mut value = String::new();

        if self.current() == '-' {
            value.push(self.advance()?);
        }

        while self.pos < self.input.len() && self.current().is_ascii_digit() {
            value.push(self.advance()?);
        }

        // Check for float
        if self.current() == '.' && self.peek(1).is_ascii_digit() {
            value.push(self.advance()?); // consume '.'
            while self.pos < self.input.len() && self.current().is_ascii_digit() {
                value.push(self.advance()?);
            }
        }

        Ok(Token::new(TokenType::Number, value, line, column))
    }

    fn read_ident_or_keyword(
        &mut self,
        line: usize,
        column: usize,
    ) -> Result<Token, CueError> {
        let mut value = String::new();

        while self.pos < self.input.len() && is_ident_part(self.current()) {
            value.push(self.advance()?);
        }

        if let Some(kw) = lookup_keyword(&value) {
            Ok(Token::new(kw, value, line, column))
        } else {
            Ok(Token::new(TokenType::Ident, value, line, column))
        }
    }

    fn read_unicode_escape(&mut self, digits: usize) -> Result<String, CueError> {
        let mut hex = String::new();
        for i in 0..digits {
            let ch = self.current();
            if !ch.is_ascii_hexdigit() {
                return Err(CueError::new(
                    format!(
                        "Invalid unicode escape: expected {} hex digits, got {}",
                        digits, i
                    ),
                    self.line,
                    self.column,
                ));
            }
            hex.push(self.advance()?);
        }
        let code_point = u32::from_str_radix(&hex, 16).map_err(|_| {
            CueError::new("Invalid unicode escape", self.line, self.column)
        })?;
        let c = char::from_u32(code_point).ok_or_else(|| {
            CueError::new(
                format!("Invalid unicode code point: U+{:04X}", code_point),
                self.line,
                self.column,
            )
        })?;
        Ok(c.to_string())
    }
}

fn is_ident_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_'
}

fn is_ident_part(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokenize(input: &str) -> Vec<Token> {
        Lexer::new(input).tokenize().unwrap()
    }

    fn types(input: &str) -> Vec<TokenType> {
        tokenize(input)
            .into_iter()
            .map(|t| t.token_type)
            .collect()
    }

    #[test]
    fn test_punctuation_tokens() {
        assert_eq!(
            types("{ } [ ] : , ( )"),
            vec![
                TokenType::LBrace,
                TokenType::RBrace,
                TokenType::LBracket,
                TokenType::RBracket,
                TokenType::Colon,
                TokenType::Comma,
                TokenType::LParen,
                TokenType::RParen,
                TokenType::Eof,
            ]
        );
    }

    #[test]
    fn test_operator_tokens() {
        assert_eq!(
            types(">= <= > < == != =~ !~ | &"),
            vec![
                TokenType::Gte,
                TokenType::Lte,
                TokenType::Gt,
                TokenType::Lt,
                TokenType::Eq,
                TokenType::Neq,
                TokenType::Match,
                TokenType::NotMatch,
                TokenType::Pipe,
                TokenType::Amp,
                TokenType::Eof,
            ]
        );
    }

    #[test]
    fn test_string_simple() {
        let tokens = tokenize(r#""hello world""#);
        assert_eq!(tokens[0].token_type, TokenType::String);
        assert_eq!(tokens[0].value, "hello world");
    }

    #[test]
    fn test_string_with_escapes() {
        let tokens = tokenize(r#""line1\nline2\ttab\\slash\"quote""#);
        assert_eq!(tokens[0].token_type, TokenType::String);
        assert_eq!(tokens[0].value, "line1\nline2\ttab\\slash\"quote");
    }

    #[test]
    fn test_triple_quoted_string() {
        let tokens = tokenize(r#""""hello
world""""#);
        assert_eq!(tokens[0].token_type, TokenType::String);
        assert_eq!(tokens[0].value, "hello\nworld");
    }

    #[test]
    fn test_numbers_int() {
        let tokens = tokenize("42");
        assert_eq!(tokens[0].token_type, TokenType::Number);
        assert_eq!(tokens[0].value, "42");
    }

    #[test]
    fn test_numbers_float() {
        let tokens = tokenize("3.14");
        assert_eq!(tokens[0].token_type, TokenType::Number);
        assert_eq!(tokens[0].value, "3.14");
    }

    #[test]
    fn test_numbers_negative() {
        let tokens = tokenize("-1 -3.14");
        assert_eq!(tokens[0].token_type, TokenType::Number);
        assert_eq!(tokens[0].value, "-1");
        assert_eq!(tokens[1].token_type, TokenType::Number);
        assert_eq!(tokens[1].value, "-3.14");
    }

    #[test]
    fn test_keywords() {
        assert_eq!(
            types("null true false"),
            vec![TokenType::Null, TokenType::True, TokenType::False, TokenType::Eof]
        );
    }

    #[test]
    fn test_type_keywords() {
        assert_eq!(
            types("string int float bool number bytes"),
            vec![
                TokenType::StringType,
                TokenType::IntType,
                TokenType::FloatType,
                TokenType::BoolType,
                TokenType::NumberType,
                TokenType::BytesType,
                TokenType::Eof,
            ]
        );
    }

    #[test]
    fn test_special_underscore() {
        let tokens = tokenize("_");
        assert_eq!(tokens[0].token_type, TokenType::Underscore);
    }

    #[test]
    fn test_special_bottom() {
        let tokens = tokenize("_|_");
        assert_eq!(tokens[0].token_type, TokenType::Bottom);
    }

    #[test]
    fn test_special_ellipsis() {
        let tokens = tokenize("...");
        assert_eq!(tokens[0].token_type, TokenType::Ellipsis);
    }

    #[test]
    fn test_special_question_hash() {
        assert_eq!(
            types("? #"),
            vec![TokenType::Question, TokenType::Hash, TokenType::Eof]
        );
    }

    #[test]
    fn test_identifiers() {
        let tokens = tokenize("foo _bar baz123");
        assert_eq!(tokens[0].token_type, TokenType::Ident);
        assert_eq!(tokens[0].value, "foo");
        assert_eq!(tokens[1].token_type, TokenType::Ident);
        assert_eq!(tokens[1].value, "_bar");
        assert_eq!(tokens[2].token_type, TokenType::Ident);
        assert_eq!(tokens[2].value, "baz123");
    }

    #[test]
    fn test_comments() {
        let tokens = tokenize("// this is a comment\nfoo");
        assert_eq!(tokens[0].token_type, TokenType::Comment);
        assert_eq!(tokens[0].value, "// this is a comment");
        assert_eq!(tokens[1].token_type, TokenType::Ident);
    }

    #[test]
    fn test_unterminated_string_error() {
        let result = Lexer::new(r#""hello"#).tokenize();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.message.contains("Unterminated string"));
    }

    #[test]
    fn test_invalid_char_error() {
        let result = Lexer::new("@").tokenize();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.message.contains("Unexpected character"));
    }

    #[test]
    fn test_unicode_escape() {
        let tokens = tokenize(r#""\u0041""#);
        assert_eq!(tokens[0].value, "A");
    }

    #[test]
    fn test_line_column_tracking() {
        let tokens = tokenize("foo\nbar");
        assert_eq!(tokens[0].line, 1);
        assert_eq!(tokens[0].column, 1);
        assert_eq!(tokens[1].line, 2);
        assert_eq!(tokens[1].column, 1);
    }
}
