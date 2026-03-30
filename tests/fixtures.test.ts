import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "../src/index.js";
import type {
  CueField,
  CueStruct,
  CueList,
  CueLiteral,
  CueType,
  CueUnaryExpr,
  CueBinaryExpr,
  CueDisjunction,
  CueDefinition,
  CueEllipsis,
} from "../src/index.js";

function loadFixture(name: string): string {
  return readFileSync(
    resolve(__dirname, "fixtures", name),
    "utf-8",
  );
}

describe("Fixture: basic.cue", () => {
  it("should parse 5 fields with correct types and values", () => {
    const ast = parse(loadFixture("basic.cue"));

    expect(ast.kind).toBe("file");
    expect(ast.declarations).toHaveLength(5);

    const name = ast.declarations[0] as CueField;
    expect(name.kind).toBe("field");
    expect(name.label).toBe("name");
    expect(name.optional).toBe(false);
    const nameVal = name.value as CueLiteral;
    expect(nameVal.type).toBe("string");
    expect(nameVal.value).toBe("Alice");

    const age = ast.declarations[1] as CueField;
    expect(age.label).toBe("age");
    const ageVal = age.value as CueLiteral;
    expect(ageVal.type).toBe("number");
    expect(ageVal.value).toBe(42);

    const active = ast.declarations[2] as CueField;
    expect(active.label).toBe("active");
    const activeVal = active.value as CueLiteral;
    expect(activeVal.type).toBe("bool");
    expect(activeVal.value).toBe(true);

    const data = ast.declarations[3] as CueField;
    expect(data.label).toBe("data");
    const dataVal = data.value as CueLiteral;
    expect(dataVal.type).toBe("null");
    expect(dataVal.value).toBe(null);

    const score = ast.declarations[4] as CueField;
    expect(score.label).toBe("score");
    const scoreVal = score.value as CueLiteral;
    expect(scoreVal.type).toBe("number");
    expect(scoreVal.value).toBe(3.14);
  });
});

describe("Fixture: structs.cue", () => {
  it("should parse 1 definition and 1 field with nested struct structure", () => {
    const ast = parse(loadFixture("structs.cue"));

    expect(ast.declarations).toHaveLength(2);

    // #Person definition
    const person = ast.declarations[0] as CueDefinition;
    expect(person.kind).toBe("definition");
    expect(person.name).toBe("Person");

    const personStruct = person.value as CueStruct;
    expect(personStruct.kind).toBe("struct");
    expect(personStruct.fields).toHaveLength(3);

    const nameField = personStruct.fields[0] as CueField;
    expect(nameField.label).toBe("name");
    expect(nameField.optional).toBe(false);
    expect((nameField.value as CueType).name).toBe("string");

    const ageField = personStruct.fields[1] as CueField;
    expect(ageField.label).toBe("age");
    expect(ageField.optional).toBe(true);
    expect((ageField.value as CueType).name).toBe("int");

    const addressField = personStruct.fields[2] as CueField;
    expect(addressField.label).toBe("address");
    const addressStruct = addressField.value as CueStruct;
    expect(addressStruct.kind).toBe("struct");
    expect(addressStruct.fields).toHaveLength(2);

    const streetField = addressStruct.fields[0] as CueField;
    expect(streetField.label).toBe("street");
    expect((streetField.value as CueType).name).toBe("string");

    const cityField = addressStruct.fields[1] as CueField;
    expect(cityField.label).toBe("city");
    expect((cityField.value as CueType).name).toBe("string");

    // config field
    const config = ast.declarations[1] as CueField;
    expect(config.kind).toBe("field");
    expect(config.label).toBe("config");

    const configStruct = config.value as CueStruct;
    expect(configStruct.kind).toBe("struct");
    expect(configStruct.fields).toHaveLength(2);

    const debugField = configStruct.fields[0] as CueField;
    expect(debugField.label).toBe("debug");
    expect((debugField.value as CueLiteral).value).toBe(false);

    const timeoutField = configStruct.fields[1] as CueField;
    expect(timeoutField.label).toBe("timeout");
    expect((timeoutField.value as CueLiteral).value).toBe(30);
  });
});

