# cue-ts

A lightweight TypeScript parser for a subset of the [CUE configuration language](https://cuelang.org/). Produces a fully typed AST. Zero runtime dependencies. Works in the browser and Node.js.

## Install

```bash
pnpm add cue-ts
```

## Usage

```typescript
import { parse } from "cue-ts";

const ast = parse(`
  name: string
  age:  int & >=0
  role: "admin" | "user"
`);

// ast.kind === "file"
// ast.declarations contains CueField nodes
```

### Error handling

```typescript
import { parse, CueParseError } from "cue-ts";

try {
  parse("invalid: {");
} catch (e) {
  if (e instanceof CueParseError) {
    console.log(e.line, e.column, e.message);
  }
}
```

## Supported CUE subset

| Construct | Example |
|---|---|
| Literals | `"hello"`, `42`, `3.14`, `true`, `false`, `null` |
| Multi-line strings | `""" ... """` |
| Type keywords | `string`, `int`, `float`, `bool`, `number`, `bytes` |
| Top / Bottom | `_`, `_\|_` |
| Structs | `{ name: "Alice" }` |
| Optional fields | `name?: string` |
| Definitions | `#Name: { ... }` |
| Lists | `[1, 2, 3]`, `[...string]` |
| Constraints | `int & >=0`, `string & =~"pattern"` |
| Disjunctions | `"a" \| "b" \| "c"` |
| Comments | `// single line` |
| Quoted labels | `"my-key": value` |

## AST node types

Every node has a `kind` discriminant for exhaustive matching:

- `CueFile` -- top-level container
- `CueField` -- `label: value` (with `optional` flag)
- `CueStruct` -- `{ fields }`
- `CueList` -- `[elements]`
- `CueLiteral` -- string, number, bool, or null
- `CueIdent` -- identifier reference
- `CueType` -- type keyword (`string`, `int`, `top`, etc.)
- `CueUnaryExpr` -- constraint operator (`>=`, `<`, `=~`, etc.)
- `CueBinaryExpr` -- conjunction (`&`)
- `CueDisjunction` -- alternatives (`|`)
- `CueDefinition` -- `#Name: value`
- `CueComment` -- `// text`
- `CueEllipsis` -- `...` or `...type`

All types are exported and available for import.

## Not supported

This is a subset parser. It does **not** support:

- CUE evaluation or unification
- Import/package resolution
- Constraint solving
- Comprehensions
- Interpolation
- Parenthesized expressions

## Development

```bash
pnpm install
pnpm test        # vitest
pnpm build       # tsup (dual CJS/ESM + types)
pnpm lint        # biome
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [git-cliff](https://git-cliff.org/) for automated changelog generation.

## License

[Apache 2.0](./LICENSE)
