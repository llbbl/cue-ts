#[derive(Debug, Clone, PartialEq)]
pub enum TokenType {
    // Literals
    String,
    Number,
    Ident,

    // Keywords
    Null,
    True,
    False,

    // Type keywords
    StringType,
    IntType,
    FloatType,
    BoolType,
    NumberType,
    BytesType,

    // Punctuation
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    LParen,
    RParen,

    // Operators
    Pipe,
    Amp,
    Gte,
    Lte,
    Gt,
    Lt,
    Eq,
    Neq,
    Match,
    NotMatch,

    // Special
    Comment,
    Ellipsis,
    Question,
    Hash,
    Underscore,
    Bottom,

    Eof,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub token_type: TokenType,
    pub value: std::string::String,
    pub line: usize,
    pub column: usize,
}

impl Token {
    pub fn new(token_type: TokenType, value: impl Into<std::string::String>, line: usize, column: usize) -> Self {
        Self {
            token_type,
            value: value.into(),
            line,
            column,
        }
    }
}