describe("Fixture: lists.cue", () => {
  it("should parse 4 fields with correct list elements", () => {
    const ast = parse(loadFixture("lists.cue"));

    expect(ast.declarations).toHaveLength(4);

    // tags: ["web", "api", "v2"]
    const tags = ast.declarations[0] as CueField;
    expect(tags.label).toBe("tags");
    const tagsList = tags.value as CueList;
    expect(tagsList.kind).toBe("list");
    expect(tagsList.elements).toHaveLength(3);
    expect((tagsList.elements[0] as CueLiteral).value).toBe("web");
    expect((tagsList.elements[1] as CueLiteral).value).toBe("api");
    expect((tagsList.elements[2] as CueLiteral).value).toBe("v2");

    // matrix: [[1, 2], [3, 4]]
    const matrix = ast.declarations[1] as CueField;
    expect(matrix.label).toBe("matrix");
    const matrixList = matrix.value as CueList;
    expect(matrixList.kind).toBe("list");
    expect(matrixList.elements).toHaveLength(2);

    const row1 = matrixList.elements[0] as CueList;
    expect(row1.kind).toBe("list");
    expect((row1.elements[0] as CueLiteral).value).toBe(1);
    expect((row1.elements[1] as CueLiteral).value).toBe(2);

    const row2 = matrixList.elements[1] as CueList;
    expect(row2.kind).toBe("list");
    expect((row2.elements[0] as CueLiteral).value).toBe(3);
    expect((row2.elements[1] as CueLiteral).value).toBe(4);

    // names: [...string]
    const names = ast.declarations[2] as CueField;
    expect(names.label).toBe("names");
    const namesList = names.value as CueList;
    expect(namesList.kind).toBe("list");
    expect(namesList.elements).toHaveLength(1);
    const ellipsis = namesList.elements[0] as CueEllipsis;
    expect(ellipsis.kind).toBe("ellipsis");
    expect((ellipsis.type as CueType).name).toBe("string");

    // empty: []
    const empty = ast.declarations[3] as CueField;
    expect(empty.label).toBe("empty");
    const emptyList = empty.value as CueList;
    expect(emptyList.kind).toBe("list");
    expect(emptyList.elements).toHaveLength(0);
  });
});

describe("Fixture: constraints.cue", () => {
  it("should parse 5 fields with correct constraint/disjunction structure", () => {
    const ast = parse(loadFixture("constraints.cue"));

    expect(ast.declarations).toHaveLength(5);

    // age: int & >=0 & <150
    const age = ast.declarations[0] as CueField;
    expect(age.label).toBe("age");
    const ageExpr = age.value as CueBinaryExpr;
    expect(ageExpr.kind).toBe("binary_expr");
    expect(ageExpr.operator).toBe("&");
    // Left: (int & >=0)
    const ageInner = ageExpr.left as CueBinaryExpr;
    expect(ageInner.operator).toBe("&");
    expect((ageInner.left as CueType).name).toBe("int");
    const ageGte = ageInner.right as CueUnaryExpr;
    expect(ageGte.operator).toBe(">=");
    expect((ageGte.operand as CueLiteral).value).toBe(0);
    // Right: <150
    const ageLt = ageExpr.right as CueUnaryExpr;
    expect(ageLt.operator).toBe("<");
    expect((ageLt.operand as CueLiteral).value).toBe(150);

    // name: string & =~"^[A-Z]"
    const name = ast.declarations[1] as CueField;
    expect(name.label).toBe("name");
    const nameExpr = name.value as CueBinaryExpr;
    expect(nameExpr.operator).toBe("&");
    expect((nameExpr.left as CueType).name).toBe("string");
    const nameMatch = nameExpr.right as CueUnaryExpr;
    expect(nameMatch.operator).toBe("=~");
    expect((nameMatch.operand as CueLiteral).value).toBe("^[A-Z]");

    // role: "admin" | "user" | "guest"
    const role = ast.declarations[2] as CueField;
    expect(role.label).toBe("role");
    const roleDisj = role.value as CueDisjunction;
    expect(roleDisj.kind).toBe("disjunction");
    expect(roleDisj.elements).toHaveLength(3);
    expect((roleDisj.elements[0] as CueLiteral).value).toBe("admin");
    expect((roleDisj.elements[1] as CueLiteral).value).toBe("user");
    expect((roleDisj.elements[2] as CueLiteral).value).toBe("guest");

    // status: int | string
    const status = ast.declarations[3] as CueField;
    expect(status.label).toBe("status");
    const statusDisj = status.value as CueDisjunction;
    expect(statusDisj.kind).toBe("disjunction");
    expect(statusDisj.elements).toHaveLength(2);
    expect((statusDisj.elements[0] as CueType).name).toBe("int");
    expect((statusDisj.elements[1] as CueType).name).toBe("string");

    // port: int & >=1 & <=65535
    const port = ast.declarations[4] as CueField;
    expect(port.label).toBe("port");
    const portExpr = port.value as CueBinaryExpr;
    expect(portExpr.kind).toBe("binary_expr");
    expect(portExpr.operator).toBe("&");
    const portInner = portExpr.left as CueBinaryExpr;
    expect(portInner.operator).toBe("&");
    expect((portInner.left as CueType).name).toBe("int");
    const portGte = portInner.right as CueUnaryExpr;
    expect(portGte.operator).toBe(">=");
    expect((portGte.operand as CueLiteral).value).toBe(1);
    const portLte = portExpr.right as CueUnaryExpr;
    expect(portLte.operator).toBe("<=");
    expect((portLte.operand as CueLiteral).value).toBe(65535);
  });
});
