"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/obsidian-desktop/server-entry.ts
var server_entry_exports = {};
__export(server_entry_exports, {
  DesktopApiError: () => DesktopApiError,
  createServerApi: () => createServerApi
});
module.exports = __toCommonJS(server_entry_exports);

// src/obsidian-desktop/server-api.ts
var import_fs = require("fs");
var import_fs2 = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_crypto = require("crypto");

// src/lib/obsidian/types.ts
function parseCanvas(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { nodes: [], edges: [] };
    const { nodes: rawNodes, edges: rawEdges, ...rest } = parsed;
    const nodes = Array.isArray(rawNodes) ? rawNodes.filter((n) => n && typeof n.id === "string" && typeof n.x === "number") : [];
    const edges = Array.isArray(rawEdges) ? rawEdges.filter(
      (e) => e && typeof e.id === "string" && typeof e.fromNode === "string" && typeof e.toNode === "string"
    ) : [];
    return { ...rest, nodes, edges };
  } catch {
    return { nodes: [], edges: [] };
  }
}
function serializeCanvas(data) {
  const { nodes: rawNodes, edges: rawEdges, ...restCanvas } = data;
  const clean = {
    ...restCanvas,
    nodes: rawNodes.map((n) => {
      const { id, type, text, file, subpath, url, label, background, backgroundStyle, x, y, width, height, color, ...extra } = n;
      const out = {
        ...extra,
        id,
        type
      };
      if (type === "text") {
        out.text = text ?? "";
      } else if (type === "file") {
        out.file = file ?? "";
        if (subpath) out.subpath = subpath;
      } else if (type === "link") {
        out.url = url ?? "";
      } else if (type === "group") {
        if (label !== void 0 && label !== "") out.label = label;
        if (background) out.background = background;
        if (backgroundStyle) out.backgroundStyle = backgroundStyle;
      }
      out.x = Math.round(x);
      out.y = Math.round(y);
      out.width = Math.round(width);
      out.height = Math.round(height);
      if (color) out.color = color;
      return out;
    }),
    edges: rawEdges.map((e) => {
      const { id, fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label, ...extra } = e;
      return {
        ...extra,
        id,
        fromNode,
        fromSide,
        ...fromEnd ? { fromEnd } : {},
        toNode,
        toSide,
        ...toEnd ? { toEnd } : {},
        ...label ? { label } : {},
        ...color ? { color } : {}
      };
    })
  };
  return JSON.stringify(clean, null, 2);
}

// node_modules/js-yaml/dist/js-yaml.mjs
var NOT_RESOLVED = Symbol("NOT_RESOLVED");
function defineScalarTag(tagName, options) {
  return {
    tagName,
    nodeKind: "scalar",
    implicit: options.implicit ?? false,
    matchByTagPrefix: options.matchByTagPrefix ?? false,
    implicitFirstChars: options.implicitFirstChars ?? null,
    resolve: options.resolve,
    identify: options.identify,
    represent: options.represent ?? ((data) => String(data)),
    representTagName: options.representTagName ?? (() => tagName)
  };
}
function defineSequenceTag(tagName, options) {
  const carrierIsResult = options.finalize === void 0;
  return {
    tagName,
    nodeKind: "sequence",
    implicit: false,
    matchByTagPrefix: options.matchByTagPrefix ?? false,
    create: options.create,
    addItem: options.addItem,
    finalize: options.finalize ?? ((carrier) => carrier),
    carrierIsResult,
    identify: options.identify,
    represent: options.represent ?? ((data) => data),
    representTagName: options.representTagName ?? (() => tagName)
  };
}
function defineMappingTag(tagName, options) {
  const carrierIsResult = options.finalize === void 0;
  return {
    tagName,
    nodeKind: "mapping",
    implicit: false,
    matchByTagPrefix: options.matchByTagPrefix ?? false,
    create: options.create,
    addPair: options.addPair,
    has: options.has,
    keys: options.keys,
    get: options.get,
    finalize: options.finalize ?? ((carrier) => carrier),
    carrierIsResult,
    identify: options.identify,
    represent: options.represent ?? ((data) => data),
    representTagName: options.representTagName ?? (() => tagName)
  };
}
var strTag = defineScalarTag("tag:yaml.org,2002:str", {
  resolve: (source) => source,
  identify: (data) => typeof data === "string"
});
var NULL_VALUES$1 = [
  "",
  "~",
  "null",
  "Null",
  "NULL"
];
var nullCoreTag = defineScalarTag("tag:yaml.org,2002:null", {
  implicit: true,
  implicitFirstChars: [
    "",
    "~",
    "n",
    "N"
  ],
  resolve: (source) => {
    if (NULL_VALUES$1.indexOf(source) !== -1) return null;
    return NOT_RESOLVED;
  },
  identify: (object) => object === null,
  represent: () => "null"
});
var nullJsonTag = defineScalarTag("tag:yaml.org,2002:null", {
  implicit: true,
  implicitFirstChars: ["n"],
  resolve: (source, isExplicit) => {
    if (source === "null" || isExplicit && source === "") return null;
    return NOT_RESOLVED;
  },
  identify: (object) => object === null,
  represent: () => "null"
});
var NULL_VALUES = [
  "",
  "~",
  "null",
  "Null",
  "NULL"
];
var nullYaml11Tag = defineScalarTag("tag:yaml.org,2002:null", {
  implicit: true,
  implicitFirstChars: [
    "",
    "~",
    "n",
    "N"
  ],
  resolve: (source) => {
    if (NULL_VALUES.indexOf(source) !== -1) return null;
    return NOT_RESOLVED;
  },
  identify: (object) => object === null,
  represent: () => "null"
});
var TRUE_VALUES$2 = [
  "true",
  "True",
  "TRUE"
];
var FALSE_VALUES$2 = [
  "false",
  "False",
  "FALSE"
];
var boolCoreTag = defineScalarTag("tag:yaml.org,2002:bool", {
  implicit: true,
  implicitFirstChars: [
    "t",
    "T",
    "f",
    "F"
  ],
  resolve: (source) => {
    if (TRUE_VALUES$2.indexOf(source) !== -1) return true;
    if (FALSE_VALUES$2.indexOf(source) !== -1) return false;
    return NOT_RESOLVED;
  },
  identify: (object) => Object.prototype.toString.call(object) === "[object Boolean]",
  represent: (object) => object ? "true" : "false"
});
var TRUE_VALUES$1 = ["true"];
var FALSE_VALUES$1 = ["false"];
var boolJsonTag = defineScalarTag("tag:yaml.org,2002:bool", {
  implicit: true,
  implicitFirstChars: ["t", "f"],
  resolve: (source) => {
    if (TRUE_VALUES$1.indexOf(source) !== -1) return true;
    if (FALSE_VALUES$1.indexOf(source) !== -1) return false;
    return NOT_RESOLVED;
  },
  identify: (object) => Object.prototype.toString.call(object) === "[object Boolean]",
  represent: (object) => object ? "true" : "false"
});
var TRUE_VALUES = [
  "true",
  "True",
  "TRUE",
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON"
];
var FALSE_VALUES = [
  "false",
  "False",
  "FALSE",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var boolYaml11Tag = defineScalarTag("tag:yaml.org,2002:bool", {
  implicit: true,
  implicitFirstChars: [
    "y",
    "Y",
    "n",
    "N",
    "t",
    "T",
    "f",
    "F",
    "o",
    "O"
  ],
  resolve: (source) => {
    if (TRUE_VALUES.indexOf(source) !== -1) return true;
    if (FALSE_VALUES.indexOf(source) !== -1) return false;
    return NOT_RESOLVED;
  },
  identify: (object) => Object.prototype.toString.call(object) === "[object Boolean]",
  represent: (object) => object ? "true" : "false"
});
var YAML_INTEGER_IMPLICIT_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:0o[0-7]+|0x[0-9a-fA-F]+|[-+]?[0-9]+)$");
var YAML_INTEGER_EXPLICIT_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:[-+]?0b[0-1]+|[-+]?0o[0-7]+|[-+]?0x[0-9a-fA-F]+|[-+]?[0-9]+)$");
function parseYamlInteger$2(source) {
  let value = source;
  let sign = 1;
  if (value[0] === "-" || value[0] === "+") {
    if (value[0] === "-") sign = -1;
    value = value.slice(1);
  }
  if (value.startsWith("0b")) return sign * parseInt(value.slice(2), 2);
  if (value.startsWith("0o")) return sign * parseInt(value.slice(2), 8);
  if (value.startsWith("0x")) return sign * parseInt(value.slice(2), 16);
  return sign * parseInt(value, 10);
}
function resolveYamlInteger$2(source, isExplicit) {
  if (isExplicit) {
    if (!YAML_INTEGER_EXPLICIT_PATTERN$1.test(source)) return NOT_RESOLVED;
  } else if (!YAML_INTEGER_IMPLICIT_PATTERN$1.test(source)) return NOT_RESOLVED;
  const result = parseYamlInteger$2(source);
  return Number.isFinite(result) ? result : NOT_RESOLVED;
}
var intCoreTag = defineScalarTag("tag:yaml.org,2002:int", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ..."0123456789"
  ],
  resolve: resolveYamlInteger$2,
  identify: (object) => Number.isInteger(object) && !Object.is(object, -0) && object.toString(10).indexOf("e") < 0,
  represent: (object) => object.toString(10)
});
var YAML_INTEGER_IMPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^-?(?:0|[1-9][0-9]*)$");
var YAML_INTEGER_EXPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?0b[0-1]+|[-+]?0o[0-7]+|[-+]?0x[0-9a-fA-F]+|[-+]?[0-9]+)$");
function parseYamlInteger$1(source) {
  let value = source;
  let sign = 1;
  if (value[0] === "-" || value[0] === "+") {
    if (value[0] === "-") sign = -1;
    value = value.slice(1);
  }
  if (value.startsWith("0b")) return sign * parseInt(value.slice(2), 2);
  if (value.startsWith("0o")) return sign * parseInt(value.slice(2), 8);
  if (value.startsWith("0x")) return sign * parseInt(value.slice(2), 16);
  return sign * parseInt(value, 10);
}
function resolveYamlInteger$1(source, isExplicit) {
  if (isExplicit) {
    if (!YAML_INTEGER_EXPLICIT_PATTERN.test(source)) return NOT_RESOLVED;
  } else if (!YAML_INTEGER_IMPLICIT_PATTERN.test(source)) return NOT_RESOLVED;
  const result = parseYamlInteger$1(source);
  return Number.isFinite(result) ? result : NOT_RESOLVED;
}
var intJsonTag = defineScalarTag("tag:yaml.org,2002:int", {
  implicit: true,
  implicitFirstChars: ["-", ..."0123456789"],
  resolve: resolveYamlInteger$1,
  identify: (object) => Number.isInteger(object) && !Object.is(object, -0) && object.toString(10).indexOf("e") < 0,
  represent: (object) => object.toString(10)
});
var YAML_INTEGER_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?0x[0-9a-fA-F_]+|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+|[-+]?(?:0|[1-9][0-9_]*))$");
function parseYamlInteger(source) {
  let value = source.replace(/_/g, "");
  let sign = 1;
  if (value[0] === "-" || value[0] === "+") {
    if (value[0] === "-") sign = -1;
    value = value.slice(1);
  }
  if (value.startsWith("0b")) return sign * parseInt(value.slice(2), 2);
  if (value.startsWith("0x")) return sign * parseInt(value.slice(2), 16);
  if (value.includes(":")) {
    let result = 0;
    for (const part of value.split(":")) result = result * 60 + Number(part);
    return sign * result;
  }
  if (value !== "0" && value[0] === "0") return sign * parseInt(value, 8);
  return sign * parseInt(value, 10);
}
function resolveYamlInteger(source) {
  if (!YAML_INTEGER_PATTERN.test(source)) return NOT_RESOLVED;
  const result = parseYamlInteger(source);
  return Number.isFinite(result) ? result : NOT_RESOLVED;
}
var intYaml11Tag = defineScalarTag("tag:yaml.org,2002:int", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ..."0123456789"
  ],
  resolve: resolveYamlInteger,
  identify: (object) => Number.isInteger(object) && !Object.is(object, -0) && object.toString(10).indexOf("e") < 0,
  represent: (object) => object.toString(10)
});
var YAML_FLOAT_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:[-+]?[0-9]+(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|[-+]?\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
var YAML_FLOAT_SPECIAL_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat$2(source) {
  if (!YAML_FLOAT_PATTERN$1.test(source)) return NOT_RESOLVED;
  let value = source.toLowerCase();
  const sign = value[0] === "-" ? -1 : 1;
  if ("+-".includes(value[0])) value = value.slice(1);
  if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  if (value === ".nan") return NaN;
  const result = sign * parseFloat(value);
  if (Number.isFinite(result) || YAML_FLOAT_SPECIAL_PATTERN$1.test(source)) return result;
  return NOT_RESOLVED;
}
function representYamlFloat$2(object) {
  if (isNaN(object)) return ".nan";
  if (object === Number.POSITIVE_INFINITY) return ".inf";
  if (object === Number.NEGATIVE_INFINITY) return "-.inf";
  if (Object.is(object, -0)) return "-0.0";
  const result = object.toString(10);
  return /^[-+]?[0-9]+e/.test(result) ? result.replace("e", ".e") : result;
}
var floatCoreTag = defineScalarTag("tag:yaml.org,2002:float", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ".",
    ..."0123456789"
  ],
  resolve: resolveYamlFloat$2,
  identify: (object) => typeof object === "number" && (!Number.isInteger(object) || Object.is(object, -0) || object.toString(10).indexOf("e") >= 0),
  represent: representYamlFloat$2
});
var YAML_FLOAT_IMPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$");
var YAML_FLOAT_EXPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?[0-9]+(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|[-+]?\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat$1(source, isExplicit) {
  if (isExplicit) {
    if (!YAML_FLOAT_EXPLICIT_PATTERN.test(source)) return NOT_RESOLVED;
    let value = source.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".includes(value[0])) value = value.slice(1);
    if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    if (value === ".nan") return NaN;
    const result2 = sign * parseFloat(value);
    return Number.isFinite(result2) ? result2 : NOT_RESOLVED;
  }
  if (!YAML_FLOAT_IMPLICIT_PATTERN.test(source)) return NOT_RESOLVED;
  const result = Number(source);
  if (Number.isFinite(result)) return result;
  return NOT_RESOLVED;
}
function representYamlFloat$1(object) {
  if (isNaN(object)) return ".nan";
  if (object === Number.POSITIVE_INFINITY) return ".inf";
  if (object === Number.NEGATIVE_INFINITY) return "-.inf";
  if (Object.is(object, -0)) return "-0.0";
  const result = object.toString(10);
  return /^[-+]?[0-9]+e/.test(result) ? result.replace("e", ".e") : result;
}
var floatJsonTag = defineScalarTag("tag:yaml.org,2002:float", {
  implicit: true,
  implicitFirstChars: ["-", ..."0123456789"],
  resolve: resolveYamlFloat$1,
  identify: (object) => typeof object === "number" && (!Number.isInteger(object) || Object.is(object, -0) || object.toString(10).indexOf("e") >= 0),
  represent: representYamlFloat$1
});
var YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:(?:[0-9][0-9_]*)?\\.[0-9_]*)(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
var YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat(source) {
  if (!YAML_FLOAT_PATTERN.test(source)) return NOT_RESOLVED;
  let value = source.toLowerCase().replace(/_/g, "");
  const sign = value[0] === "-" ? -1 : 1;
  if ("+-".includes(value[0])) value = value.slice(1);
  if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  if (value === ".nan") return NaN;
  let result = 0;
  if (value.includes(":")) {
    for (const part of value.split(":")) result = result * 60 + Number(part);
    result *= sign;
  } else result = sign * parseFloat(value);
  if (Number.isFinite(result) || YAML_FLOAT_SPECIAL_PATTERN.test(source)) return result;
  return NOT_RESOLVED;
}
function representYamlFloat(object) {
  if (isNaN(object)) return ".nan";
  if (object === Number.POSITIVE_INFINITY) return ".inf";
  if (object === Number.NEGATIVE_INFINITY) return "-.inf";
  if (Object.is(object, -0)) return "-0.0";
  const result = object.toString(10);
  return /^[-+]?[0-9]+e/.test(result) ? result.replace("e", ".e") : result;
}
var floatYaml11Tag = defineScalarTag("tag:yaml.org,2002:float", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ".",
    ..."0123456789"
  ],
  resolve: resolveYamlFloat,
  identify: (object) => typeof object === "number" && (!Number.isInteger(object) || Object.is(object, -0) || object.toString(10).indexOf("e") >= 0),
  represent: representYamlFloat
});
var mergeTag = defineScalarTag("tag:yaml.org,2002:merge", {
  implicit: true,
  implicitFirstChars: ["<"],
  resolve: (source, isExplicit) => {
    if (source === "<<" || isExplicit && source === "") return "<<";
    return NOT_RESOLVED;
  },
  identify: () => false
});
var BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
function resolveYamlBinary(source) {
  const input = source.replace(/\s/g, "");
  if (input.length % 4 !== 0 || !BASE64_PATTERN.test(input)) return NOT_RESOLVED;
  const binary = atob(input);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index);
  return result;
}
function representYamlBinary(object) {
  let binary = "";
  for (let index = 0; index < object.length; index++) binary += String.fromCharCode(object[index]);
  return btoa(binary);
}
var binaryTag = defineScalarTag("tag:yaml.org,2002:binary", {
  resolve: resolveYamlBinary,
  identify: (object) => Object.prototype.toString.call(object) === "[object Uint8Array]",
  represent: representYamlBinary
});
var YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
var YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
function makeUtcDate(year, month, day, hour = 0, minute = 0, second = 0, fraction = 0) {
  const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  date.setUTCFullYear(year, month, day);
  return date;
}
function resolveYamlTimestamp(source) {
  let match = YAML_DATE_REGEXP.exec(source);
  if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(source);
  if (match === null) return NOT_RESOLVED;
  const year = +match[1];
  const month = +match[2] - 1;
  const day = +match[3];
  if (!match[4]) {
    const date2 = makeUtcDate(year, month, day);
    if (date2.getUTCFullYear() !== year || date2.getUTCMonth() !== month || date2.getUTCDate() !== day) return NOT_RESOLVED;
    return date2;
  }
  const hour = +match[4];
  const minute = +match[5];
  const second = +match[6];
  let fraction = 0;
  if (hour > 23 || minute > 59 || second > 59) return NOT_RESOLVED;
  if (match[7]) {
    let value = match[7].slice(0, 3);
    while (value.length < 3) value += "0";
    fraction = +value;
  }
  const date = makeUtcDate(year, month, day, hour, minute, second, fraction);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return NOT_RESOLVED;
  if (match[9]) {
    const offsetHour = +match[10];
    const offsetMinute = +(match[11] || 0);
    if (offsetHour > 23 || offsetMinute > 59) return NOT_RESOLVED;
    const offset = (offsetHour * 60 + offsetMinute) * 6e4;
    date.setTime(date.getTime() - (match[9] === "-" ? -offset : offset));
  }
  return date;
}
var timestampTag = defineScalarTag("tag:yaml.org,2002:timestamp", {
  implicit: true,
  implicitFirstChars: [..."0123456789"],
  resolve: resolveYamlTimestamp,
  identify: (object) => object instanceof Date,
  represent: (object) => object.toISOString()
});
var seqTag = defineSequenceTag("tag:yaml.org,2002:seq", {
  create: () => [],
  addItem: (container, item) => {
    container.push(item);
  },
  identify: Array.isArray
});
function isPlainObject(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const prototype = Object.getPrototypeOf(data);
  return prototype === null || prototype === Object.prototype;
}
function pick(object, keys) {
  const result = {};
  for (const key of keys) if (object[key] !== void 0) result[key] = object[key];
  return result;
}
var omapTag = defineSequenceTag("tag:yaml.org,2002:omap", {
  create: () => ({
    list: [],
    seen: /* @__PURE__ */ new Set()
  }),
  addItem: (carrier, item) => {
    let key;
    if (item instanceof Map) {
      if (item.size !== 1) return "cannot resolve an ordered map item";
      key = item.keys().next().value;
    } else if (isPlainObject(item)) {
      const itemKeys = Object.keys(item);
      if (itemKeys.length !== 1) return "cannot resolve an ordered map item";
      key = itemKeys[0];
    } else return "cannot resolve an ordered map item";
    if (carrier.seen.has(key)) return "duplicate key in ordered map";
    carrier.seen.add(key);
    carrier.list.push(item);
    return "";
  },
  finalize: (carrier) => carrier.list,
  identify: () => false
});
var pairsTag = defineSequenceTag("tag:yaml.org,2002:pairs", {
  create: () => [],
  addItem: (container, item) => {
    if (item instanceof Map) {
      if (item.size !== 1) return "cannot resolve a pairs item";
      container.push(item.entries().next().value);
      return "";
    }
    if (Object.prototype.toString.call(item) !== "[object Object]") return "cannot resolve a pairs item";
    const object = item;
    const keys = Object.keys(object);
    if (keys.length !== 1) return "cannot resolve a pairs item";
    container.push([keys[0], object[keys[0]]]);
    return "";
  },
  identify: () => false
});
var mapTag = defineMappingTag("tag:yaml.org,2002:map", {
  create: () => ({}),
  identify: isPlainObject,
  represent: (o) => {
    const map = /* @__PURE__ */ new Map();
    for (const key of Object.keys(o)) map.set(key, o[key]);
    return map;
  },
  addPair: (container, key, value) => {
    if (key !== null && typeof key === "object") return "object-based map does not support complex keys";
    const normalizedKey = String(key);
    if (normalizedKey === "__proto__") Object.defineProperty(container, normalizedKey, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    else container[normalizedKey] = value;
    return "";
  },
  has: (container, key) => {
    if (key !== null && typeof key === "object") return false;
    return Object.prototype.hasOwnProperty.call(container, String(key));
  },
  keys: (container) => Object.keys(container),
  get: (container, key) => {
    const normalizedKey = String(key);
    if (!Object.prototype.hasOwnProperty.call(container, normalizedKey)) return null;
    return container[normalizedKey];
  }
});
var setTag = defineMappingTag("tag:yaml.org,2002:set", {
  create: () => /* @__PURE__ */ new Set(),
  identify: (data) => data instanceof Set,
  represent: (data) => {
    const map = /* @__PURE__ */ new Map();
    for (const key of data) map.set(key, null);
    return map;
  },
  addPair: (container, key, value) => {
    if (value !== null) return "cannot resolve a set item";
    container.add(key);
    return "";
  },
  has: (container, key) => container.has(key),
  keys: (container) => container.keys(),
  get: () => null
});
function createTagDefinitionMap() {
  return {
    scalar: /* @__PURE__ */ Object.create(null),
    sequence: /* @__PURE__ */ Object.create(null),
    mapping: /* @__PURE__ */ Object.create(null)
  };
}
function createTagDefinitionListMap() {
  return {
    scalar: [],
    sequence: [],
    mapping: []
  };
}
function compileTags(tags) {
  const result = [];
  for (const tag of tags) {
    let index = result.length;
    for (let previousIndex = 0; previousIndex < result.length; previousIndex++) {
      const previous = result[previousIndex];
      if (previous.nodeKind === tag.nodeKind && previous.tagName === tag.tagName && previous.matchByTagPrefix === tag.matchByTagPrefix) {
        index = previousIndex;
        break;
      }
    }
    result[index] = tag;
  }
  return result;
}
var Schema = class Schema2 {
  tags;
  /** @internal */
  implicitScalarTags;
  /**
  * Dispatch implicit scalar resolvers by `source.charAt(0)`. Each bucket holds
  * the resolvers that may match that key, in schema order; a key absent from
  * the map uses
  * {@link Schema.implicitScalarAnyFirstChar}
  * (resolvers that declared no first-char constraint, so they apply to any
  * first character).
  */
  implicitScalarByFirstChar;
  implicitScalarAnyFirstChar;
  /**
  * The default scalar tag (`!!str`), resolved once so the composer's fallback
  * for unresolved plain scalars avoids a keyed lookup per scalar.
  *
  * @internal
  */
  defaultScalarTag;
  /**
  * The default container tags (`!!seq` / `!!map`), used by the dumper: when a
  * value is identified by its default tag, the tag is implicit and not
  * printed. Undefined if the schema does not define them (then such values
  * can't be dumped).
  *
  * @internal
  */
  defaultSequenceTag;
  /** @internal */
  defaultMappingTag;
  exact;
  prefix;
  constructor(tags) {
    const compiledTags = compileTags(tags);
    const implicitScalarTags = [];
    const exact = createTagDefinitionMap();
    const prefix = createTagDefinitionListMap();
    for (const tag of compiledTags) {
      if (tag.nodeKind === "scalar" && tag.implicit) {
        if (tag.matchByTagPrefix) throw new Error("Implicit scalar tags cannot match by tag prefix");
        implicitScalarTags.push(tag);
      }
      switch (tag.nodeKind) {
        case "scalar":
          if (tag.matchByTagPrefix) prefix.scalar.push(tag);
          else exact.scalar[tag.tagName] = tag;
          break;
        case "sequence":
          if (tag.matchByTagPrefix) prefix.sequence.push(tag);
          else exact.sequence[tag.tagName] = tag;
          break;
        case "mapping":
          if (tag.matchByTagPrefix) prefix.mapping.push(tag);
          else exact.mapping[tag.tagName] = tag;
      }
    }
    const implicitScalarAnyFirstChar = implicitScalarTags.filter((tag) => tag.implicitFirstChars === null);
    const keys = /* @__PURE__ */ new Set();
    for (const tag of implicitScalarTags) if (tag.implicitFirstChars !== null) for (const key of tag.implicitFirstChars) keys.add(key);
    const implicitScalarByFirstChar = /* @__PURE__ */ new Map();
    for (const key of keys) implicitScalarByFirstChar.set(key, implicitScalarTags.filter((tag) => tag.implicitFirstChars === null || tag.implicitFirstChars.indexOf(key) !== -1));
    const defaultScalarTag = exact.scalar["tag:yaml.org,2002:str"];
    if (!defaultScalarTag) throw new Error("schema does not define the default scalar tag (tag:yaml.org,2002:str)");
    this.tags = compiledTags;
    this.implicitScalarTags = implicitScalarTags;
    this.implicitScalarByFirstChar = implicitScalarByFirstChar;
    this.implicitScalarAnyFirstChar = implicitScalarAnyFirstChar;
    this.defaultScalarTag = defaultScalarTag;
    this.defaultSequenceTag = exact.sequence["tag:yaml.org,2002:seq"];
    this.defaultMappingTag = exact.mapping["tag:yaml.org,2002:map"];
    this.exact = exact;
    this.prefix = prefix;
  }
  /** @internal */
  lookupScalarTag(tagName) {
    const exactTag = this.exact.scalar[tagName];
    if (exactTag) return exactTag;
    for (const tag of this.prefix.scalar) if (tagName.startsWith(tag.tagName)) return tag;
  }
  /** @internal */
  lookupSequenceTag(tagName) {
    const exactTag = this.exact.sequence[tagName];
    if (exactTag) return exactTag;
    for (const tag of this.prefix.sequence) if (tagName.startsWith(tag.tagName)) return tag;
  }
  /** @internal */
  lookupMappingTag(tagName) {
    const exactTag = this.exact.mapping[tagName];
    if (exactTag) return exactTag;
    for (const tag of this.prefix.mapping) if (tagName.startsWith(tag.tagName)) return tag;
  }
  /** @internal */
  resolveImplicitScalarTag(source) {
    const candidates = this.implicitScalarByFirstChar.get(source.charAt(0)) ?? this.implicitScalarAnyFirstChar;
    for (const tag2 of candidates) {
      const value = tag2.resolve(source, false, tag2.tagName);
      if (value !== NOT_RESOLVED) return {
        value,
        tag: tag2
      };
    }
    const tag = this.defaultScalarTag;
    return {
      value: tag.resolve(source, false, tag.tagName),
      tag
    };
  }
  /**
  * Creates a new schema with the specified tags added. If a tag already
  * exists, it is replaced by the specified tag.
  *
  * @example
  *
  * ```javascript
  * import { CORE_SCHEMA, mergeTag, realMapTag } from 'js-yaml'
  *
  * const schema = CORE_SCHEMA.withTags(mergeTag, realMapTag)
  * ```
  */
  withTags(...tags) {
    let flatTags = [];
    for (const tag of tags) flatTags = flatTags.concat(tag);
    return new Schema2([...this.tags, ...flatTags]);
  }
};
var FAILSAFE_SCHEMA = new Schema([
  strTag,
  seqTag,
  mapTag
]);
var JSON_SCHEMA = new Schema([
  ...FAILSAFE_SCHEMA.tags,
  nullJsonTag,
  boolJsonTag,
  intJsonTag,
  floatJsonTag
]);
var CORE_SCHEMA = new Schema([
  ...FAILSAFE_SCHEMA.tags,
  nullCoreTag,
  boolCoreTag,
  intCoreTag,
  floatCoreTag
]);
var YAML11_SCHEMA = new Schema([
  ...FAILSAFE_SCHEMA.tags,
  nullYaml11Tag,
  boolYaml11Tag,
  intYaml11Tag,
  floatYaml11Tag,
  timestampTag,
  mergeTag,
  binaryTag,
  omapTag,
  pairsTag,
  setTag
]);
var DUMP_SCHEMA = YAML11_SCHEMA.withTags({
  ...intYaml11Tag,
  resolve: (source, isExplicit, tagName) => {
    const result = intYaml11Tag.resolve(source, isExplicit, tagName);
    return result === NOT_RESOLVED ? intCoreTag.resolve(source, isExplicit, tagName) : result;
  }
}, {
  ...floatYaml11Tag,
  resolve: (source, isExplicit, tagName) => {
    const result = floatYaml11Tag.resolve(source, isExplicit, tagName);
    return result === NOT_RESOLVED ? floatCoreTag.resolve(source, isExplicit, tagName) : result;
  }
});
var realMapTag = defineMappingTag("tag:yaml.org,2002:map", {
  create: () => /* @__PURE__ */ new Map(),
  addPair: (container, key, value) => {
    container.set(key, value);
    return "";
  },
  has: (container, key) => container.has(key),
  keys: (container) => container.keys(),
  get: (container, key) => container.get(key),
  identify: (data) => data instanceof Map || isPlainObject(data),
  represent: (data) => {
    if (data instanceof Map) return data;
    const map = /* @__PURE__ */ new Map();
    const obj = data;
    for (const key of Object.keys(obj)) map.set(key, obj[key]);
    return map;
  }
});
function normalizeKey(key) {
  if (Array.isArray(key)) {
    const array = Array.prototype.slice.call(key);
    for (let index = 0; index < array.length; index++) {
      if (Array.isArray(array[index])) return null;
      if (typeof array[index] === "object" && Object.prototype.toString.call(array[index]) === "[object Object]") array[index] = "[object Object]";
    }
    return String(array);
  }
  if (typeof key === "object" && Object.prototype.toString.call(key) === "[object Object]") return "[object Object]";
  return String(key);
}
var legacyMapTag = defineMappingTag("tag:yaml.org,2002:map", {
  create: () => ({}),
  identify: isPlainObject,
  represent: (o) => {
    const map = /* @__PURE__ */ new Map();
    for (const key of Object.keys(o)) map.set(key, o[key]);
    return map;
  },
  addPair: (container, key, value) => {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey === null) return "nested arrays are not supported inside keys";
    if (normalizedKey === "__proto__") Object.defineProperty(container, normalizedKey, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    else container[normalizedKey] = value;
    return "";
  },
  has: (container, key) => {
    const normalizedKey = normalizeKey(key);
    return normalizedKey !== null && Object.prototype.hasOwnProperty.call(container, normalizedKey);
  },
  keys: (container) => Object.keys(container),
  get: (container, key) => {
    const normalizedKey = String(key);
    if (!Object.prototype.hasOwnProperty.call(container, normalizedKey)) return null;
    return container[normalizedKey];
  }
});
var DEFAULT_SNIPPET_OPTIONS = {
  maxLength: 79,
  indent: 1,
  linesBefore: 3,
  linesAfter: 2
};
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  let head = "";
  let tail = "";
  const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
  };
}
function padStart(string, max) {
  return " ".repeat(Math.max(max - string.length, 0)) + string;
}
function makeSnippet(mark, options) {
  if (!mark.buffer) return null;
  const opts = {
    ...DEFAULT_SNIPPET_OPTIONS,
    ...options
  };
  const re = /\r?\n|\r|\0/g;
  const lineStarts = [0];
  const lineEnds = [];
  let match;
  let foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) foundLineNo = lineStarts.length - 2;
  }
  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
  let result = "";
  const lineNoLength = Math.min(mark.line + opts.linesAfter, lineEnds.length).toString().length;
  const maxLineLength = opts.maxLength - (opts.indent + lineNoLength + 3);
  for (let i = 1; i <= opts.linesBefore; i++) {
    if (foundLineNo - i < 0) break;
    const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
    result = `${" ".repeat(opts.indent)}${padStart((mark.line - i + 1).toString(), lineNoLength)} | ${line2.str}
${result}`;
  }
  const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += `${" ".repeat(opts.indent)}${padStart((mark.line + 1).toString(), lineNoLength)} | ${line.str}
`;
  result += `${"-".repeat(opts.indent + lineNoLength + 3 + line.pos)}^
`;
  for (let i = 1; i <= opts.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break;
    const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
    result += `${" ".repeat(opts.indent)}${padStart((mark.line + i + 1).toString(), lineNoLength)} | ${line2.str}
`;
  }
  return result.replace(/\n$/, "");
}
function formatError(exception, compact) {
  let where = "";
  if (!exception.mark) return exception.reason;
  if (exception.mark.name) where += `in "${exception.mark.name}" `;
  where += `(${exception.mark.line + 1}:${exception.mark.column + 1})`;
  if (!compact && exception.mark.snippet) where += `

${exception.mark.snippet}`;
  return `${exception.reason} ${where}`;
}
var YAMLException = class YAMLException2 extends Error {
  reason;
  mark;
  /**
  * Optional `mark` contains source snippet data. Usually, use
  * {@link YAMLException.throwAt} instead of passing it directly.
  */
  constructor(reason, mark) {
    super();
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
  /**
  * Returns the formatted error, omitting the source snippet in compact mode.
  */
  toString(compact) {
    return `${this.name}: ${formatError(this, compact)}`;
  }
  /**
  * Builds a YAMLException with a source snippet and throws it. `source` is
  * the raw input text; `position` is an offset into it.
  */
  static throwAt(source, position, message, filename = "") {
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < position; index++) {
      const ch = source.charCodeAt(index);
      if (ch === 10) {
        line++;
        lineStart = index + 1;
      } else if (ch === 13) {
        line++;
        if (source.charCodeAt(index + 1) === 10) index++;
        lineStart = index + 1;
      }
    }
    const mark = {
      name: filename,
      buffer: source,
      position,
      line,
      column: position - lineStart
    };
    mark.snippet = makeSnippet(mark);
    throw new YAMLException2(message, mark);
  }
};
var EVENT_ID = {
  DOCUMENT: 1,
  SEQUENCE: 2,
  MAPPING: 3,
  SCALAR: 4,
  ALIAS: 5,
  POP: 6
};
var SCALAR_STYLE = {
  PLAIN: 1,
  SINGLE_QUOTED: 2,
  DOUBLE_QUOTED: 3,
  LITERAL_BLOCK: 4,
  FOLDED_BLOCK: 5
};
var COLLECTION_STYLE = {
  BLOCK: 1,
  FLOW: 2
};
var CHOMPING_MODE = {
  CLIP: 1,
  STRIP: 2,
  KEEP: 3
};
var NO_RANGE$3 = -1;
function simpleEscapeSequence(c) {
  switch (c) {
    case 48:
      return "\0";
    case 97:
      return "\x07";
    case 98:
      return "\b";
    case 116:
      return "	";
    case 9:
      return "	";
    case 110:
      return "\n";
    case 118:
      return "\v";
    case 102:
      return "\f";
    case 114:
      return "\r";
    case 101:
      return "\x1B";
    case 32:
      return " ";
    case 34:
      return '"';
    case 47:
      return "/";
    case 92:
      return "\\";
    case 78:
      return "\x85";
    case 95:
      return "\xA0";
    case 76:
      return "\u2028";
    case 80:
      return "\u2029";
    default:
      return "";
  }
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (let i = 0; i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
function charFromCodepoint(c) {
  if (c <= 65535) return String.fromCharCode(c);
  return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
}
function fromHexCode$1(c) {
  if (c >= 48 && c <= 57) return c - 48;
  return (c | 32) - 97 + 10;
}
function escapedHexLen$1(c) {
  if (c === 120) return 2;
  if (c === 117) return 4;
  return 8;
}
function skipFoldedBreaks(input, position, end) {
  let breaks = 0;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 10) {
      breaks++;
      position++;
    } else if (ch === 13) {
      breaks++;
      position++;
      if (input.charCodeAt(position) === 10) position++;
    } else if (ch === 32 || ch === 9) position++;
    else break;
  }
  return {
    position,
    breaks
  };
}
function foldedBreaks(count) {
  if (count === 1) return " ";
  return "\n".repeat(count - 1);
}
function getPlainValue(input, start, end) {
  let result = "";
  let position = start;
  let captureStart = start;
  let captureEnd = start;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 10 || ch === 13) {
      result += input.slice(captureStart, captureEnd);
      const fold = skipFoldedBreaks(input, position, end);
      result += foldedBreaks(fold.breaks);
      position = captureStart = captureEnd = fold.position;
    } else {
      position++;
      if (ch !== 32 && ch !== 9) captureEnd = position;
    }
  }
  return result + input.slice(captureStart, captureEnd);
}
function getSingleQuotedValue(input, start, end) {
  let result = "";
  let position = start;
  let captureStart = start;
  let captureEnd = start;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 39) {
      result += input.slice(captureStart, position) + "'";
      position += 2;
      captureStart = captureEnd = position;
    } else if (ch === 10 || ch === 13) {
      result += input.slice(captureStart, captureEnd);
      const fold = skipFoldedBreaks(input, position, end);
      result += foldedBreaks(fold.breaks);
      position = captureStart = captureEnd = fold.position;
    } else {
      position++;
      if (ch !== 32 && ch !== 9) captureEnd = position;
    }
  }
  return result + input.slice(captureStart, end);
}
function getDoubleQuotedValue(input, start, end) {
  let result = "";
  let position = start;
  let captureStart = start;
  let captureEnd = start;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 92) {
      result += input.slice(captureStart, position);
      position++;
      const escaped = input.charCodeAt(position);
      if (escaped === 10 || escaped === 13) position = skipFoldedBreaks(input, position, end).position;
      else if (escaped < 256 && simpleEscapeCheck[escaped]) {
        result += simpleEscapeMap[escaped];
        position++;
      } else {
        let hexLength = escapedHexLen$1(escaped);
        let hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          position++;
          const digit = fromHexCode$1(input.charCodeAt(position));
          hexResult = (hexResult << 4) + digit;
        }
        result += charFromCodepoint(hexResult);
        position++;
      }
      captureStart = captureEnd = position;
    } else if (ch === 10 || ch === 13) {
      result += input.slice(captureStart, captureEnd);
      const fold = skipFoldedBreaks(input, position, end);
      result += foldedBreaks(fold.breaks);
      position = captureStart = captureEnd = fold.position;
    } else {
      position++;
      if (ch !== 32 && ch !== 9) captureEnd = position;
    }
  }
  return result + input.slice(captureStart, end);
}
function getBlockValue(input, start, end, indent, chomping, folded) {
  const textIndent = indent < 0 ? 0 : indent;
  const region = input.slice(start, end).replace(/\r\n?/g, "\n");
  const lines = region === "" ? [] : (region.endsWith("\n") ? region.slice(0, -1) : region).split("\n");
  let result = "";
  let didReadContent = false;
  let emptyLines = 0;
  let atMoreIndented = false;
  for (const line of lines) {
    let column = 0;
    while (column < textIndent && line.charCodeAt(column) === 32) column++;
    if (indent < 0 || column >= line.length) {
      emptyLines++;
      continue;
    }
    const content = line.slice(textIndent);
    const first = content.charCodeAt(0);
    if (folded) {
      if (first === 32 || first === 9) {
        atMoreIndented = true;
        result += "\n".repeat(didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        result += "\n".repeat(emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) result += " ";
      } else result += "\n".repeat(emptyLines);
    } else result += "\n".repeat(didReadContent ? 1 + emptyLines : emptyLines);
    result += content;
    didReadContent = true;
    emptyLines = 0;
  }
  if (chomping === CHOMPING_MODE.KEEP) result += "\n".repeat(didReadContent ? 1 + emptyLines : emptyLines);
  else if (chomping !== CHOMPING_MODE.STRIP) {
    if (didReadContent) result += "\n";
  }
  return result;
}
function getScalarValue(input, scalar) {
  if (scalar.valueStart === NO_RANGE$3) return "";
  const { valueStart, valueEnd } = scalar;
  if (scalar.fast) return input.slice(valueStart, valueEnd);
  switch (scalar.style) {
    case SCALAR_STYLE.SINGLE_QUOTED:
      return getSingleQuotedValue(input, valueStart, valueEnd);
    case SCALAR_STYLE.DOUBLE_QUOTED:
      return getDoubleQuotedValue(input, valueStart, valueEnd);
    case SCALAR_STYLE.LITERAL_BLOCK:
      return getBlockValue(input, valueStart, valueEnd, scalar.indent, scalar.chomping, false);
    case SCALAR_STYLE.FOLDED_BLOCK:
      return getBlockValue(input, valueStart, valueEnd, scalar.indent, scalar.chomping, true);
    default:
      return getPlainValue(input, valueStart, valueEnd);
  }
}
var DEFAULT_TAG_HANDLERS = Object.assign(/* @__PURE__ */ Object.create(null), {
  "!": "!",
  "!!": "tag:yaml.org,2002:"
});
var TAG_SUFFIX_CHARS = "-#;/?:@&=+$_.~*'()";
var TAG_URI_CHARS = TAG_SUFFIX_CHARS + "!,[]";
function tagPercentDecode(source) {
  let result = "";
  let index = 0;
  while (index < source.length) {
    if (source.charCodeAt(index) !== 37) {
      result += source[index++];
      continue;
    }
    let ch = parseInt(source.slice(index + 1, index + 3), 16);
    index += 3;
    if (ch >= 192) {
      let remaining = ch < 224 ? 1 : ch < 240 ? 2 : 3;
      ch &= (1 << 6 - remaining) - 1;
      while (remaining-- > 0) {
        ch = ch << 6 | parseInt(source.slice(index + 1, index + 3), 16) & 63;
        index += 3;
      }
    }
    if (ch < 65536) result += String.fromCharCode(ch);
    else {
      ch -= 65536;
      result += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
    }
  }
  return result;
}
function tagNameFull(rawTag, tagHandlers) {
  if (rawTag.startsWith("!<") && rawTag.endsWith(">")) return tagPercentDecode(rawTag.slice(2, -1));
  const handleEnd = rawTag.indexOf("!", 1);
  const handle = handleEnd === -1 ? "!" : rawTag.slice(0, handleEnd + 1);
  return tagPercentDecode(tagHandlers?.[handle] ?? DEFAULT_TAG_HANDLERS[handle] ?? handle) + tagPercentDecode(rawTag.slice(handle.length));
}
var NO_RANGE$2 = -1;
var MERGE_TAG_NAME = "tag:yaml.org,2002:merge";
var DEFAULT_CONSTRUCTOR_OPTIONS = {
  filename: "",
  schema: CORE_SCHEMA,
  json: false,
  maxTotalMergeKeys: 1e4,
  maxAliases: -1
};
function eventPosition$1(event) {
  if ("tagStart" in event && event.tagStart !== NO_RANGE$2) return event.tagStart;
  if ("anchorStart" in event && event.anchorStart !== NO_RANGE$2) return event.anchorStart;
  if ("valueStart" in event && event.valueStart !== NO_RANGE$2) return event.valueStart;
  if ("start" in event) return event.start;
  return 0;
}
function throwError$1(state, message) {
  YAMLException.throwAt(state.source, state.position, message, state.filename);
}
function finalizeCollection(state, position, tag, carrier) {
  try {
    return tag.finalize(carrier);
  } catch (error) {
    if (error instanceof YAMLException) throw error;
    YAMLException.throwAt(state.source, position, error instanceof Error ? error.message : String(error), state.filename);
  }
}
function constructScalar(state, event) {
  const source = getScalarValue(state.source, event);
  const rawTag = event.tagStart === NO_RANGE$2 ? "" : state.source.slice(event.tagStart, event.tagEnd);
  const strTag2 = state.schema.defaultScalarTag;
  if (rawTag !== "") {
    if (rawTag === "!") return {
      value: source,
      tag: strTag2
    };
    const tagName = tagNameFull(rawTag, state.tagHandlers);
    const scalarTag = state.schema.lookupScalarTag(tagName);
    if (scalarTag) {
      const result = scalarTag.resolve(source, true, tagName);
      if (result === NOT_RESOLVED) throwError$1(state, `cannot resolve a node with !<${tagName}> explicit tag`);
      return {
        value: result,
        tag: scalarTag
      };
    }
    const collectionTagDef = state.schema.lookupMappingTag(tagName) ?? state.schema.lookupSequenceTag(tagName);
    if (collectionTagDef) {
      if (source !== "") throwError$1(state, `cannot resolve a node with !<${tagName}> explicit tag`);
      const carrier = collectionTagDef.create(tagName);
      return {
        value: collectionTagDef.carrierIsResult ? carrier : finalizeCollection(state, state.position, collectionTagDef, carrier),
        tag: collectionTagDef
      };
    }
    throwError$1(state, `unknown scalar tag !<${tagName}>`);
  }
  if (event.style === SCALAR_STYLE.PLAIN) return state.schema.resolveImplicitScalarTag(source);
  return {
    value: strTag2.resolve(source, false, strTag2.tagName),
    tag: strTag2
  };
}
function collectionTagName(state, event, defaultTagName) {
  const rawTag = event.tagStart === NO_RANGE$2 ? "" : state.source.slice(event.tagStart, event.tagEnd);
  return rawTag === "" || rawTag === "!" ? defaultTagName : tagNameFull(rawTag, state.tagHandlers);
}
function isMappingTag(tag) {
  return tag.nodeKind === "mapping";
}
function chargeMergeWork(state) {
  state.totalMergeKeys++;
  if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) throwError$1(state, `merge keys exceeded maxTotalMergeKeys (${state.maxTotalMergeKeys})`);
}
function mergeKeys(state, frame, source, sourceTag) {
  chargeMergeWork(state);
  for (const sourceKey of sourceTag.keys(source)) {
    chargeMergeWork(state);
    if (frame.tag.has(frame.value, sourceKey)) continue;
    const err = frame.tag.addPair(frame.value, sourceKey, sourceTag.get(source, sourceKey));
    if (err) throwError$1(state, err);
    frame.overridable ??= /* @__PURE__ */ new Set();
    frame.overridable.add(sourceKey);
  }
}
function mergeSource(state, frame, source, sourceTag) {
  state.position = frame.keyPosition;
  if (isMappingTag(sourceTag)) mergeKeys(state, frame, source, sourceTag);
  else if (sourceTag.nodeKind === "sequence" && Array.isArray(source)) {
    if (source.length > 100) throwError$1(state, "abnormal merge sequence size");
    for (const element of source) {
      const elementTag = state.nodeTags.get(element);
      if (!elementTag) throwError$1(state, "cannot merge mappings; the provided source object is unacceptable");
      mergeKeys(state, frame, element, elementTag);
    }
  } else throwError$1(state, "cannot merge mappings; the provided source object is unacceptable");
}
function addMappingValue(state, frame, key, value, tag) {
  state.position = frame.keyPosition;
  if (frame.keyIsMerge) {
    mergeSource(state, frame, value, tag);
    return;
  }
  if (!state.json && frame.tag.has(frame.value, key) && !frame.overridable?.has(key)) throwError$1(state, "duplicated mapping key");
  const err = frame.tag.addPair(frame.value, key, value);
  if (err) throwError$1(state, err);
  frame.overridable?.delete(key);
}
function addValue(state, value, tag) {
  const frame = state.frames[state.frames.length - 1];
  if (frame.kind === "document") {
    frame.value = value;
    frame.hasValue = true;
  } else if (frame.kind === "sequence") {
    if (isMappingTag(tag)) state.nodeTags.set(value, tag);
    const err = frame.tag.addItem(frame.value, value, frame.index++);
    if (err) throwError$1(state, err);
  } else if (frame.hasKey) {
    const key = frame.key;
    frame.key = void 0;
    frame.hasKey = false;
    addMappingValue(state, frame, key, value, tag);
  } else {
    frame.key = value;
    frame.keyPosition = state.position;
    frame.hasKey = true;
    frame.keyIsMerge = tag.tagName === MERGE_TAG_NAME;
  }
}
function storeAnchor(state, event, value, tag, isValueFinal) {
  if (event.anchorStart !== NO_RANGE$2) {
    const anchor = {
      value,
      tag,
      isValueFinal
    };
    state.anchors.set(state.source.slice(event.anchorStart, event.anchorEnd), anchor);
    return anchor;
  }
  return null;
}
function constructFromEvents(events, options) {
  const state = {
    ...DEFAULT_CONSTRUCTOR_OPTIONS,
    ...options,
    events,
    documents: [],
    eventIndex: 0,
    position: 0,
    frames: [],
    anchors: /* @__PURE__ */ new Map(),
    nodeTags: /* @__PURE__ */ new Map(),
    tagHandlers: /* @__PURE__ */ Object.create(null),
    totalMergeKeys: 0,
    aliasCount: 0
  };
  while (state.eventIndex < state.events.length) {
    const event = state.events[state.eventIndex++];
    state.position = eventPosition$1(event);
    switch (event.type) {
      case EVENT_ID.DOCUMENT:
        state.anchors = /* @__PURE__ */ new Map();
        state.nodeTags = /* @__PURE__ */ new Map();
        state.aliasCount = 0;
        state.tagHandlers = /* @__PURE__ */ Object.create(null);
        for (const directive of event.directives) if (directive.kind === "tag") state.tagHandlers[directive.handle] = directive.prefix;
        state.frames.push({
          kind: "document",
          position: state.position,
          value: void 0,
          hasValue: false
        });
        break;
      case EVENT_ID.SCALAR: {
        const { value, tag } = constructScalar(state, event);
        storeAnchor(state, event, value, tag, true);
        addValue(state, value, tag);
        break;
      }
      case EVENT_ID.SEQUENCE: {
        const tagName = collectionTagName(state, event, "tag:yaml.org,2002:seq");
        const tag = state.schema.lookupSequenceTag(tagName);
        if (!tag) throwError$1(state, `unknown sequence tag !<${tagName}>`);
        const value = tag.create(tagName);
        const anchor = storeAnchor(state, event, value, tag, tag.carrierIsResult);
        state.frames.push({
          kind: "sequence",
          position: state.position,
          value,
          tag,
          anchor,
          index: 0
        });
        break;
      }
      case EVENT_ID.MAPPING: {
        const tagName = collectionTagName(state, event, "tag:yaml.org,2002:map");
        const tag = state.schema.lookupMappingTag(tagName);
        if (!tag) throwError$1(state, `unknown mapping tag !<${tagName}>`);
        const value = tag.create(tagName);
        const anchor = storeAnchor(state, event, value, tag, tag.carrierIsResult);
        state.frames.push({
          kind: "mapping",
          position: state.position,
          value,
          tag,
          anchor,
          key: void 0,
          keyPosition: state.position,
          hasKey: false,
          keyIsMerge: false,
          overridable: null
        });
        break;
      }
      case EVENT_ID.ALIAS: {
        if (state.maxAliases !== -1 && ++state.aliasCount > state.maxAliases) throwError$1(state, `aliases exceeded maxAliases (${state.maxAliases})`);
        const name = state.source.slice(event.anchorStart, event.anchorEnd);
        const anchor = state.anchors.get(name);
        if (!anchor) throwError$1(state, `unidentified alias "${name}"`);
        if (!anchor.isValueFinal) throwError$1(state, `recursive alias "${name}" is not supported for tag ${anchor.tag.tagName} because it uses finalize()`);
        addValue(state, anchor.value, anchor.tag);
        break;
      }
      case EVENT_ID.POP: {
        const frame = state.frames.pop();
        if (frame.kind === "mapping" && frame.hasKey) {
          state.position = frame.keyPosition;
          throwError$1(state, "incomplete mapping pair in event stream");
        }
        if (frame.kind === "document") state.documents.push(frame.value);
        else {
          const value = frame.tag.carrierIsResult ? frame.value : finalizeCollection(state, frame.position, frame.tag, frame.value);
          if (frame.anchor) {
            frame.anchor.value = value;
            frame.anchor.isValueFinal = true;
          }
          addValue(state, value, frame.tag);
        }
        break;
      }
    }
  }
  return state.documents;
}
var NO_RANGE$1 = -1;
var HAS_OWN = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
var NS_URI_CHAR = String.raw`(?:%[0-9A-Fa-f]{2}|[0-9A-Za-z\-#;/?:@&=+$,_.!~*'()\[\]])`;
var NS_TAG_CHAR = String.raw`(?:%[0-9A-Fa-f]{2}|[0-9A-Za-z\-#;/?:@&=+$.~*'()_])`;
var PATTERN_TAG_URI = new RegExp(`^(?:${NS_URI_CHAR})*$`);
var PATTERN_TAG_SUFFIX = new RegExp(`^(?:${NS_TAG_CHAR})+$`);
var PATTERN_TAG_PREFIX = new RegExp(`^(?:!(?:${NS_URI_CHAR})*|${NS_TAG_CHAR}(?:${NS_URI_CHAR})*)$`);
var DEFAULT_PARSER_OPTIONS = {
  filename: "",
  maxDepth: 100
};
function addDocumentEvent(state, explicitStart, explicitEnd) {
  state.events.push({
    type: EVENT_ID.DOCUMENT,
    explicitStart,
    explicitEnd,
    directives: state.directives
  });
}
function addSequenceEvent(state, start, anchorStart, anchorEnd, tagStart, tagEnd, style) {
  state.events.push({
    type: EVENT_ID.SEQUENCE,
    start,
    anchorStart,
    anchorEnd,
    tagStart,
    tagEnd,
    style
  });
}
function addMappingEvent(state, start, anchorStart, anchorEnd, tagStart, tagEnd, style) {
  state.events.push({
    type: EVENT_ID.MAPPING,
    start,
    anchorStart,
    anchorEnd,
    tagStart,
    tagEnd,
    style
  });
}
function insertFlowPairMappingEvent(state, snapshot) {
  state.events.splice(snapshot.eventsLength, 0, {
    type: EVENT_ID.MAPPING,
    start: snapshot.position,
    anchorStart: NO_RANGE$1,
    anchorEnd: NO_RANGE$1,
    tagStart: NO_RANGE$1,
    tagEnd: NO_RANGE$1,
    style: COLLECTION_STYLE.FLOW
  });
}
function addScalarEvent(state, valueStart, valueEnd, anchorStart, anchorEnd, tagStart, tagEnd, style, chomping = CHOMPING_MODE.CLIP, indent = -1, fast = false) {
  state.events.push({
    type: EVENT_ID.SCALAR,
    valueStart,
    valueEnd,
    anchorStart,
    anchorEnd,
    tagStart,
    tagEnd,
    style,
    chomping,
    indent,
    fast
  });
}
function addAliasEvent(state, anchorStart, anchorEnd) {
  state.events.push({
    type: EVENT_ID.ALIAS,
    anchorStart,
    anchorEnd
  });
}
function addPopEvent(state) {
  state.events.push({ type: EVENT_ID.POP });
}
function addEmptyScalarEvent(state) {
  addScalarEvent(state, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, SCALAR_STYLE.PLAIN);
}
function emptyProperties() {
  return {
    anchorStart: NO_RANGE$1,
    anchorEnd: NO_RANGE$1,
    tagStart: NO_RANGE$1,
    tagEnd: NO_RANGE$1
  };
}
function snapshotState(state) {
  return {
    position: state.position,
    line: state.line,
    lineStart: state.lineStart,
    lineIndent: state.lineIndent,
    firstTabInLine: state.firstTabInLine,
    eventsLength: state.events.length
  };
}
function restoreState(state, snapshot) {
  state.position = snapshot.position;
  state.line = snapshot.line;
  state.lineStart = snapshot.lineStart;
  state.lineIndent = snapshot.lineIndent;
  state.firstTabInLine = snapshot.firstTabInLine;
  state.events.length = snapshot.eventsLength;
}
function throwError(state, message) {
  YAMLException.throwAt(state.input.slice(0, state.length), state.position, message, state.filename);
}
function isEol(c) {
  return c === 10 || c === 13;
}
function isWhiteSpace(c) {
  return c === 9 || c === 32;
}
function isWsOrEol(c) {
  return isWhiteSpace(c) || isEol(c);
}
function isWsOrEolOrEnd(c) {
  return c === 0 || isWsOrEol(c);
}
function isFlowIndicator(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromDecimalCode(c) {
  return c >= 48 && c <= 57 ? c - 48 : -1;
}
function fromHexCode(c) {
  if (c >= 48 && c <= 57) return c - 48;
  const lc = c | 32;
  if (lc >= 97 && lc <= 102) return lc - 97 + 10;
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) return 2;
  if (c === 117) return 4;
  if (c === 85) return 8;
  return 0;
}
function isSimpleEscape(c) {
  return c === 48 || c === 97 || c === 98 || c === 116 || c === 9 || c === 110 || c === 118 || c === 102 || c === 114 || c === 101 || c === 32 || c === 34 || c === 47 || c === 92 || c === 78 || c === 95 || c === 76 || c === 80;
}
function consumeLineBreak(state) {
  if (state.input.charCodeAt(state.position) === 10) state.position++;
  else {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) state.position++;
  }
  state.line++;
  state.lineStart = state.position;
  state.lineIndent = 0;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments) {
  let lineBreaks = 0;
  let ch = state.input.charCodeAt(state.position);
  let hasSeparation = state.position === state.lineStart || isWsOrEol(state.input.charCodeAt(state.position - 1));
  while (ch !== 0) {
    while (isWhiteSpace(ch)) {
      hasSeparation = true;
      if (ch === 9 && state.firstTabInLine === -1) state.firstTabInLine = state.position;
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && hasSeparation && ch === 35) do
      ch = state.input.charCodeAt(++state.position);
    while (!isEol(ch) && ch !== 0);
    if (!isEol(ch)) break;
    consumeLineBreak(state);
    lineBreaks++;
    hasSeparation = true;
    ch = state.input.charCodeAt(state.position);
    while (ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
  }
  return lineBreaks;
}
function testDocumentSeparator(state, position = state.position) {
  const ch = state.input.charCodeAt(position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(position + 1) && ch === state.input.charCodeAt(position + 2)) {
    const following = state.input.charCodeAt(position + 3);
    return following === 0 || isWsOrEol(following);
  }
  return false;
}
function skipByteOrderMark(state) {
  if (state.position === state.lineStart && state.input.charCodeAt(state.position) === 65279) {
    state.position++;
    state.lineStart = state.position;
  }
}
function testDocumentBoundary(state) {
  if (state.position !== state.lineStart) return false;
  if (testDocumentSeparator(state)) return true;
  if (state.input.charCodeAt(state.position) !== 65279) return false;
  const snapshot = snapshotState(state);
  skipByteOrderMark(state);
  skipSeparationSpace(state, true);
  const ch = state.input.charCodeAt(state.position);
  const result = state.position === state.lineStart && (ch === 37 || ch === 45 && testDocumentSeparator(state));
  restoreState(state, snapshot);
  return result;
}
function skipUntilLineEnd(state) {
  let ch = state.input.charCodeAt(state.position);
  while (ch !== 0 && !isEol(ch)) ch = state.input.charCodeAt(++state.position);
}
function checkPrintable(state, start, end) {
  const match = PATTERN_NON_PRINTABLE.exec(state.input.slice(start, end));
  if (match !== null) {
    state.position = start + match.index + match[0].length - 1;
    throwError(state, "the stream contains non-printable characters");
  }
}
function readTagProperty(state, props, inFlow) {
  if (state.input.charCodeAt(state.position) !== 33) return false;
  if (props.tagStart !== NO_RANGE$1) throwError(state, "duplication of a tag property");
  const start = state.position;
  let isVerbatim = false;
  let isNamed = false;
  let tagHandle = "!";
  let ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  }
  let suffixStart = state.position;
  let tagName;
  if (isVerbatim) {
    while (ch !== 0 && ch !== 62) ch = state.input.charCodeAt(++state.position);
    if (ch !== 62) throwError(state, "unexpected end of the stream within a verbatim tag");
    tagName = state.input.slice(suffixStart, state.position);
    state.position++;
  } else {
    while (ch !== 0 && !isWsOrEol(ch) && !(inFlow && isFlowIndicator(ch))) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(suffixStart - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) throwError(state, "named tag handle cannot contain such characters");
          isNamed = true;
          suffixStart = state.position + 1;
        } else throwError(state, "tag suffix cannot contain exclamation marks");
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(suffixStart, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) throwError(state, "tag suffix cannot contain flow indicator characters");
  }
  if (tagName && !(isVerbatim ? PATTERN_TAG_URI.test(tagName) : PATTERN_TAG_SUFFIX.test(tagName))) throwError(state, `tag name cannot contain such characters: ${tagName}`);
  if (!isVerbatim && tagHandle !== "!" && tagHandle !== "!!" && !HAS_OWN.call(state.tagHandlers, tagHandle)) throwError(state, `undeclared tag handle "${tagHandle}"`);
  props.tagStart = start;
  props.tagEnd = state.position;
  return true;
}
function readAnchorProperty(state, props) {
  if (state.input.charCodeAt(state.position) !== 38) return false;
  if (props.anchorStart !== NO_RANGE$1) throwError(state, "duplication of an anchor property");
  state.position++;
  const start = state.position;
  while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position)) && !isFlowIndicator(state.input.charCodeAt(state.position))) state.position++;
  if (state.position === start) throwError(state, "name of an anchor node must contain at least one character");
  props.anchorStart = start;
  props.anchorEnd = state.position;
  return true;
}
function readAlias(state, props) {
  if (state.input.charCodeAt(state.position) !== 42) return false;
  if (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1) throwError(state, "alias node should not have any properties");
  state.position++;
  const start = state.position;
  while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position)) && !isFlowIndicator(state.input.charCodeAt(state.position))) state.position++;
  if (state.position === start) throwError(state, "name of an alias node must contain at least one character");
  addAliasEvent(state, start, state.position);
  return true;
}
function readFlowScalarBreak(state, nodeIndent) {
  skipSeparationSpace(state, false);
  if (state.lineIndent < nodeIndent) throwError(state, "deficient indentation");
}
function readSingleQuotedScalar(state, nodeIndent, props) {
  if (state.input.charCodeAt(state.position) !== 39) return false;
  state.position++;
  const start = state.position;
  let simple = true;
  while (state.input.charCodeAt(state.position) !== 0) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 39) {
      if (state.input.charCodeAt(state.position + 1) === 39) {
        simple = false;
        state.position += 2;
        continue;
      }
      const end = state.position;
      state.position++;
      addScalarEvent(state, start, end, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.SINGLE_QUOTED, CHOMPING_MODE.CLIP, -1, simple);
      return true;
    }
    if (isEol(ch)) {
      simple = false;
      readFlowScalarBreak(state, nodeIndent);
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a single quoted scalar");
    else if (ch !== 9 && ch < 32) throwError(state, "expected valid JSON character");
    else state.position++;
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent, props) {
  if (state.input.charCodeAt(state.position) !== 34) return false;
  state.position++;
  const start = state.position;
  let simple = true;
  while (state.input.charCodeAt(state.position) !== 0) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 34) {
      const end = state.position;
      state.position++;
      addScalarEvent(state, start, end, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.DOUBLE_QUOTED, CHOMPING_MODE.CLIP, -1, simple);
      return true;
    }
    if (ch === 92) {
      simple = false;
      const escaped = state.input.charCodeAt(++state.position);
      if (isEol(escaped)) readFlowScalarBreak(state, nodeIndent);
      else if (isSimpleEscape(escaped)) state.position++;
      else {
        let hexLength = escapedHexLen(escaped);
        if (hexLength === 0) throwError(state, "unknown escape sequence");
        while (hexLength-- > 0) {
          state.position++;
          if (fromHexCode(state.input.charCodeAt(state.position)) < 0) throwError(state, "expected hexadecimal character");
        }
        state.position++;
      }
    } else if (isEol(ch)) {
      simple = false;
      readFlowScalarBreak(state, nodeIndent);
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a double quoted scalar");
    else if (ch !== 9 && ch < 32) throwError(state, "expected valid JSON character");
    else state.position++;
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readBlockScalar(state, parentIndent, props) {
  const ch = state.input.charCodeAt(state.position);
  let chomping = CHOMPING_MODE.CLIP;
  let indent = -1;
  let detectedIndent = false;
  if (ch !== 124 && ch !== 62) return false;
  const style = ch === 124 ? SCALAR_STYLE.LITERAL_BLOCK : SCALAR_STYLE.FOLDED_BLOCK;
  state.position++;
  while (state.input.charCodeAt(state.position) !== 0) {
    const current = state.input.charCodeAt(state.position);
    const digit = fromDecimalCode(current);
    if (current === 43 || current === 45) {
      if (chomping !== CHOMPING_MODE.CLIP) throwError(state, "repeat of a chomping mode identifier");
      chomping = current === 43 ? CHOMPING_MODE.KEEP : CHOMPING_MODE.STRIP;
      state.position++;
    } else if (digit >= 0) {
      if (digit === 0) throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      if (detectedIndent) throwError(state, "repeat of an indentation width identifier");
      indent = parentIndent + digit - 1;
      detectedIndent = true;
      state.position++;
    } else break;
  }
  let hadWhitespace = false;
  while (isWhiteSpace(state.input.charCodeAt(state.position))) {
    hadWhitespace = true;
    state.position++;
  }
  if (hadWhitespace && state.input.charCodeAt(state.position) === 35) skipUntilLineEnd(state);
  if (isEol(state.input.charCodeAt(state.position))) consumeLineBreak(state);
  else if (state.input.charCodeAt(state.position) !== 0) throwError(state, "a line break is expected");
  let contentIndent = detectedIndent ? indent : -1;
  let maxLeadingIndent = 0;
  const valueStart = state.position;
  let valueEnd = state.position;
  while (state.input.charCodeAt(state.position) !== 0) {
    const linePosition = state.position;
    let column = 0;
    while (state.input.charCodeAt(linePosition + column) === 32) column++;
    const first = state.input.charCodeAt(linePosition + column);
    if (first === 0) {
      if (contentIndent >= 0) {
        if (column > contentIndent) valueEnd = linePosition + column;
      } else if (column > 0) valueEnd = linePosition + column;
      break;
    }
    if (testDocumentBoundary(state)) break;
    if (!detectedIndent && contentIndent === -1 && isEol(first)) maxLeadingIndent = Math.max(maxLeadingIndent, column);
    if (!detectedIndent && contentIndent === -1 && !isEol(first)) {
      if (first === 9 && column < parentIndent) {
        state.position = linePosition + column;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (column >= parentIndent && column < maxLeadingIndent) {
        state.position = linePosition + column;
        throwError(state, "bad indentation of a mapping entry");
      }
    }
    if (contentIndent === -1 && first !== 0 && !isEol(first) && column < parentIndent) {
      state.lineIndent = column;
      state.position = linePosition + column;
      break;
    }
    if (!detectedIndent && first !== 0 && !isEol(first) && contentIndent === -1) contentIndent = column;
    const requiredIndent = contentIndent === -1 ? parentIndent + 1 : contentIndent;
    if (first !== 0 && !isEol(first) && column < requiredIndent) {
      state.lineIndent = column;
      state.position = linePosition + column;
      break;
    }
    skipUntilLineEnd(state);
    valueEnd = state.position;
    if (isEol(state.input.charCodeAt(state.position))) {
      consumeLineBreak(state);
      valueEnd = state.position;
    }
  }
  checkPrintable(state, valueStart, valueEnd);
  addScalarEvent(state, valueStart, valueEnd, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, style, chomping, contentIndent);
  return true;
}
function canStartPlainScalar(state, nodeContext) {
  const ch = state.input.charCodeAt(state.position);
  const inFlow = nodeContext === CONTEXT_FLOW_IN;
  if (ch === 0 || isWsOrEol(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96 || isFlowIndicator(ch)) return false;
  if (ch === 63 || ch === 45) {
    const following = state.input.charCodeAt(state.position + 1);
    if (isWsOrEolOrEnd(following) || inFlow && isFlowIndicator(following)) return false;
  }
  return true;
}
function readPlainScalar(state, nodeIndent, nodeContext, props) {
  if (!canStartPlainScalar(state, nodeContext)) return false;
  const start = state.position;
  let end = state.position;
  let ch = state.input.charCodeAt(state.position);
  const inFlow = nodeContext === CONTEXT_FLOW_IN;
  let multiline = false;
  while (ch !== 0) {
    if (testDocumentBoundary(state)) break;
    if (ch === 58) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEolOrEnd(following) || inFlow && isFlowIndicator(following)) break;
    } else if (ch === 35) {
      if (isWsOrEol(state.input.charCodeAt(state.position - 1))) break;
    } else if (inFlow && isFlowIndicator(ch)) break;
    else if (isEol(ch)) {
      const savedPosition = state.position;
      const savedLine = state.line;
      const savedLineStart = state.lineStart;
      const savedLineIndent = state.lineIndent;
      skipSeparationSpace(state, false);
      if (state.lineIndent >= nodeIndent) {
        multiline = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      }
      state.position = savedPosition;
      state.line = savedLine;
      state.lineStart = savedLineStart;
      state.lineIndent = savedLineIndent;
      break;
    }
    if (!isWhiteSpace(ch)) end = state.position + 1;
    ch = state.input.charCodeAt(++state.position);
  }
  if (end === start) return false;
  checkPrintable(state, start, end);
  addScalarEvent(state, start, end, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.PLAIN, CHOMPING_MODE.CLIP, -1, !multiline);
  return true;
}
function skipFlowSeparationSpace(state, nodeIndent) {
  const startLine = state.line;
  skipSeparationSpace(state, true);
  if (state.line > startLine && state.lineIndent < nodeIndent || state.firstTabInLine !== -1 && state.lineIndent < nodeIndent) throwError(state, "deficient indentation");
}
function readFlowCollection(state, nodeIndent, props) {
  const ch = state.input.charCodeAt(state.position);
  const isMapping = ch === 123;
  const start = state.position;
  let readNext = true;
  if (ch !== 91 && ch !== 123) return false;
  const terminator = isMapping ? 125 : 93;
  if (isMapping) addMappingEvent(state, start, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.FLOW);
  else addSequenceEvent(state, start, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.FLOW);
  state.position++;
  while (state.input.charCodeAt(state.position) !== 0) {
    skipFlowSeparationSpace(state, nodeIndent);
    let ch2 = state.input.charCodeAt(state.position);
    if (ch2 === terminator) {
      state.position++;
      addPopEvent(state);
      return true;
    } else if (!readNext) throwError(state, "missed comma between flow collection entries");
    else if (ch2 === 44) throwError(state, "expected the node content, but found ','");
    let isPair = false;
    let isExplicitPair = false;
    if (ch2 === 63 && isWsOrEol(state.input.charCodeAt(state.position + 1))) {
      isPair = isExplicitPair = true;
      state.position += 1;
      skipFlowSeparationSpace(state, nodeIndent);
    }
    const entryLine = state.line;
    const entryStart = snapshotState(state);
    const keyWasRead = parseNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    skipFlowSeparationSpace(state, nodeIndent);
    ch2 = state.input.charCodeAt(state.position);
    if ((isMapping || isExplicitPair || state.line === entryLine) && ch2 === 58) {
      isPair = true;
      state.position++;
      skipFlowSeparationSpace(state, nodeIndent);
      if (!isMapping) {
        insertFlowPairMappingEvent(state, entryStart);
        if (!keyWasRead) addEmptyScalarEvent(state);
      } else if (!keyWasRead) addEmptyScalarEvent(state);
      if (!parseNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true)) addEmptyScalarEvent(state);
      skipFlowSeparationSpace(state, nodeIndent);
      if (!isMapping) addPopEvent(state);
    } else if (isMapping && isPair) {
      if (!keyWasRead) addEmptyScalarEvent(state);
      addEmptyScalarEvent(state);
    } else if (isMapping) addEmptyScalarEvent(state);
    else if (isPair) {
      insertFlowPairMappingEvent(state, entryStart);
      if (!keyWasRead) addEmptyScalarEvent(state);
      addEmptyScalarEvent(state);
      addPopEvent(state);
    }
    ch2 = state.input.charCodeAt(state.position);
    if (ch2 === 44) {
      readNext = true;
      state.position++;
    } else readNext = false;
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockSequence(state, nodeIndent, props) {
  if (state.firstTabInLine !== -1 || state.input.charCodeAt(state.position) !== 45 || !isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1))) return false;
  addSequenceEvent(state, state.position, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.BLOCK);
  while (state.input.charCodeAt(state.position) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1))) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    const entryLine = state.line;
    state.position++;
    const hadBreak = skipSeparationSpace(state, true) > 0;
    if (state.firstTabInLine !== -1 && state.input.charCodeAt(state.position) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1))) throwError(state, "bad indentation of a sequence entry");
    if (hadBreak && state.lineIndent <= nodeIndent) addEmptyScalarEvent(state);
    else parseNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    skipSeparationSpace(state, true);
    if (state.lineIndent < nodeIndent || state.position >= state.length) break;
    if (state.lineIndent > nodeIndent) throwError(state, "bad indentation of a sequence entry");
    if (state.line === entryLine && state.input.charCodeAt(state.position) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1))) throwError(state, "bad indentation of a sequence entry");
  }
  addPopEvent(state);
  return true;
}
function readBlockMapping(state, nodeIndent, flowIndent, props) {
  let atExplicitKey = false;
  let detected = false;
  let mappingOpened = false;
  let pendingExplicitKey = false;
  if (state.firstTabInLine !== -1) return false;
  let ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    const following = state.input.charCodeAt(state.position + 1);
    const entryLine = state.line;
    if ((ch === 63 || ch === 58) && isWsOrEolOrEnd(following)) {
      if (!mappingOpened) {
        addMappingEvent(state, state.position, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.BLOCK);
        mappingOpened = true;
      }
      if (ch === 63) {
        if (atExplicitKey) addEmptyScalarEvent(state);
        detected = true;
        atExplicitKey = true;
      } else if (atExplicitKey) atExplicitKey = false;
      else {
        addEmptyScalarEvent(state);
        detected = true;
        atExplicitKey = false;
      }
      state.position += 1;
      pendingExplicitKey = true;
    } else {
      if (atExplicitKey) {
        addEmptyScalarEvent(state);
        atExplicitKey = false;
      }
      const beforeKey = snapshotState(state);
      if (!parseNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) break;
      if (state.line === entryLine) {
        ch = state.input.charCodeAt(state.position);
        while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!isWsOrEolOrEnd(ch)) throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          if (!mappingOpened) {
            state.events.splice(beforeKey.eventsLength, 0, {
              type: EVENT_ID.MAPPING,
              start: beforeKey.position,
              anchorStart: props.anchorStart,
              anchorEnd: props.anchorEnd,
              tagStart: props.tagStart,
              tagEnd: props.tagEnd,
              style: COLLECTION_STYLE.BLOCK
            });
            mappingOpened = true;
          }
          detected = true;
          atExplicitKey = false;
          pendingExplicitKey = false;
        } else if (detected) throwError(state, "expected ':' after a mapping key");
        else {
          if (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1) {
            restoreState(state, beforeKey);
            return false;
          }
          return true;
        }
      } else if (detected) throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      else {
        if (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1) {
          restoreState(state, beforeKey);
          return false;
        }
        return true;
      }
    }
    if (parseNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, pendingExplicitKey)) pendingExplicitKey = false;
    if (!atExplicitKey) {
      if (pendingExplicitKey) {
        addEmptyScalarEvent(state);
        pendingExplicitKey = false;
      }
    }
    skipSeparationSpace(state, true);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === entryLine || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a mapping entry");
    else if (state.lineIndent < nodeIndent) break;
  }
  if (!detected) return false;
  if (atExplicitKey) addEmptyScalarEvent(state);
  if (mappingOpened) addPopEvent(state);
  return true;
}
function parseNode(state, parentIndent, nodeContext, allowToSeek, allowCompact, allowPropertyMapping = true) {
  if (state.depth >= state.maxDepth) throwError(state, `nesting exceeded maxDepth (${state.maxDepth})`);
  state.depth++;
  let indentStatus = 1;
  let atNewLine = false;
  let hasContent = false;
  let propertyStart = null;
  const props = emptyProperties();
  let allowBlockScalars = nodeContext === CONTEXT_BLOCK_OUT || nodeContext === CONTEXT_BLOCK_IN;
  let allowBlockCollections = allowBlockScalars;
  const allowBlockStyles = allowBlockScalars;
  if (allowToSeek && skipSeparationSpace(state, true)) {
    atNewLine = true;
    if (state.lineIndent > parentIndent) indentStatus = 1;
    else if (state.lineIndent === parentIndent) indentStatus = 0;
    else indentStatus = -1;
  }
  if (indentStatus === 1) while (true) {
    const ch = state.input.charCodeAt(state.position);
    const propertyState = snapshotState(state);
    if (atNewLine && indentStatus !== 1 && (ch === 33 || ch === 38)) break;
    if (atNewLine && allowBlockStyles && (props.tagStart !== NO_RANGE$1 || props.anchorStart !== NO_RANGE$1) && (ch === 33 || ch === 38)) {
      const fallbackState = snapshotState(state);
      const flowIndent = parentIndent + 1;
      if (readBlockMapping(state, state.position - state.lineStart, flowIndent, props) && state.events[fallbackState.eventsLength]?.type === EVENT_ID.MAPPING) {
        state.depth--;
        return true;
      }
      restoreState(state, fallbackState);
    }
    if (atNewLine && (ch === 33 && props.tagStart !== NO_RANGE$1 || ch === 38 && props.anchorStart !== NO_RANGE$1)) break;
    if (!readTagProperty(state, props, nodeContext === CONTEXT_FLOW_IN) && !readAnchorProperty(state, props)) break;
    if (propertyStart === null) propertyStart = propertyState;
    if (skipSeparationSpace(state, true)) {
      atNewLine = true;
      allowBlockCollections = allowBlockStyles;
      if (state.lineIndent > parentIndent) indentStatus = 1;
      else if (state.lineIndent === parentIndent) indentStatus = 0;
      else indentStatus = -1;
    } else allowBlockCollections = false;
  }
  if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact;
  if (indentStatus === 1 || nodeContext === CONTEXT_BLOCK_OUT) {
    const flowIndent = nodeContext === CONTEXT_FLOW_IN || nodeContext === CONTEXT_FLOW_OUT ? parentIndent : parentIndent + 1;
    const blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent, props) || readBlockMapping(state, blockIndent, flowIndent, props)) || readFlowCollection(state, flowIndent, props)) hasContent = true;
      else {
        const ch = state.input.charCodeAt(state.position);
        if (propertyStart !== null && allowPropertyMapping && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62) {
          const fallbackState = snapshotState(state);
          const propertyIndent = propertyStart.position - propertyStart.lineStart;
          restoreState(state, propertyStart);
          if (readBlockMapping(state, propertyIndent, flowIndent, emptyProperties()) && state.events[fallbackState.eventsLength]?.type === EVENT_ID.MAPPING) hasContent = true;
          else restoreState(state, fallbackState);
        }
        if (!hasContent && (allowBlockScalars && readBlockScalar(state, flowIndent, props) || readSingleQuotedScalar(state, flowIndent, props) || readDoubleQuotedScalar(state, flowIndent, props) || readAlias(state, props) || readPlainScalar(state, flowIndent, nodeContext, props))) hasContent = true;
      }
    } else if (indentStatus === 0) hasContent = allowBlockCollections && readBlockSequence(state, blockIndent, props);
  }
  allowBlockScalars = allowBlockScalars && !hasContent;
  if (!hasContent && (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1 || allowBlockScalars)) {
    addScalarEvent(state, NO_RANGE$1, NO_RANGE$1, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.PLAIN);
    hasContent = true;
  }
  state.depth--;
  return hasContent || props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1;
}
function readDirective(state) {
  if (state.lineIndent > 0 || state.input.charCodeAt(state.position) !== 37) return false;
  state.position++;
  const nameStart = state.position;
  while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position))) state.position++;
  const name = state.input.slice(nameStart, state.position);
  const args = [];
  if (name.length === 0) throwError(state, "directive name must not be less than one character in length");
  while (state.input.charCodeAt(state.position) !== 0 && !isEol(state.input.charCodeAt(state.position))) {
    while (isWhiteSpace(state.input.charCodeAt(state.position))) state.position++;
    if (state.input.charCodeAt(state.position) === 35 || isEol(state.input.charCodeAt(state.position)) || state.input.charCodeAt(state.position) === 0) break;
    const start = state.position;
    while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position))) state.position++;
    args.push(state.input.slice(start, state.position));
  }
  if (isEol(state.input.charCodeAt(state.position))) consumeLineBreak(state);
  if (name === "YAML") {
    if (state.directives.some((directive) => directive.kind === "yaml")) throwError(state, "duplication of %YAML directive");
    if (args.length !== 1) throwError(state, "YAML directive accepts exactly one argument");
    const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null) throwError(state, "ill-formed argument of the YAML directive");
    if (parseInt(match[1], 10) !== 1) throwError(state, "unacceptable YAML version of the document");
    state.directives.push({
      kind: "yaml",
      version: args[0]
    });
  } else if (name === "TAG") {
    if (args.length !== 2) throwError(state, "TAG directive accepts exactly two arguments");
    const [handle, prefix] = args;
    if (!PATTERN_TAG_HANDLE.test(handle)) throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    if (HAS_OWN.call(state.tagHandlers, handle)) throwError(state, `there is a previously declared suffix for "${handle}" tag handle`);
    if (!PATTERN_TAG_PREFIX.test(prefix)) throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    state.tagHandlers[handle] = prefix;
    state.directives.push({
      kind: "tag",
      handle,
      prefix
    });
  }
  return true;
}
function readDocument(state) {
  state.directives = [];
  state.tagHandlers = /* @__PURE__ */ Object.create(null);
  let hasDirectives = false;
  skipSeparationSpace(state, true);
  while (readDirective(state)) {
    hasDirectives = true;
    skipSeparationSpace(state, true);
  }
  let explicitStart = false;
  let explicitEnd = false;
  let allowCompact = true;
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 3))) {
    explicitStart = true;
    const markerLine = state.line;
    state.position += 3;
    skipSeparationSpace(state, true);
    allowCompact = state.line > markerLine;
  } else if (hasDirectives) throwError(state, "directives end mark is expected");
  const documentEventIndex = state.events.length;
  if (!explicitStart && state.position === state.lineStart && state.input.charCodeAt(state.position) === 46 && testDocumentSeparator(state)) {
    state.position += 3;
    skipSeparationSpace(state, true);
    return;
  }
  addDocumentEvent(state, explicitStart, false);
  if (!parseNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, allowCompact, allowCompact)) addEmptyScalarEvent(state);
  skipSeparationSpace(state, true);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    explicitEnd = state.input.charCodeAt(state.position) === 46;
    if (explicitEnd) {
      const markerLine = state.line;
      state.position += 3;
      skipSeparationSpace(state, true);
      if (state.line === markerLine && state.position < state.length) throwError(state, "end of the stream or a document separator is expected");
    }
  }
  const documentEvent = state.events[documentEventIndex];
  if (documentEvent?.type === EVENT_ID.DOCUMENT) documentEvent.explicitEnd = explicitEnd;
  addPopEvent(state);
  if (!explicitEnd && state.position < state.length && !testDocumentBoundary(state)) throwError(state, "end of the stream or a document separator is expected");
}
function parseEvents(input, options) {
  const length = input.length;
  const state = {
    ...DEFAULT_PARSER_OPTIONS,
    ...options,
    input: `${input}\0`,
    length,
    position: 0,
    line: 0,
    lineStart: 0,
    lineIndent: 0,
    firstTabInLine: -1,
    depth: 0,
    directives: [],
    tagHandlers: /* @__PURE__ */ Object.create(null),
    events: []
  };
  const nullpos = input.indexOf("\0");
  if (nullpos !== -1) YAMLException.throwAt(input, nullpos, "null byte is not allowed in input", state.filename);
  while (state.position < state.length) {
    skipByteOrderMark(state);
    skipSeparationSpace(state, true);
    if (state.position >= state.length) break;
    const documentStart = state.position;
    readDocument(state);
    if (state.position === documentStart)
      throwError(state, "can not read a document");
  }
  return state.events;
}
var DEFAULT_LOAD_OPTIONS = {
  ...DEFAULT_PARSER_OPTIONS,
  ...DEFAULT_CONSTRUCTOR_OPTIONS
};
function loadDocuments(input, options = {}) {
  const opts = {
    ...DEFAULT_LOAD_OPTIONS,
    ...options
  };
  const source = String(input);
  const PARSER_OPT_KEYS = Object.keys(DEFAULT_PARSER_OPTIONS);
  const CONSTRUCTOR_OPT_KEYS = Object.keys(DEFAULT_CONSTRUCTOR_OPTIONS);
  return constructFromEvents(parseEvents(source, pick(opts, PARSER_OPT_KEYS)), {
    ...pick(opts, CONSTRUCTOR_OPT_KEYS),
    source
  });
}
function load(input, options) {
  const documents = loadDocuments(input, options);
  if (documents.length === 0) throw new YAMLException("expected a document, but the input is empty");
  if (documents.length === 1) return documents[0];
  throw new YAMLException("expected a single document in the stream, but found more");
}
var INVALID = Symbol("INVALID");
var VISIT_BREAK = Symbol("visit:break");
var VISIT_SKIP = Symbol("visit:skip");
function hasBit(mask, bit) {
  return (mask & 1 << bit) !== 0;
}
var DEFAULT_SCALAR_STYLE_RULES = {
  applyQuoteFlowKeysOption,
  doubleQuoteForInvisibles,
  doubleQuoteWhitespaceOnly,
  applyForceQuotesOption,
  tryLongOrMultilineAsBlock,
  quoteInvalidPlain,
  fallbackToDoubleQuoted
};
function _preferredQuotedStyle(layout) {
  if (layout.presenterOptions.quoteStyle === "single" && hasBit(layout.allowedStylesMask, SCALAR_STYLE.SINGLE_QUOTED)) return SCALAR_STYLE.SINGLE_QUOTED;
  return SCALAR_STYLE.DOUBLE_QUOTED;
}
function applyQuoteFlowKeysOption(layout) {
  if (!layout.presenterOptions.quoteFlowKeys) return;
  if (!layout.isKey || !layout.flowOnly || layout.style !== SCALAR_STYLE.PLAIN) return;
  layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
function doubleQuoteForInvisibles(layout) {
  if (layout.style === SCALAR_STYLE.PLAIN && /[\t\x7F-\xA0\u2028\u2029\uFEFF\uFFFE\uFFFF]/.test(layout.node.value)) layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
function doubleQuoteWhitespaceOnly(layout) {
  if (layout.style === SCALAR_STYLE.PLAIN && /^\s+$/.test(layout.node.value)) layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
function applyForceQuotesOption(layout) {
  if (!layout.presenterOptions.forceQuotes) return;
  if (layout.isKey || layout.style !== SCALAR_STYLE.PLAIN) return;
  if (layout.node.tag !== layout.presenterOptions.schema.defaultScalarTag.tagName) return;
  layout.style = layout.node.value.includes("\n") ? SCALAR_STYLE.DOUBLE_QUOTED : _preferredQuotedStyle(layout);
}
function tryLongOrMultilineAsBlock(layout) {
  if (layout.style !== SCALAR_STYLE.PLAIN || layout.isKey) return;
  const value = layout.node.value;
  const multiline = value.indexOf("\n") !== -1;
  if (!hasBit(layout.allowedStylesMask, SCALAR_STYLE.LITERAL_BLOCK)) {
    if (multiline) layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
    return;
  }
  const w = layout.presenterOptions.lineWidth;
  if (w === -1) {
    if (multiline) layout.style = SCALAR_STYLE.LITERAL_BLOCK;
    return;
  }
  const availableWidth = Math.max(Math.min(w, 40), w - layout.shiftOfContent);
  let position = 0;
  let shouldFold = false;
  while (position <= value.length) {
    let lineEnd = value.length;
    const nextLineBreak = value.indexOf("\n", position);
    if (nextLineBreak !== -1) lineEnd = nextLineBreak;
    const line = value.slice(position, lineEnd);
    if (line.length > availableWidth && line[0] !== " " && / [^ \t]/.test(line)) shouldFold = true;
    if (nextLineBreak === -1) break;
    position = nextLineBreak + 1;
  }
  if (shouldFold) layout.style = SCALAR_STYLE.FOLDED_BLOCK;
  else if (multiline) layout.style = SCALAR_STYLE.LITERAL_BLOCK;
}
function quoteInvalidPlain(layout) {
  if (layout.style === SCALAR_STYLE.PLAIN && !hasBit(layout.allowedStylesMask, SCALAR_STYLE.PLAIN)) layout.style = _preferredQuotedStyle(layout);
}
function fallbackToDoubleQuoted(layout) {
  if (!hasBit(layout.allowedStylesMask, layout.style)) layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
var SRC_C_PRINTABLE = "[\\x09\\x0A\\x0D\\x20-\\x7E\\x85\\xA0-\\uD7FF\\uE000-\\uFFFD\\u{10000}-\\u{10FFFF}]";
var SRC_B_CHAR = "[\\n\\r]";
var SRC_C_BYTE_ORDER_MARK = "\\uFEFF";
var SRC_S_WHITE = "[ \\t]";
var SRC_NB_CHAR = `(?:(?!(?:${SRC_B_CHAR}|${SRC_C_BYTE_ORDER_MARK}))${SRC_C_PRINTABLE})`;
var SRC_NS_CHAR = `(?:(?!${SRC_S_WHITE})${SRC_NB_CHAR})`;
var SRC_NB_JSON = "[\\x09\\x20-\\uD7FF\\uE000-\\uFFFF\\u{10000}-\\u{10FFFF}]";
var SRC_C_INDICATOR = "[-?:,\\[\\]{}#&*!|>'\"%@`]";
var SRC_C_FLOW_INDICATOR = "[,\\[\\]{}]";
var SRC_NS_PLAIN_SAFE_FLOW_OUT = SRC_NS_CHAR;
var SRC_NS_PLAIN_SAFE_FLOW_IN = `(?:(?!${SRC_C_FLOW_INDICATOR})${SRC_NS_CHAR})`;
var SRC_NS_PLAIN_FIRST_FLOW_OUT = `(?:(?:(?!${SRC_C_INDICATOR})${SRC_NS_CHAR})|[?:-](?=${SRC_NS_PLAIN_SAFE_FLOW_OUT}))`;
var SRC_NS_PLAIN_FIRST_FLOW_IN = `(?:(?:(?!${SRC_C_INDICATOR})${SRC_NS_CHAR})|[?:-](?=${SRC_NS_PLAIN_SAFE_FLOW_IN}))`;
var SRC_NS_PLAIN_CHAR_FLOW_OUT = `(?:(?:(?![:#])${SRC_NS_PLAIN_SAFE_FLOW_OUT})|:(?=${SRC_NS_PLAIN_SAFE_FLOW_OUT}))#*`;
var SRC_NS_PLAIN_CHAR_FLOW_IN = `(?:(?:(?![:#])${SRC_NS_PLAIN_SAFE_FLOW_IN})|:(?=${SRC_NS_PLAIN_SAFE_FLOW_IN}))#*`;
var SRC_NB_NS_PLAIN_IN_LINE_FLOW_OUT = `(?:${SRC_S_WHITE}*${SRC_NS_PLAIN_CHAR_FLOW_OUT})*`;
var SRC_NB_NS_PLAIN_IN_LINE_FLOW_IN = `(?:${SRC_S_WHITE}*${SRC_NS_PLAIN_CHAR_FLOW_IN})*`;
var SRC_NS_PLAIN_ONE_LINE_FLOW_OUT = `${SRC_NS_PLAIN_FIRST_FLOW_OUT}#*${SRC_NB_NS_PLAIN_IN_LINE_FLOW_OUT}`;
var SRC_NS_PLAIN_ONE_LINE_FLOW_IN = `${SRC_NS_PLAIN_FIRST_FLOW_IN}#*${SRC_NB_NS_PLAIN_IN_LINE_FLOW_IN}`;
var SRC_NS_PLAIN_ONE_LINE_BLOCK_KEY = SRC_NS_PLAIN_ONE_LINE_FLOW_OUT;
var SRC_NS_PLAIN_ONE_LINE_FLOW_KEY = SRC_NS_PLAIN_ONE_LINE_FLOW_IN;
var SRC_S_NS_PLAIN_NEXT_LINE_FLOW_OUT = `\\n+${SRC_NS_PLAIN_CHAR_FLOW_OUT}${SRC_NB_NS_PLAIN_IN_LINE_FLOW_OUT}`;
var SRC_S_NS_PLAIN_NEXT_LINE_FLOW_IN = `\\n+${SRC_NS_PLAIN_CHAR_FLOW_IN}${SRC_NB_NS_PLAIN_IN_LINE_FLOW_IN}`;
var SRC_NS_PLAIN_MULTI_LINE_FLOW_OUT = `${SRC_NS_PLAIN_ONE_LINE_FLOW_OUT}(?:${SRC_S_NS_PLAIN_NEXT_LINE_FLOW_OUT})*`;
var SRC_NS_PLAIN_MULTI_LINE_FLOW_IN = `${SRC_NS_PLAIN_ONE_LINE_FLOW_IN}(?:${SRC_S_NS_PLAIN_NEXT_LINE_FLOW_IN})*`;
var NS_PLAIN_FLOW_OUT = new RegExp(`^(?:${SRC_NS_PLAIN_MULTI_LINE_FLOW_OUT})$`, "u");
var NS_PLAIN_FLOW_IN = new RegExp(`^(?:${SRC_NS_PLAIN_MULTI_LINE_FLOW_IN})$`, "u");
var NS_PLAIN_BLOCK_KEY = new RegExp(`^(?:${SRC_NS_PLAIN_ONE_LINE_BLOCK_KEY})$`, "u");
var NS_PLAIN_FLOW_KEY = new RegExp(`^(?:${SRC_NS_PLAIN_ONE_LINE_FLOW_KEY})$`, "u");
var NB_SINGLE_ONE_LINE = new RegExp(`^(?:${SRC_NB_JSON})*$`, "u");
var NB_SINGLE_MULTI_LINE = new RegExp(`^(?:${SRC_NB_JSON}|\\n)*$`, "u");
var BLOCK_SCALAR_CONTENT = new RegExp(`^(?:${SRC_NB_CHAR}|\\n)*$`, "u");
var DEFAULT_PRESENTER_OPTIONS = {
  indent: 2,
  seqNoIndent: false,
  seqInlineFirst: true,
  lineWidth: 80,
  flowBracketPadding: false,
  flowSkipCommaSpace: false,
  flowSkipColonSpace: false,
  quoteFlowKeys: false,
  quoteStyle: "single",
  forceQuotes: false,
  scalarStyleRules: Object.keys(DEFAULT_SCALAR_STYLE_RULES).map((name) => Reflect.get(DEFAULT_SCALAR_STYLE_RULES, name)),
  tagBeforeAnchor: false
};
var DEFAULT_DUMP_OPTIONS = {
  ...DEFAULT_PRESENTER_OPTIONS,
  schema: DUMP_SCHEMA,
  skipInvalid: false,
  noRefs: false,
  flowLevel: -1,
  sortKeys: false,
  transform: () => {
  }
};
var EVENT_DOCUMENT = EVENT_ID.DOCUMENT;
var EVENT_SEQUENCE = EVENT_ID.SEQUENCE;
var EVENT_MAPPING = EVENT_ID.MAPPING;
var EVENT_SCALAR = EVENT_ID.SCALAR;
var EVENT_ALIAS = EVENT_ID.ALIAS;
var EVENT_POP = EVENT_ID.POP;
var SCALAR_STYLE_PLAIN = SCALAR_STYLE.PLAIN;
var SCALAR_STYLE_SINGLE_QUOTED = SCALAR_STYLE.SINGLE_QUOTED;
var SCALAR_STYLE_DOUBLE_QUOTED = SCALAR_STYLE.DOUBLE_QUOTED;
var SCALAR_STYLE_LITERAL_BLOCK = SCALAR_STYLE.LITERAL_BLOCK;
var SCALAR_STYLE_FOLDED_BLOCK = SCALAR_STYLE.FOLDED_BLOCK;
var COLLECTION_STYLE_BLOCK = COLLECTION_STYLE.BLOCK;
var COLLECTION_STYLE_FLOW = COLLECTION_STYLE.FLOW;
var CHOMPING_CLIP = CHOMPING_MODE.CLIP;
var CHOMPING_STRIP = CHOMPING_MODE.STRIP;
var CHOMPING_KEEP = CHOMPING_MODE.KEEP;

// src/lib/obsidian/frontmatter.ts
var FM_RE = /^---(\r?\n)(?:([\s\S]*?)\r?\n)?---((?:\r?\n)*)/;
function parseFrontmatter(content) {
  const m = content.match(FM_RE);
  if (!m) {
    const eol2 = content.includes("\r\n") ? "\r\n" : "\n";
    return { data: {}, body: content, hasFrontmatter: false, eol: eol2, rawGap: "" };
  }
  const eol = m[1] === "\r\n" ? "\r\n" : "\n";
  const rawYaml = m[2] ?? "";
  const rawGap = m[3] ?? "";
  let data = {};
  let valid = false;
  let invalidYaml = false;
  try {
    const parsed = rawYaml.trim() === "" ? null : load(rawYaml);
    if (parsed == null) {
      valid = true;
    } else if (typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed;
      valid = true;
    } else {
      invalidYaml = true;
    }
  } catch {
    invalidYaml = true;
  }
  if (!valid) return { data: {}, body: content, hasFrontmatter: false, invalidYaml, eol, rawGap: "" };
  return { data, body: content.slice(m[0].length), hasFrontmatter: true, eol, rawGap };
}

// src/lib/obsidian/links.ts
var WIKILINK_RE = /(!?)\[\[([^\[\]]+?)\]\]/g;
function parseWikilink(raw) {
  const m = raw.match(/^(!?)\[\[([^\[\]]+?)\]\]$/);
  if (!m) return null;
  const embed = m[1] === "!";
  let inner = m[2];
  let alias = null;
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    alias = inner.slice(pipe + 1).trim();
    inner = inner.slice(0, pipe);
  }
  let subpath = null;
  const hash = inner.indexOf("#");
  if (hash !== -1) {
    subpath = inner.slice(hash);
    inner = inner.slice(0, hash);
  }
  return { target: inner.trim(), subpath, alias, embed, raw };
}
function extractLinks(content) {
  const out = [];
  const cleaned = stripCode(content);
  for (const m of cleaned.matchAll(WIKILINK_RE)) {
    const link = parseWikilink(m[0]);
    if (link && link.target) out.push(link);
  }
  return out;
}
function extractMarkdownLinks(content) {
  const out = [];
  const cleaned = stripCode(content);
  for (const m of cleaned.matchAll(/(?<!!)\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const hrefRaw = m[2].trim();
    const href = hrefRaw.startsWith("<") ? hrefRaw.slice(1, hrefRaw.indexOf(">") >= 0 ? hrefRaw.indexOf(">") : hrefRaw.length).trim() : hrefRaw.split(/\s+/)[0];
    if (!href || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("#")) continue;
    const hash = href.indexOf("#");
    const body = hash >= 0 ? href.slice(0, hash) : href;
    let target = body;
    try {
      target = decodeURIComponent(body);
    } catch {
    }
    if (target) out.push({ text: m[1], target, raw: m[0] });
  }
  return out;
}
var TAG_BODY = /[^\s#!"'`.,:;()\[\]{}]+/;
var TAG_RE = new RegExp(`(^|[\\s(>])#(${TAG_BODY.source}(?:[-_/]${TAG_BODY.source})*)`, "g");
function extractTags(content) {
  const tags = /* @__PURE__ */ new Set();
  const { data, body } = parseFrontmatter(content);
  const fmTags = data["tags"] ?? data["tag"];
  if (typeof fmTags === "string") {
    fmTags.split(/[\s,]+/).map((s) => s.trim().replace(/^#/, "")).filter(Boolean).forEach((t) => tags.add(t));
  } else if (Array.isArray(fmTags)) {
    fmTags.filter((t) => typeof t === "string").map((t) => t.trim().replace(/^#/, "")).filter(Boolean).forEach((t) => tags.add(t));
  }
  const stripped = stripCode(body).replace(/\[[^\]\n]*\]\([^)\n]*\)/g, (m) => " ".repeat(m.length)).replace(/https?:\/\/[^\s)>\]]+/gi, (m) => " ".repeat(m.length));
  for (const m of stripped.matchAll(TAG_RE)) {
    const tag = m[2];
    if (tag && !/^[-_/]|[-_/]$/.test(tag) && /[a-zA-Z\u00c0-\uffff]/.test(tag)) tags.add(tag);
  }
  return [...tags];
}
function stripCode(content) {
  const lines = content.split("\n");
  const maskedLines = [];
  let fenceChar = null;
  let fenceLen = 0;
  let skippedFm = false;
  let startIdx = 0;
  if (lines[0]?.replace(/\r$/, "") === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].replace(/\r$/, "") === "---") {
        for (let k = 0; k <= i; k++) maskedLines.push(lines[k].replace(/[^\r]/g, " "));
        startIdx = i + 1;
        skippedFm = true;
        break;
      }
    }
  }
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const bare = line.replace(/\r$/, "");
    if (!fenceChar) {
      const open = bare.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        maskedLines.push(line.replace(/[^\r]/g, " "));
        continue;
      }
      maskedLines.push(line);
    } else {
      const close = bare.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      maskedLines.push(line.replace(/[^\r]/g, " "));
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
    }
  }
  return maskedLines.join("\n").replace(/(`+)[\s\S]*?\1/g, (m) => m.replace(/[^\r\n]/g, " "));
}
function buildIndexMap(index) {
  const byPath = /* @__PURE__ */ new Map();
  const byLowerName = /* @__PURE__ */ new Map();
  const byLowerAlias = /* @__PURE__ */ new Map();
  for (const e of index) {
    byPath.set(e.path, e);
    byPath.set(e.path.toLowerCase(), e);
    const ext = e.kind === "canvas" ? ".canvas" : ".md";
    byPath.set(e.path + ext, e);
    byPath.set((e.path + ext).toLowerCase(), e);
    if (e.id !== e.path + ext) {
      byPath.set(e.id, e);
      byPath.set(e.id.toLowerCase(), e);
    }
    const n = e.name.toLowerCase();
    if (!byLowerName.has(n)) byLowerName.set(n, []);
    byLowerName.get(n).push(e);
    for (const a of e.aliases) {
      const al = a.toLowerCase();
      if (!byLowerAlias.has(al)) byLowerAlias.set(al, []);
      byLowerAlias.get(al).push(e);
    }
  }
  return { byPath, byLowerName, byLowerAlias };
}
function resolveLink(target, maps) {
  const t = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!t) return null;
  const byPath = maps.byPath.get(t) ?? maps.byPath.get(t + ".md") ?? maps.byPath.get(t + ".canvas") ?? maps.byPath.get(t.toLowerCase()) ?? maps.byPath.get((t + ".md").toLowerCase()) ?? maps.byPath.get((t + ".canvas").toLowerCase());
  if (byPath) return byPath;
  const lowerNoExt = t.replace(/\.(?:md|markdown|canvas)$/i, "").toLowerCase();
  const pickShortest = (list) => {
    if (!list || list.length === 0) return null;
    return [...list].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0];
  };
  return pickShortest(maps.byLowerName.get(lowerNoExt)) ?? pickShortest(maps.byLowerAlias.get(t.toLowerCase()));
}
function makeSnippet2(content, index, length, pad = 36) {
  const start = Math.max(0, index - pad);
  const end = Math.min(content.length, index + length + pad);
  let before = content.slice(start, index).replace(/\s+/g, " ");
  const match = content.slice(index, index + length);
  const after = content.slice(index + length, end).replace(/\s+/g, " ");
  if (start > 0) before = "\u2026" + before;
  const afterText = end < content.length ? after + "\u2026" : after;
  return { before, match, after: afterText };
}
function codeOrFmLineMask(content) {
  const lines = content.split("\n");
  const mask = new Array(lines.length).fill(false);
  let i = 0;
  if (lines[0]?.replace(/\r$/, "") === "---") {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].replace(/\r$/, "") === "---") {
        for (let k = 0; k <= j; k++) mask[k] = true;
        i = j + 1;
        break;
      }
    }
  }
  let fenceChar = null;
  let fenceLen = 0;
  for (; i < lines.length; i++) {
    const bare = lines[i].replace(/\r$/, "");
    if (!fenceChar) {
      const open = bare.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        mask[i] = true;
      }
    } else {
      mask[i] = true;
      const close = bare.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
    }
  }
  return mask;
}
function isInsideLinkOrCode(content, offset, length) {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  const lineNum = content.slice(0, lineStart).split("\n").length - 1;
  const masked = codeOrFmLineMask(content);
  if (masked[lineNum]) return true;
  const lineEnd = content.indexOf("\n", offset);
  const line = content.slice(lineStart, lineEnd === -1 ? void 0 : lineEnd);
  const posInLine = offset - lineStart;
  for (const m of line.matchAll(/(`+)([^\n]*?)\1/g)) {
    const idx = m.index ?? 0;
    if (posInLine >= idx && posInLine + length <= idx + m[0].length) return true;
  }
  for (const m of line.matchAll(WIKILINK_RE)) {
    const idx = m.index ?? 0;
    if (posInLine >= idx && posInLine + length <= idx + m[0].length) return true;
  }
  for (const m of line.matchAll(/\[[^\]]*\]\([^)]*\)/g)) {
    const idx = m.index ?? 0;
    if (posInLine >= idx && posInLine + length <= idx + m[0].length) return true;
  }
  return false;
}

// src/lib/obsidian/search.ts
var TASK_ANY_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[([^\]]*)\](.*)$/;
var LINE_OPS = ["line:", "task:", "task-todo:", "task-done:"];
var QUOTED_OPS = ["tag:", "path:", "file:", "content:"];
function tokenizeSearch(q) {
  const tokens = [];
  let i = 0;
  const n = q.length;
  const readQuoted = () => {
    let out = q[i++];
    while (i < n) {
      const ch = q[i++];
      out += ch;
      if (ch === "\\" && i < n) {
        out += q[i++];
        continue;
      }
      if (ch === '"') break;
    }
    return out;
  };
  const readParenGroup = () => {
    let depth = 0;
    let out = "";
    while (i < n) {
      const ch = q[i];
      if (ch === '"') {
        out += readQuoted();
        continue;
      }
      out += ch;
      i++;
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth <= 0) break;
      }
    }
    return out;
  };
  while (i < n) {
    while (i < n && /\s/.test(q[i])) i++;
    if (i >= n) break;
    const ch = q[i];
    if (ch === "(" || ch === ")") {
      tokens.push(ch);
      i++;
      continue;
    }
    const rest = q.slice(i);
    const negPrefix = rest.startsWith("-") ? "-" : "";
    const afterNeg = negPrefix ? rest.slice(1) : rest;
    const lowerAfter = afterNeg.toLowerCase();
    const lineOp = LINE_OPS.find((op) => lowerAfter.startsWith(op));
    if (lineOp) {
      const opLen = negPrefix.length + lineOp.length;
      let tok2 = q.slice(i, i + opLen);
      i += opLen;
      if (q[i] === "(") tok2 += readParenGroup();
      else if (q[i] === '"') tok2 += readQuoted();
      else {
        while (i < n && !/[\s()]/.test(q[i])) tok2 += q[i++];
      }
      tokens.push(tok2);
      continue;
    }
    const qOp = QUOTED_OPS.find((op) => lowerAfter.startsWith(op));
    if (qOp) {
      const opLen = negPrefix.length + qOp.length;
      let tok2 = q.slice(i, i + opLen);
      i += opLen;
      if (q[i] === '"') tok2 += readQuoted();
      else if (q[i] === "/") {
        tok2 += "/";
        i++;
        while (i < n && q[i] !== "/") {
          if (q[i] === "\\" && i + 1 < n) tok2 += q[i++];
          tok2 += q[i++];
        }
        if (q[i] === "/") {
          tok2 += "/";
          i++;
          while (i < n && /[gimsuy]/i.test(q[i])) tok2 += q[i++];
        }
      } else {
        while (i < n && !/[\s()]/.test(q[i])) tok2 += q[i++];
      }
      tokens.push(tok2);
      continue;
    }
    if (afterNeg.startsWith('"')) {
      let tok2 = "";
      if (negPrefix) {
        tok2 = "-";
        i++;
      }
      tok2 += readQuoted();
      tokens.push(tok2);
      continue;
    }
    if (afterNeg.startsWith("[[")) {
      let tok2 = "";
      if (negPrefix) {
        tok2 = "-";
        i++;
      }
      const close = q.indexOf("]]", i + 2);
      if (close !== -1) {
        tok2 += q.slice(i, close + 2);
        i = close + 2;
        tokens.push(tok2);
        continue;
      }
    }
    if (afterNeg.startsWith("[")) {
      let tok2 = "";
      if (negPrefix) {
        tok2 = "-";
        i++;
      }
      tok2 += q[i++];
      while (i < n && q[i] !== "]") {
        if (q[i] === '"') tok2 += readQuoted();
        else tok2 += q[i++];
      }
      if (q[i] === "]") tok2 += q[i++];
      tokens.push(tok2);
      continue;
    }
    if (afterNeg.startsWith("/")) {
      const startRegex = i + negPrefix.length + 1;
      let j = startRegex;
      let foundClose = false;
      while (j < n) {
        if (q[j] === "\\") {
          j += 2;
          continue;
        }
        if (q[j] === "/") {
          foundClose = true;
          j++;
          while (j < n && /[gimsuy]/i.test(q[j])) j++;
          break;
        }
        if (q[j] === "\n" || q[j] === "\r") break;
        j++;
      }
      if (foundClose && j > startRegex + 1) {
        tokens.push(q.slice(i, j));
        i = j;
        continue;
      }
    }
    let tok = "";
    while (i < n && !/[\s()]/.test(q[i])) {
      if (q[i] === '"') tok += readQuoted();
      else tok += q[i++];
    }
    if (tok) tokens.push(tok);
  }
  return tokens;
}
function unquote(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return s;
}
function parseTokens(tokens) {
  let pos = 0;
  function parseOrExpr() {
    const out = [];
    while (pos < tokens.length && tokens[pos] !== ")") {
      const first = parseAndSequence();
      if (!first) break;
      if (pos < tokens.length && tokens[pos].toUpperCase() === "OR") {
        const alternatives = [first];
        while (pos < tokens.length && tokens[pos].toUpperCase() === "OR") {
          pos++;
          if (pos >= tokens.length || tokens[pos] === ")") {
            alternatives.push({ kind: "never", negate: false });
            break;
          }
          const rhs = parseAndSequence();
          alternatives.push(rhs ?? { kind: "never", negate: false });
        }
        out.push({ kind: "or", atoms: alternatives, negate: false });
      } else {
        out.push(first);
      }
    }
    return out;
  }
  function parseAndSequence() {
    const group = [];
    while (pos < tokens.length && tokens[pos] !== ")" && tokens[pos].toUpperCase() !== "OR") {
      group.push(parseUnary());
    }
    if (group.length === 0) return null;
    if (group.length === 1) return group[0];
    return { kind: "and", atoms: group, negate: false };
  }
  function parseUnary() {
    let negate = false;
    if (pos < tokens.length && tokens[pos] === "-") {
      negate = true;
      pos++;
    }
    if (pos >= tokens.length || tokens[pos] === ")") {
      return { kind: "never", negate };
    }
    let t = tokens[pos];
    if (t === "(") {
      pos++;
      const inner = parseOrExpr();
      if (tokens[pos] === ")") pos++;
      if (inner.length === 0) return { kind: "never", negate };
      if (inner.length === 1) return negate ? { ...inner[0], negate: !inner[0].negate } : inner[0];
      return { kind: "and", atoms: inner, negate };
    }
    pos++;
    if (t.toUpperCase() === "OR") {
      return { kind: "never", negate };
    }
    if (t.startsWith("-") && t.length > 1) {
      negate = !negate;
      t = t.slice(1);
    }
    const lower = t.toLowerCase();
    if (lower.startsWith("tag:")) return { kind: "tag", value: unquote(t.slice(4)), negate };
    if (lower.startsWith("path:")) return { kind: "path", value: unquote(t.slice(5)), negate };
    if (lower.startsWith("file:")) return { kind: "file", value: unquote(t.slice(5)), negate };
    if (lower.startsWith("content:")) return { kind: "content", value: unquote(t.slice(8)), negate };
    if (lower.startsWith("line:")) {
      const raw = t.slice(5);
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
      const subTokens = tokenizeSearch(inner);
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : [];
      if (expr.length > 0) return { kind: "line", expr, negate };
      return { kind: "never", negate };
    }
    if (lower === "task:" || lower.startsWith("task:")) {
      const raw = t.slice(5);
      if (!raw) return { kind: "task", status: "any", negate };
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
      const subTokens = tokenizeSearch(inner);
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : [];
      return { kind: "task", status: "any", expr: expr.length > 0 ? expr : [{ kind: "never", negate: false }], negate };
    }
    if (lower === "task-todo:" || lower.startsWith("task-todo:")) {
      const raw = t.slice(10);
      if (!raw) return { kind: "task", status: "todo", negate };
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
      const subTokens = tokenizeSearch(inner);
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : [];
      return { kind: "task", status: "todo", expr: expr.length > 0 ? expr : [{ kind: "never", negate: false }], negate };
    }
    if (lower === "task-done:" || lower.startsWith("task-done:")) {
      const raw = t.slice(10);
      if (!raw) return { kind: "task", status: "done", negate };
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
      const subTokens = tokenizeSearch(inner);
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : [];
      return { kind: "task", status: "done", expr: expr.length > 0 ? expr : [{ kind: "never", negate: false }], negate };
    }
    if (t.startsWith("[[") && t.endsWith("]]") && t.length > 4) {
      return { kind: "link", value: t.slice(2, -2).split("|")[0].split("#")[0].trim(), negate };
    }
    if (t.startsWith("[") && t.endsWith("]") && t.length > 2) {
      const inner = t.slice(1, -1);
      const colon = inner.indexOf(":");
      if (colon === -1) return { kind: "prop", key: unquote(inner.trim()), negate };
      const key = unquote(inner.slice(0, colon).trim());
      const value = unquote(inner.slice(colon + 1).trim());
      return { kind: "prop", key, value, negate };
    }
    const regexMatch = t.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      return { kind: "regex", pattern: regexMatch[1], flags: regexMatch[2].replace(/[gy]/g, ""), negate };
    }
    const val = unquote(t);
    if (!val) return { kind: "never", negate };
    return { kind: "term", value: val, negate };
  }
  return parseOrExpr();
}
function parseSearchQuery(q) {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const tokens = tokenizeSearch(trimmed);
  if (tokens.length === 0) return [];
  const parsed = parseTokens(tokens);
  return parsed.length > 0 ? parsed : [{ kind: "never", negate: false }];
}
function tagMatches(tag, value) {
  return tag === value || tag.startsWith(value + "/");
}
function compileSearchRegex(pattern, flags, caseSensitive) {
  try {
    let f = flags.replace(/[gy]/g, "");
    if (!caseSensitive && !f.includes("i")) f += "i";
    return new RegExp(pattern, f);
  } catch {
    return null;
  }
}
function matchSingleLineAtom(atom, line, cs, caseSensitive) {
  let result = false;
  switch (atom.kind) {
    case "never":
      result = false;
      break;
    case "term":
    case "content":
      result = atom.value !== "" && cs(line).includes(cs(atom.value));
      break;
    case "tag": {
      const v = cs(atom.value.replace(/^#/, ""));
      result = v !== "" && (cs(line).includes("#" + v) || cs(line).includes(v));
      break;
    }
    case "link": {
      const v = cs(atom.value);
      result = cs(line).includes(`[[${v}`) || cs(line).includes(`](${v}`);
      break;
    }
    case "regex": {
      const re = compileSearchRegex(atom.pattern, atom.flags, caseSensitive);
      result = re ? re.test(line) : false;
      break;
    }
    case "or":
      result = atom.atoms.some((a) => matchSingleLineAtom(a, line, cs, caseSensitive));
      break;
    case "and":
      result = atom.atoms.every((a) => matchSingleLineAtom(a, line, cs, caseSensitive));
      break;
    default:
      result = false;
  }
  return atom.negate ? !result : result;
}
function matchPropertyAtom(key, value, fm, caseSensitive) {
  const cs = (s) => caseSensitive ? s : s.toLowerCase();
  const targetKey = cs(key);
  const entry = Object.entries(fm).find(([k]) => cs(k) === targetKey);
  if (!entry) return false;
  if (value === void 0) return true;
  const targetVal = cs(value);
  const rawVal = entry[1];
  if (Array.isArray(rawVal)) {
    return rawVal.some((item) => cs(String(item)) === targetVal || cs(String(item)).includes(targetVal));
  }
  if (rawVal === null || rawVal === void 0) return targetVal === "";
  return cs(String(rawVal)) === targetVal || cs(String(rawVal)).includes(targetVal);
}
function matchSearchAtom(atom, ctx) {
  const cs = (s) => ctx.caseSensitive ? s : s.toLowerCase();
  const content = cs(ctx.content);
  const name = cs(ctx.name);
  const path2 = cs(ctx.path);
  const tagList = ctx.tags.map((t) => cs(t));
  let result = false;
  switch (atom.kind) {
    case "never":
      result = false;
      break;
    case "term":
      result = atom.value !== "" && (content.includes(cs(atom.value)) || name.includes(cs(atom.value)) || path2.includes(cs(atom.value)));
      break;
    case "content":
      result = atom.value !== "" && content.includes(cs(atom.value));
      break;
    case "tag": {
      const v = cs(atom.value.replace(/^#/, ""));
      result = v !== "" ? tagList.some((t) => tagMatches(t, v)) : tagList.length > 0;
      break;
    }
    case "path":
      result = path2.includes(cs(atom.value));
      break;
    case "file":
      result = name.includes(cs(atom.value));
      break;
    case "link": {
      const target = cs(atom.value);
      const links = [...extractLinks(ctx.content), ...extractMarkdownLinks(ctx.content)];
      result = links.some((l) => {
        const lt = cs(l.target);
        const base = lt.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? lt;
        return lt === target || base === target || lt.endsWith("/" + target);
      });
      break;
    }
    case "regex": {
      const re = compileSearchRegex(atom.pattern, atom.flags, ctx.caseSensitive);
      result = re ? re.test(ctx.content) : false;
      break;
    }
    case "prop": {
      const fm = ctx.frontmatter ?? parseFrontmatter(ctx.content).data;
      result = matchPropertyAtom(atom.key, atom.value, fm, ctx.caseSensitive);
      break;
    }
    case "line": {
      const lines = ctx.content.split(/\r?\n/);
      result = lines.some((line) => atom.expr.every((sub) => matchSingleLineAtom(sub, line, cs, ctx.caseSensitive)));
      break;
    }
    case "task": {
      const lines = ctx.content.split(/\r?\n/);
      const masked = codeOrFmLineMask(ctx.content);
      result = lines.some((line, idx) => {
        if (masked[idx]) return false;
        const m = line.match(TASK_ANY_RE);
        if (!m) return false;
        const box = m[1];
        const text = m[2];
        if (atom.status === "todo" && box !== " ") return false;
        if (atom.status === "done" && (box === " " || box === "")) return false;
        if (!atom.expr) return true;
        return atom.expr.every((sub) => matchSingleLineAtom(sub, text, cs, ctx.caseSensitive));
      });
      break;
    }
    case "or":
      result = atom.atoms.some((a) => matchSearchAtom(a, ctx));
      break;
    case "and":
      result = atom.atoms.every((a) => matchSearchAtom(a, ctx));
      break;
  }
  return atom.negate ? !result : result;
}
function matchSearchExpr(expr, ctx) {
  return expr.every((atom) => matchSearchAtom(atom, ctx));
}
function collectPositiveTerms(atom, out) {
  if (atom.negate) return;
  if ((atom.kind === "term" || atom.kind === "content" || atom.kind === "link") && atom.value !== "") {
    out.push(atom.value);
    return;
  }
  if (atom.kind === "and" || atom.kind === "or") {
    for (const sub of atom.atoms) collectPositiveTerms(sub, out);
    return;
  }
  if (atom.kind === "line") {
    for (const sub of atom.expr) collectPositiveTerms(sub, out);
    return;
  }
  if (atom.kind === "task" && atom.expr) {
    for (const sub of atom.expr) collectPositiveTerms(sub, out);
  }
}
function searchTerms(expr) {
  const out = [];
  for (const a of expr) collectPositiveTerms(a, out);
  return [...new Set(out)];
}
function collectPositiveRegexes(atom, out) {
  if (atom.negate) return;
  if (atom.kind === "regex") {
    out.push({ pattern: atom.pattern, flags: atom.flags });
    return;
  }
  if (atom.kind === "and" || atom.kind === "or") {
    for (const sub of atom.atoms) collectPositiveRegexes(sub, out);
    return;
  }
  if (atom.kind === "line") {
    for (const sub of atom.expr) collectPositiveRegexes(sub, out);
    return;
  }
  if (atom.kind === "task" && atom.expr) {
    for (const sub of atom.expr) collectPositiveRegexes(sub, out);
  }
}
function searchRegexes(expr) {
  const out = [];
  for (const a of expr) collectPositiveRegexes(a, out);
  return out;
}

// src/lib/obsidian/settings.ts
var DEFAULT_SETTINGS = {
  appearance: {
    theme: "dark",
    accentColor: "#8b6cef",
    baseFontSize: 16,
    readableLineLength: true,
    showInlineTitle: true
  },
  editor: {
    defaultEditMode: "live",
    strictLineBreaks: false,
    spellcheck: false,
    showProperties: "visible",
    indentWithTabs: true,
    tabSize: 4
  },
  files: {
    newNoteLocation: "root",
    useWikilinks: true,
    attachmentLocation: "root",
    attachmentFolder: "attachments"
  },
  dailyNotes: {
    format: "YYYY-MM-DD",
    folder: "Daily notes",
    template: "Daily template"
  },
  templates: {
    folder: "Templates"
  },
  zettelkasten: {
    format: "YYYYMMDDHHmm",
    template: ""
  },
  fileRecovery: {
    enabled: true,
    intervalMinutes: 5,
    retentionDays: 30
  },
  graph: {
    groups: [
      { query: "path:Workshop", color: "#e9967a" },
      { query: "tag:#project", color: "#4dd0e1" }
    ],
    existingOnly: false,
    arrows: true,
    textFade: 6,
    nodeSize: 1,
    linkThickness: 1,
    centerForce: 1,
    repelForce: 1,
    linkForce: 1,
    linkDistance: 150,
    localDepth: 1,
    localIncoming: true,
    localOutgoing: true,
    showOrphans: true
  },
  hotkeys: {},
  corePlugins: {
    fileExplorer: true,
    search: true,
    quickSwitcher: true,
    commandPalette: true,
    graph: true,
    backlinks: true,
    outgoingLinks: true,
    outline: true,
    tags: true,
    pagePreview: true,
    dailyNotes: true,
    templates: true,
    noteComposer: true,
    wordCount: true,
    bookmarks: true,
    properties: true,
    canvas: true,
    zettelkasten: true,
    uniqueNote: true,
    randomNote: true,
    slides: true,
    workspaces: true,
    fileRecovery: true
  }
};
function mergeSettings(base, patch) {
  if (!patch) return base;
  return {
    appearance: { ...base.appearance, ...patch.appearance ?? {} },
    editor: { ...base.editor, ...patch.editor ?? {} },
    files: { ...base.files, ...patch.files ?? {} },
    dailyNotes: { ...base.dailyNotes, ...patch.dailyNotes ?? {} },
    templates: { ...base.templates, ...patch.templates ?? {} },
    zettelkasten: { ...base.zettelkasten, ...patch.zettelkasten ?? {} },
    fileRecovery: { ...base.fileRecovery, ...patch.fileRecovery ?? {} },
    graph: { ...base.graph, ...patch.graph ?? {} },
    hotkeys: { ...base.hotkeys, ...patch.hotkeys ?? {} },
    corePlugins: { ...base.corePlugins, ...patch.corePlugins ?? {} }
  };
}

// src/obsidian-desktop/server-api.ts
var IGNORED_NAMES = /* @__PURE__ */ new Set([
  "node_modules",
  "$RECYCLE.BIN",
  "System Volume Information",
  "Thumbs.db"
]);
var MD_EXT = /\.(md|markdown)$/i;
var CANVAS_EXT = /\.canvas$/i;
var CONFIG_DIR = ".obsidian";
var SNAPSHOT_DIR = import_path.default.join(CONFIG_DIR, "snapshots");
var MAX_SNAPSHOTS_PER_FILE = 20;
var WINDOWS_RESERVED = /* @__PURE__ */ new Set(
  ["CON", "PRN", "AUX", "NUL", ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]
);
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function samePath(a, b) {
  const ra = import_path.default.resolve(a);
  const rb = import_path.default.resolve(b);
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}
function sameRel(a, b) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function sanitizeName(raw, fallback, isNote) {
  let n = (raw || "").trim();
  if (isNote) n = n.replace(MD_EXT, "").replace(CANVAS_EXT, "");
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").replace(/^\.+/, "").replace(/[. ]+$/g, "");
  if (!n || n === "." || n === "..") n = fallback;
  if (WINDOWS_RESERVED.has(n.toUpperCase())) n = "_" + n;
  return n.slice(0, 150);
}
function normalizeRel(id) {
  const raw = String(id ?? "");
  if (raw.includes("\0")) throw new Error("Invalid path");
  const rel = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel) return "";
  const segs = rel.split("/").filter((s) => s.length > 0);
  for (const s of segs) {
    if (s === "." || s === "..") throw new Error("Invalid path");
  }
  return segs.join("/");
}
function resolveRealpathOrAncestor(target) {
  const resolved = import_path.default.resolve(target);
  const tail = [];
  let cur = resolved;
  while (!import_fs2.default.existsSync(cur)) {
    const parent = import_path.default.dirname(cur);
    if (parent === cur) return resolved;
    tail.unshift(import_path.default.basename(cur));
    cur = parent;
  }
  try {
    const real = import_fs2.default.realpathSync(cur);
    return tail.length > 0 ? import_path.default.join(real, ...tail) : real;
  } catch {
    return resolved;
  }
}
function isInsideDir(root, target) {
  const r = import_path.default.resolve(root);
  const t = import_path.default.resolve(target);
  const normRoot = r.endsWith(import_path.default.sep) ? r : r + import_path.default.sep;
  if (process.platform === "win32") {
    return t.toLowerCase() === r.toLowerCase() || t.toLowerCase().startsWith(normRoot.toLowerCase());
  }
  return t === r || t.startsWith(normRoot);
}
function absOf(root, rel) {
  const clean = normalizeRel(rel);
  const resolvedRoot = import_path.default.resolve(root);
  const abs = import_path.default.resolve(resolvedRoot, "." + import_path.default.sep + clean);
  if (!isInsideDir(resolvedRoot, abs)) throw new Error("Path escapes vault");
  const realRoot = resolveRealpathOrAncestor(resolvedRoot);
  const realTarget = resolveRealpathOrAncestor(abs);
  if (!isInsideDir(realRoot, realTarget)) throw new Error("Path escapes vault");
  return abs;
}
function dirOf(rel) {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}
function baseOf(rel) {
  const i = rel.lastIndexOf("/");
  return i === -1 ? rel : rel.slice(i + 1);
}
function stripMd(rel) {
  return rel.replace(MD_EXT, "").replace(CANVAS_EXT, "");
}
function joinRel(dir, name) {
  return dir ? `${dir}/${name}` : name;
}
function naturalCompare(a, b) {
  return a.localeCompare(b, void 0, { numeric: true, sensitivity: "base" });
}
var DesktopApiError = class extends Error {
};
function createServerApi(deps) {
  const registryPath = () => import_path.default.join(deps.configDir, "vault-registry.json");
  const settingsPath = () => import_path.default.join(deps.configDir, "settings.json");
  async function readJson(file) {
    try {
      return JSON.parse(await import_fs.promises.readFile(file, "utf8"));
    } catch {
      return null;
    }
  }
  async function writeJson(file, obj) {
    await import_fs.promises.mkdir(import_path.default.dirname(file), { recursive: true });
    const tmp = `${file}.${(0, import_crypto.randomUUID)()}.tmp`;
    await import_fs.promises.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
    await import_fs.promises.rename(tmp, file);
  }
  function vaultKey(root) {
    const resolved = import_path.default.resolve(root);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }
  const vaultLocks = /* @__PURE__ */ new Map();
  const activeWrites = /* @__PURE__ */ new Map();
  const walkInflight = /* @__PURE__ */ new Map();
  function withVaultLock(root, fn) {
    const key = vaultKey(root);
    const prev = vaultLocks.get(key) ?? Promise.resolve();
    const run = async () => {
      activeWrites.set(key, (activeWrites.get(key) ?? 0) + 1);
      walkInflight.delete(key);
      try {
        return await fn();
      } finally {
        walkInflight.delete(key);
        const left = (activeWrites.get(key) ?? 1) - 1;
        if (left <= 0) activeWrites.delete(key);
        else activeWrites.set(key, left);
      }
    };
    const next = prev.then(run, run);
    vaultLocks.set(
      key,
      next.catch(() => void 0)
    );
    return next;
  }
  async function readRegistry() {
    const raw = await readJson(registryPath());
    if (!raw || !Array.isArray(raw.vaults)) return { vaults: [] };
    return raw;
  }
  async function writeRegistry(reg) {
    await writeJson(registryPath(), reg);
  }
  const contentCache = /* @__PURE__ */ new Map();
  function cacheOf(root) {
    const key = process.platform === "win32" ? import_path.default.resolve(root).toLowerCase() : import_path.default.resolve(root);
    let c = contentCache.get(key);
    if (!c) {
      c = /* @__PURE__ */ new Map();
      contentCache.set(key, c);
    }
    return c;
  }
  async function statSafe(abs) {
    try {
      return await import_fs.promises.stat(abs);
    } catch {
      return null;
    }
  }
  async function assertVault(vaultId) {
    if (!vaultId) throw new DesktopApiError("No vault open");
    const root = import_path.default.resolve(vaultId);
    const reg = await readRegistry();
    if (!reg.vaults.some((v) => samePath(v.id, root))) {
      throw new DesktopApiError("Vault is not registered");
    }
    const st = await statSafe(root);
    if (!st || !st.isDirectory()) throw new DesktopApiError("Vault folder not found");
    return root;
  }
  function walkVault(root) {
    const key = vaultKey(root);
    if ((activeWrites.get(key) ?? 0) > 0) {
      return walkVaultUncached(root);
    }
    const existing = walkInflight.get(key);
    if (existing) return existing;
    const p = walkVaultUncached(root).finally(() => {
      if (walkInflight.get(key) === p) walkInflight.delete(key);
    });
    walkInflight.set(key, p);
    return p;
  }
  async function walkVaultUncached(root) {
    const cache = cacheOf(root);
    const dirs = [];
    const rawNotes = [];
    const rawFiles = [];
    async function walk(relDir) {
      let entries;
      try {
        entries = await import_fs.promises.readdir(absOf(root, relDir), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".") || IGNORED_NAMES.has(e.name)) continue;
        const rel = joinRel(relDir, e.name);
        if (e.isDirectory()) {
          dirs.push({ rel, name: e.name });
          await walk(rel);
        } else if (e.isFile() && (MD_EXT.test(e.name) || CANVAS_EXT.test(e.name))) {
          const st = await statSafe(absOf(root, rel));
          if (!st) continue;
          rawNotes.push({
            rel,
            name: e.name.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
            mtimeMs: st.mtimeMs,
            size: st.size,
            birthMs: st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs
          });
        } else if (e.isFile()) {
          const st = await statSafe(absOf(root, rel));
          if (!st) continue;
          rawFiles.push({
            rel,
            name: e.name.replace(/\.[^.]+$/, ""),
            ext: e.name.includes(".") ? e.name.slice(e.name.lastIndexOf(".") + 1).toLowerCase() : "",
            size: st.size,
            mtimeMs: st.mtimeMs
          });
        }
      }
    }
    await walk("");
    rawNotes.sort((a, b) => naturalCompare(a.rel, b.rel));
    dirs.sort((a, b) => naturalCompare(a.rel, b.rel));
    rawFiles.sort((a, b) => naturalCompare(a.rel, b.rel));
    const notes = [];
    for (const n of rawNotes) {
      const hit = cache.get(n.rel);
      let content;
      if (hit && hit.mtimeMs === n.mtimeMs && hit.size === n.size) {
        content = hit.content;
      } else {
        try {
          content = await import_fs.promises.readFile(absOf(root, n.rel), "utf8");
        } catch {
          content = "";
        }
        cache.set(n.rel, { mtimeMs: n.mtimeMs, size: n.size, content });
      }
      notes.push({
        rel: n.rel,
        name: n.name,
        dirRel: dirOf(n.rel),
        content,
        mtimeMs: n.mtimeMs,
        size: n.size,
        createdAt: new Date(n.birthMs).toISOString(),
        updatedAt: new Date(n.mtimeMs).toISOString()
      });
    }
    const live = new Set(notes.map((n) => n.rel));
    for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key);
    const dirRows = [];
    let i = 0;
    while (i < dirs.length) {
      const parent = dirOf(dirs[i].rel);
      let j = i;
      while (j < dirs.length && dirOf(dirs[j].rel) === parent) j++;
      for (let k = i; k < j; k++) {
        dirRows.push({ ...dirs[k], parentRel: parent || null, position: k - i });
      }
      i = j;
    }
    const files = rawFiles.map((f) => ({
      id: f.rel,
      vaultId: root,
      folderId: dirOf(f.rel) || null,
      name: f.name,
      ext: f.ext,
      size: f.size,
      updatedAt: new Date(f.mtimeMs).toISOString()
    }));
    return { dirs: dirRows, notes, files };
  }
  function notePosition(rows, index2) {
    const folder = rows[index2].dirRel;
    let pos = 0;
    for (let i = 0; i <= index2; i++) if (rows[i].dirRel === folder) pos++;
    return pos - 1;
  }
  function toNoteMetas(root, notes) {
    return notes.map((n, i) => ({
      id: n.rel,
      vaultId: root,
      folderId: n.dirRel || null,
      name: n.name,
      path: n.rel.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
      position: notePosition(notes, i),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt
    }));
  }
  function buildIndexEntries(notes) {
    return notes.map((n) => {
      const isCanvas = CANVAS_EXT.test(n.rel);
      if (isCanvas) {
        return {
          id: n.rel,
          name: n.name,
          path: n.rel.replace(CANVAS_EXT, ""),
          aliases: [],
          tags: [],
          kind: "canvas"
        };
      }
      const fm = parseFrontmatter(n.content);
      const aliases = Array.isArray(fm.data.aliases) ? fm.data.aliases.filter((a) => typeof a === "string") : typeof fm.data.aliases === "string" ? [fm.data.aliases] : [];
      return {
        id: n.rel,
        name: n.name,
        path: stripMd(n.rel),
        aliases,
        tags: extractTags(n.content),
        kind: "note"
      };
    });
  }
  async function writeFileAtomic(abs, content) {
    await import_fs.promises.mkdir(import_path.default.dirname(abs), { recursive: true });
    const tmp = `${abs}.${(0, import_crypto.randomUUID)()}.obsidian-tmp`;
    await import_fs.promises.writeFile(tmp, content, "utf8");
    await import_fs.promises.rename(tmp, abs);
  }
  async function writeCachedNote(root, abs, rel, content) {
    await writeFileAtomic(abs, content);
    const st = await statSafe(abs);
    cacheOf(root).set(rel, {
      mtimeMs: st?.mtimeMs ?? Date.now(),
      size: st?.size ?? Buffer.byteLength(content, "utf8"),
      content
    });
  }
  function rewriteLinksInContent(content, maps, moves, allAfterBasenames) {
    if (moves.length === 0) return { content, count: 0 };
    const moveByOldId = new Map(moves.map((m) => [m.from, m]));
    const stripped = stripCode(content);
    let count = 0;
    let out = content.replace(/(!?)\[\[([^\[\]\n]+)\]\]/g, (full, bang, inner, offset) => {
      if (stripped.slice(offset, offset + full.length) !== full) return full;
      const hash = inner.indexOf("#");
      const pipe = inner.indexOf("|");
      const splits = [hash, pipe].filter((i) => i >= 0);
      const splitAt = splits.length > 0 ? Math.min(...splits) : -1;
      const target = splitAt >= 0 ? inner.slice(0, splitAt) : inner;
      const rest = splitAt >= 0 ? inner.slice(splitAt) : "";
      const key = target.trim();
      if (!key) return full;
      const resolved = resolveLink(key, maps);
      const move = resolved ? moveByOldId.get(resolved.id) : void 0;
      if (!move) return full;
      const newBaseNoExt = stripMd(baseOf(move.to));
      const newStem = CANVAS_EXT.test(move.to) ? baseOf(move.to) : newBaseNoExt;
      const needsFull = key.includes("/") || (allAfterBasenames?.get(newBaseNoExt.toLowerCase()) ?? 0) > 1;
      const newTarget = needsFull ? CANVAS_EXT.test(move.to) ? move.to : stripMd(move.to) : newStem;
      const rebuilt = `${bang}[[${newTarget}${rest}]]`;
      if (rebuilt !== full) count++;
      return rebuilt;
    });
    const strippedAfterWiki = stripCode(out);
    out = out.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (full, text, raw, offset) => {
      if (strippedAfterWiki.slice(offset, offset + full.length) !== full) return full;
      const hrefRaw = raw.trim();
      let href;
      if (hrefRaw.startsWith("<")) {
        const close = hrefRaw.indexOf(">");
        href = hrefRaw.slice(1, close >= 0 ? close : hrefRaw.length).trim();
      } else {
        href = hrefRaw.split(/\s+/)[0];
      }
      if (!href || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("#")) return full;
      const fragIdx = href.indexOf("#");
      const frag = fragIdx >= 0 ? href.slice(fragIdx) : "";
      const body = fragIdx >= 0 ? href.slice(0, fragIdx) : href;
      let decoded = body;
      try {
        decoded = decodeURIComponent(body);
      } catch {
      }
      const resolved = resolveLink(decoded, maps);
      const move = resolved ? moveByOldId.get(resolved.id) : void 0;
      if (!move) return full;
      const newBaseNoExt = stripMd(baseOf(move.to));
      const newStem = CANVAS_EXT.test(move.to) ? baseOf(move.to) : newBaseNoExt;
      const needsFull = decoded.includes("/") || (allAfterBasenames?.get(newBaseNoExt.toLowerCase()) ?? 0) > 1;
      const nextTarget = needsFull ? CANVAS_EXT.test(move.to) ? move.to : stripMd(move.to) : newStem;
      const rebuilt = `[${text}](<${nextTarget}${frag}>)`;
      if (rebuilt !== full) count++;
      return rebuilt;
    });
    return { content: out, count };
  }
  async function applyMovesAndRewrite(root, before, moves) {
    const maps = buildIndexMap(buildIndexEntries(before.notes));
    const movedSet = new Map(moves.map((m) => [m.from, m]));
    const afterCounts = /* @__PURE__ */ new Map();
    for (const row of before.notes) {
      const targetRel = movedSet.get(row.rel)?.to ?? row.rel;
      const bn = stripMd(baseOf(targetRel)).toLowerCase();
      afterCounts.set(bn, (afterCounts.get(bn) ?? 0) + 1);
    }
    let total = 0;
    for (const row of before.notes) {
      const move = movedSet.get(row.rel);
      const targetRel = move ? move.to : row.rel;
      if (CANVAS_EXT.test(targetRel)) {
        const parsed = parseCanvas(row.content);
        let changed = false;
        for (const node of parsed.nodes) {
          if (node.type !== "file" || !node.file) continue;
          const hit = moves.find((m) => sameRel(m.from, node.file)) ?? (() => {
            const r = resolveLink(stripMd(node.file), maps);
            return r ? moves.find((m) => m.from === r.id) : void 0;
          })();
          if (hit) {
            node.file = hit.to;
            changed = true;
            total++;
          }
        }
        if (changed) {
          await writeCachedNote(root, absOf(root, targetRel), targetRel, serializeCanvas(parsed));
        }
        continue;
      }
      const { content, count } = rewriteLinksInContent(row.content, maps, moves, afterCounts);
      if (count > 0 || move !== void 0) {
        await writeCachedNote(root, absOf(root, targetRel), targetRel, content);
        total += count;
      }
    }
    const cache = cacheOf(root);
    for (const m of moves) {
      if (m.from !== m.to) cache.delete(m.from);
    }
    return total;
  }
  async function readBookmarks(root) {
    const raw = await readJson(import_path.default.join(root, CONFIG_DIR, "bookmarks.json"));
    return Array.isArray(raw) ? raw : [];
  }
  async function writeBookmarks(root, items) {
    await writeJson(import_path.default.join(root, CONFIG_DIR, "bookmarks.json"), items);
  }
  async function syncBookmarksOnMoves(root, moves, folderMove) {
    const items = await readBookmarks(root);
    if (items.length === 0) return;
    let changed = false;
    const moveMap = new Map(moves.map((m) => [m.from.toLowerCase(), m.to]));
    const next = items.map((b) => {
      if (!b.itemId) return b;
      if (folderMove && b.itemType === "folder" && sameRel(b.itemId, folderMove.from)) {
        changed = true;
        return { ...b, itemId: folderMove.to, title: baseOf(folderMove.to) };
      }
      const mapped = moveMap.get(b.itemId.toLowerCase());
      if (mapped) {
        changed = true;
        return { ...b, itemId: mapped, title: stripMd(baseOf(mapped)) };
      }
      if (folderMove && b.itemId.toLowerCase().startsWith(folderMove.from.toLowerCase() + "/")) {
        const sub = folderMove.to + b.itemId.slice(folderMove.from.length);
        changed = true;
        return { ...b, itemId: sub, title: b.itemType === "folder" ? baseOf(sub) : stripMd(baseOf(sub)) };
      }
      return b;
    });
    if (changed) await writeBookmarks(root, next);
  }
  async function removeBookmarksForPrefix(root, rel, isFolder) {
    const items = await readBookmarks(root);
    if (items.length === 0) return;
    const next = items.filter((b) => {
      if (!b.itemId) return true;
      if (sameRel(b.itemId, rel)) return false;
      if (isFolder && b.itemId.toLowerCase().startsWith(rel.toLowerCase() + "/")) return false;
      return true;
    });
    if (next.length !== items.length) await writeBookmarks(root, next);
  }
  async function listVaults() {
    const reg = await readRegistry();
    const out = [];
    const kept = [];
    for (const v of reg.vaults) {
      const st = await statSafe(v.id);
      if (!st || !st.isDirectory()) continue;
      kept.push(v);
      const walk = await walkVault(import_path.default.resolve(v.id));
      out.push({
        id: v.id,
        name: v.name,
        noteCount: walk.notes.length,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt
      });
    }
    if (kept.length !== reg.vaults.length) await writeRegistry({ vaults: kept });
    return out;
  }
  async function createVault(name) {
    const cleanName = (name || "").trim() || "Untitled vault";
    const picked = await deps.createVaultFolder(cleanName);
    if (!picked) throw new DesktopApiError("canceled");
    const root = import_path.default.resolve(picked.root);
    const reg = await readRegistry();
    const existing = reg.vaults.find((v) => import_path.default.resolve(v.id) === root);
    const stamp = nowIso();
    if (existing) {
      existing.name = picked.name;
      existing.updatedAt = stamp;
    } else {
      reg.vaults.push({ id: root, name: picked.name, createdAt: stamp, updatedAt: stamp });
    }
    await writeRegistry(reg);
    const walk = await walkVault(root);
    return {
      id: root,
      name: picked.name,
      noteCount: walk.notes.length,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp
    };
  }
  async function deleteVault(id) {
    const root = import_path.default.resolve(String(id));
    const reg = await readRegistry();
    reg.vaults = reg.vaults.filter((v) => import_path.default.resolve(v.id) !== root);
    await writeRegistry(reg);
    contentCache.delete(root);
    return { ok: true };
  }
  async function tree(vaultId) {
    const root = await assertVault(vaultId);
    const { dirs, notes, files } = await walkVault(root);
    return {
      folders: dirs.map((d) => ({
        id: d.rel,
        vaultId: root,
        name: d.name,
        parentId: d.parentRel,
        position: d.position
      })),
      notes: toNoteMetas(root, notes),
      files
    };
  }
  async function index(vaultId) {
    const root = await assertVault(vaultId);
    const { notes } = await walkVault(root);
    return buildIndexEntries(notes);
  }
  async function graph(vaultId) {
    const root = await assertVault(vaultId);
    const { notes } = await walkVault(root);
    const index2 = buildIndexEntries(notes);
    const contents = new Map(notes.map((n) => [n.rel, n.content]));
    const maps = buildIndexMap(index2);
    const nodes = index2.map((e) => ({ id: e.id, name: e.name, path: e.path, degree: 0, unresolved: false }));
    const unresolvedIds = /* @__PURE__ */ new Map();
    const linkSet = /* @__PURE__ */ new Set();
    const links = [];
    const canvasFileTargets = /* @__PURE__ */ new Map();
    for (const e of index2) {
      if (e.kind !== "canvas") continue;
      const c = parseCanvas(contents.get(e.id) ?? "");
      const targets = /* @__PURE__ */ new Set();
      for (const node of c.nodes) {
        if (node.type !== "file" || !node.file) continue;
        const t = node.file.replace(/\\/g, "/").replace(/\.md$/i, "").replace(/\.canvas$/i, "");
        const byPath = maps.byPath.get(t) ?? maps.byPath.get(t + ".md");
        if (byPath && byPath.id !== e.id) targets.add(byPath.id);
      }
      if (targets.size > 0) canvasFileTargets.set(e.id, targets);
    }
    for (const e of index2) {
      const content = contents.get(e.id) ?? "";
      const seen = /* @__PURE__ */ new Set();
      const extraTargets = canvasFileTargets.get(e.id);
      if (extraTargets) {
        for (const targetId of extraTargets) {
          const key = `${e.id}->${targetId}`;
          if (!linkSet.has(key)) {
            linkSet.add(key);
            links.push({ source: e.id, target: targetId });
          }
        }
      }
      for (const link of extractLinks(content)) {
        if (link.embed) continue;
        const resolved = resolveLink(link.target, maps);
        if (resolved) {
          if (resolved.id === e.id || seen.has(resolved.id)) continue;
          seen.add(resolved.id);
          const key = `${e.id}->${resolved.id}`;
          if (linkSet.has(key)) continue;
          linkSet.add(key);
          links.push({ source: e.id, target: resolved.id });
        } else {
          const key = "unres:" + link.target.toLowerCase();
          if (!unresolvedIds.has(key)) {
            const node = { id: key, name: link.target, path: link.target, degree: 0, unresolved: true };
            unresolvedIds.set(key, node);
            nodes.push(node);
          }
          const un = unresolvedIds.get(key);
          const k2 = `${e.id}->${un.id}`;
          if (!linkSet.has(k2)) {
            linkSet.add(k2);
            links.push({ source: e.id, target: un.id });
          }
        }
      }
    }
    const deg = /* @__PURE__ */ new Map();
    for (const l of links) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    }
    for (const n of nodes) n.degree = deg.get(n.id) ?? 0;
    return { nodes, links };
  }
  async function tags(vaultId) {
    const root = await assertVault(vaultId);
    const { notes } = await walkVault(root);
    const counts = /* @__PURE__ */ new Map();
    for (const t of buildIndexEntries(notes)) {
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
  async function search(vaultId, query, caseSensitive = false) {
    if (!query.trim()) return { hits: [], totalMatches: 0, totalFiles: 0, query };
    const root = await assertVault(vaultId);
    const { notes } = await walkVault(root);
    const index2 = buildIndexEntries(notes);
    const contents = new Map(notes.map((n) => [n.rel, n.content]));
    const expr = parseSearchQuery(query);
    const terms = searchTerms(expr);
    const regexSpecs = searchRegexes(expr);
    const hits = [];
    let totalMatches = 0;
    for (const e of index2) {
      const content = contents.get(e.id) ?? "";
      const ctx = { content, name: e.name, path: e.path, tags: e.tags, caseSensitive };
      if (!matchSearchExpr(expr, ctx)) continue;
      const snippets = [];
      let matchCount = 0;
      for (const term of terms) {
        const needle = caseSensitive ? term : term.toLowerCase();
        const hay = caseSensitive ? content : content.toLowerCase();
        let idx = hay.indexOf(needle);
        let found = 0;
        while (idx !== -1) {
          if (snippets.length < 5) snippets.push(makeSnippet2(content, idx, needle.length));
          found++;
          idx = hay.indexOf(needle, idx + needle.length);
        }
        matchCount += found;
      }
      for (const spec of regexSpecs) {
        const base = compileSearchRegex(spec.pattern, spec.flags, caseSensitive);
        if (!base) continue;
        const globalRe = new RegExp(base.source, base.flags.includes("g") ? base.flags : base.flags + "g");
        for (const m of content.matchAll(globalRe)) {
          if (!m[0]) break;
          if (snippets.length < 5) snippets.push(makeSnippet2(content, m.index ?? 0, m[0].length));
          matchCount++;
        }
      }
      if (snippets.length === 0) {
        snippets.push({ before: "", match: e.name, after: "" });
        matchCount = 1;
      }
      totalMatches += matchCount;
      hits.push({ noteId: e.id, name: e.name, path: e.path, matchCount, snippets });
    }
    hits.sort((a, b) => b.matchCount - a.matchCount || a.path.localeCompare(b.path));
    return { hits, totalMatches, totalFiles: hits.length, query };
  }
  function isIgnoredRel(rel) {
    return rel !== "" && rel.split("/").some((s) => s.startsWith(".") || IGNORED_NAMES.has(s));
  }
  async function readSingleNote(root, rel) {
    if (!rel || isIgnoredRel(rel) || !MD_EXT.test(rel) && !CANVAS_EXT.test(rel)) {
      throw new DesktopApiError("Note not found");
    }
    const abs = absOf(root, rel);
    const st = await statSafe(abs);
    if (!st || !st.isFile()) throw new DesktopApiError("Note not found");
    const cache = cacheOf(root);
    const hit = cache.get(rel);
    let content;
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      content = hit.content;
    } else {
      content = await import_fs.promises.readFile(abs, "utf8");
      cache.set(rel, { mtimeMs: st.mtimeMs, size: st.size, content });
    }
    const dirRel = dirOf(rel);
    const entries = await import_fs.promises.readdir(import_path.default.dirname(abs), { withFileTypes: true });
    const siblingRels = entries.filter((e) => e.isFile() && !e.name.startsWith(".") && !IGNORED_NAMES.has(e.name) && (MD_EXT.test(e.name) || CANVAS_EXT.test(e.name))).map((e) => joinRel(dirRel, e.name)).sort(naturalCompare);
    const position = Math.max(0, siblingRels.indexOf(rel));
    const birthMs = st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
    const fileName = import_path.default.posix.basename(rel);
    return {
      id: rel,
      vaultId: root,
      folderId: dirRel || null,
      name: fileName.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
      path: rel.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
      position,
      createdAt: new Date(birthMs).toISOString(),
      updatedAt: new Date(st.mtimeMs).toISOString(),
      content
    };
  }
  async function note(id, ctx) {
    const root = await assertVault(ctx.vaultId);
    return readSingleNote(root, normalizeRel(id));
  }
  async function createEntryFile(vaultId, name, folderId, ext, content) {
    const root = await assertVault(vaultId);
    return withVaultLock(root, async () => {
      const dirRel = folderId ? normalizeRel(folderId) : "";
      if (isIgnoredRel(dirRel)) throw new DesktopApiError("Folder not found");
      const absDir = dirRel ? absOf(root, dirRel) : root;
      const dirSt = await statSafe(absDir);
      if (!dirSt || !dirSt.isDirectory()) {
        throw new DesktopApiError("Folder not found");
      }
      const entries = await import_fs.promises.readdir(absDir, { withFileTypes: true });
      const taken = new Set(
        entries.filter((e) => e.isFile() && !e.name.startsWith(".") && !IGNORED_NAMES.has(e.name) && (MD_EXT.test(e.name) || CANVAS_EXT.test(e.name))).map((e) => e.name.replace(MD_EXT, "").replace(CANVAS_EXT, "").toLowerCase())
      );
      const baseName = sanitizeName(name, "Untitled", true);
      let finalName = baseName;
      let n = 0;
      while (taken.has(finalName.toLowerCase())) finalName = `${baseName} ${++n}`;
      const rel = joinRel(dirRel, finalName + ext);
      await writeCachedNote(root, absOf(root, rel), rel, content);
      return readSingleNote(root, rel);
    });
  }
  async function createNote(vaultId, name, folderId, content = "") {
    return createEntryFile(vaultId, name, folderId, ".md", content ?? "");
  }
  async function patchNote(id, data, ctx) {
    const root = await assertVault(ctx.vaultId);
    return withVaultLock(root, async () => {
      const oldRel = normalizeRel(id);
      const wantsRename = typeof data.name === "string" && data.name.trim() !== "";
      const wantsMove = data.folderId !== void 0;
      if (!wantsRename && !wantsMove) {
        const cur = await readSingleNote(root, oldRel);
        if (typeof data.content === "string") {
          if (data.content !== cur.content) await maybeSnapshot(root, oldRel, cur.content);
          await writeCachedNote(root, absOf(root, oldRel), oldRel, data.content);
          return readSingleNote(root, oldRel);
        }
        return cur;
      }
      const walk = await walkVault(root);
      const row = walk.notes.find((n) => n.rel === oldRel);
      if (!row) throw new DesktopApiError("Note not found");
      let newName = row.name;
      if (wantsRename) newName = sanitizeName(data.name, row.name, true);
      let newDir = row.dirRel;
      if (wantsMove) {
        newDir = data.folderId ? normalizeRel(data.folderId) : "";
        if (newDir && !walk.dirs.some((d) => sameRel(d.rel, newDir))) {
          throw new DesktopApiError("Target folder not found");
        }
      }
      const extMatch = oldRel.match(/\.(canvas|md|markdown)$/i);
      const ext = extMatch ? extMatch[0].toLowerCase() : ".md";
      const newRel = joinRel(newDir, newName + ext);
      const structural = newRel !== oldRel;
      if (structural) {
        const clash = walk.notes.some(
          (n) => n.rel !== oldRel && (n.rel.toLowerCase() === newRel.toLowerCase() || sameRel(n.dirRel, newDir) && n.name.toLowerCase() === newName.toLowerCase())
        );
        if (clash) throw new DesktopApiError("A note with that name already exists in that folder");
      }
      if (!structural) {
        if (typeof data.content === "string") {
          if (data.content !== row.content) await maybeSnapshot(root, oldRel, row.content);
          await writeCachedNote(root, absOf(root, oldRel), oldRel, data.content);
        }
        return readSingleNote(root, oldRel);
      }
      if (typeof data.content === "string") {
        await writeCachedNote(root, absOf(root, oldRel), oldRel, data.content);
        row.content = data.content;
      }
      const absOld = absOf(root, oldRel);
      const absNew = absOf(root, newRel);
      await import_fs.promises.mkdir(import_path.default.dirname(absNew), { recursive: true });
      const caseOnlyRename = sameRel(oldRel, newRel);
      if (!caseOnlyRename && import_fs2.default.existsSync(absNew)) {
        throw new DesktopApiError("A file with that name already exists");
      }
      if (caseOnlyRename) {
        const tmpAbs = `${absOld}.${(0, import_crypto.randomUUID)()}.case-tmp`;
        await import_fs.promises.rename(absOld, tmpAbs);
        await import_fs.promises.rename(tmpAbs, absNew);
      } else {
        await import_fs.promises.rename(absOld, absNew);
      }
      await applyMovesAndRewrite(root, walk, [{ from: oldRel, to: newRel }]);
      await syncBookmarksOnMoves(root, [{ from: oldRel, to: newRel }]);
      return readSingleNote(root, newRel);
    });
  }
  async function deleteNote(id, ctx) {
    const root = await assertVault(ctx.vaultId);
    return withVaultLock(root, async () => {
      const rel = normalizeRel(id);
      const abs = absOf(root, rel);
      if (!import_fs2.default.existsSync(abs)) throw new DesktopApiError("Note not found");
      try {
        const prev = await import_fs.promises.readFile(abs, "utf8");
        await maybeSnapshot(root, rel, prev, 0);
      } catch {
      }
      await deps.trash(abs);
      cacheOf(root).delete(rel);
      await removeBookmarksForPrefix(root, rel, false);
      return { ok: true };
    });
  }
  async function backlinks(noteId, ctx) {
    const root = await assertVault(ctx.vaultId);
    const targetRel = normalizeRel(noteId);
    const { notes } = await walkVault(root);
    const index2 = buildIndexEntries(notes);
    const contents = new Map(notes.map((n) => [n.rel, n.content]));
    const maps = buildIndexMap(index2);
    const selfEntry = index2.find((e) => e.id === targetRel);
    const selfRow = notes.find((n) => n.rel === targetRel);
    if (!selfRow) return { noteName: "", linked: [], unlinked: [] };
    const names = /* @__PURE__ */ new Set([selfRow.name]);
    selfEntry?.aliases.forEach((a) => names.add(a));
    const sortedNames = [...names].map((n) => n.trim()).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
    const metaById = new Map(index2.map((e) => [e.id, e]));
    const linkedRaw = /* @__PURE__ */ new Map();
    const unlinked = [];
    for (const e of index2) {
      if (e.id === targetRel) continue;
      const content = contents.get(e.id) ?? "";
      const stripped = stripCode(content);
      const meta = metaById.get(e.id);
      for (const m of stripped.matchAll(WIKILINK_RE)) {
        const raw = m[0];
        if (raw.startsWith("!")) continue;
        const inner = raw.slice(2, -2).split("|")[0].split("#")[0].trim();
        const resolved = resolveLink(inner, maps);
        if (resolved?.id === targetRel) {
          const { before, match, after } = makeSnippet2(content, m.index ?? 0, raw.length);
          const entry = { noteId: e.id, noteName: meta.name, path: meta.path, before, match, after, occurrences: 1 };
          if (!linkedRaw.has(e.id)) linkedRaw.set(e.id, [entry]);
          else {
            const list = linkedRaw.get(e.id);
            list[0].occurrences++;
            if (list.length < 5) list.push(entry);
          }
        }
      }
      if (sortedNames.length > 0) {
        const escaped = sortedNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
        let firstMatch = null;
        let count = 0;
        for (const m of content.matchAll(re)) {
          const idx = m.index ?? 0;
          if (isInsideLinkOrCode(content, idx, m[0].length)) continue;
          count++;
          if (!firstMatch) firstMatch = { index: idx, length: m[0].length };
        }
        if (count > 0 && firstMatch) {
          const { before, match, after } = makeSnippet2(content, firstMatch.index, firstMatch.length);
          unlinked.push({ noteId: e.id, noteName: meta.name, path: meta.path, before, match, after, occurrences: count });
        }
      }
    }
    const linked = [...linkedRaw.values()].map((matches) => matches[0]);
    return { noteName: selfRow.name, linked, unlinked };
  }
  async function createFolder(vaultId, name, parentId) {
    const root = await assertVault(vaultId);
    return withVaultLock(root, async () => {
      const parentRel = parentId ? normalizeRel(parentId) : "";
      const walk = await walkVault(root);
      if (parentRel && !walk.dirs.some((d) => sameRel(d.rel, parentRel))) {
        throw new DesktopApiError("Parent folder not found");
      }
      const siblings = new Set(walk.dirs.filter((d) => (d.parentRel ?? "").toLowerCase() === parentRel.toLowerCase()).map((d) => d.name.toLowerCase()));
      let finalName = sanitizeName(name, "New folder", false);
      let n = 0;
      while (siblings.has(finalName.toLowerCase())) finalName = `${sanitizeName(name, "New folder", false)} ${++n}`;
      const rel = joinRel(parentRel, finalName);
      await import_fs.promises.mkdir(absOf(root, rel), { recursive: true });
      const parent = walk.dirs.find((d) => sameRel(d.rel, parentRel));
      return {
        id: rel,
        vaultId: root,
        name: finalName,
        parentId: parent ? parent.rel : null,
        position: siblings.size
      };
    });
  }
  async function patchFolder(id, data, ctx) {
    const root = await assertVault(ctx.vaultId);
    return withVaultLock(root, async () => {
      const oldRel = normalizeRel(id);
      const walk = await walkVault(root);
      const row = walk.dirs.find((d) => sameRel(d.rel, oldRel));
      if (!row) throw new DesktopApiError("Folder not found");
      const wantsRename = typeof data.name === "string" && data.name.trim() !== "";
      const wantsMove = data.parentId !== void 0;
      let newName = row.name;
      if (wantsRename) newName = sanitizeName(data.name, row.name, false);
      let newParent = row.parentRel ?? "";
      if (wantsMove) {
        newParent = data.parentId ? normalizeRel(data.parentId) : "";
        if (newParent) {
          let cur = newParent;
          while (cur) {
            if (sameRel(cur, row.rel)) throw new DesktopApiError("Cannot move a folder into itself");
            cur = dirOf(cur) || null;
          }
          if (!walk.dirs.some((d) => sameRel(d.rel, newParent))) {
            throw new DesktopApiError("Target parent folder not found");
          }
        }
      }
      const newRel = joinRel(newParent, newName);
      if (newRel === row.rel) {
        return { id: row.rel, vaultId: root, name: row.name, parentId: row.parentRel, position: row.position };
      }
      const clash = walk.dirs.some((d) => d.rel !== row.rel && d.rel.toLowerCase() === newRel.toLowerCase());
      if (clash) throw new DesktopApiError("A folder with that name already exists");
      const absOld = absOf(root, row.rel);
      const absNew = absOf(root, newRel);
      await import_fs.promises.mkdir(import_path.default.dirname(absNew), { recursive: true });
      const caseOnlyRename = sameRel(row.rel, newRel);
      if (!caseOnlyRename && import_fs2.default.existsSync(absNew)) {
        throw new DesktopApiError("A folder with that name already exists");
      }
      if (caseOnlyRename) {
        const tmpAbs = `${absOld}.${(0, import_crypto.randomUUID)()}.case-tmp`;
        await import_fs.promises.rename(absOld, tmpAbs);
        await import_fs.promises.rename(tmpAbs, absNew);
      } else {
        await import_fs.promises.rename(absOld, absNew);
      }
      const moves = walk.notes.filter((n) => n.rel === row.rel || n.rel.toLowerCase().startsWith(row.rel.toLowerCase() + "/")).map((n) => ({ from: n.rel, to: newRel + n.rel.slice(row.rel.length) }));
      if (moves.length > 0) await applyMovesAndRewrite(root, walk, moves);
      await syncBookmarksOnMoves(root, moves, { from: row.rel, to: newRel });
      const siblings = (await walkVault(root)).dirs.filter((d) => (d.parentRel ?? "").toLowerCase() === newParent.toLowerCase());
      return {
        id: newRel,
        vaultId: root,
        name: newName,
        parentId: newParent || null,
        position: Math.max(0, siblings.findIndex((d) => d.rel === newRel))
      };
    });
  }
  async function deleteFolder(id, ctx) {
    const root = await assertVault(ctx.vaultId);
    return withVaultLock(root, async () => {
      const rel = normalizeRel(id);
      const abs = absOf(root, rel);
      if (!import_fs2.default.existsSync(abs)) throw new DesktopApiError("Folder not found");
      const walk = await walkVault(root);
      for (const n of walk.notes) {
        if (n.rel.toLowerCase().startsWith(rel.toLowerCase() + "/")) {
          await maybeSnapshot(root, n.rel, n.content, 0);
        }
      }
      await deps.trash(abs);
      const cache = cacheOf(root);
      for (const key of [...cache.keys()]) {
        if (sameRel(key, rel) || key.toLowerCase().startsWith(rel.toLowerCase() + "/")) cache.delete(key);
      }
      await removeBookmarksForPrefix(root, rel, true);
      return { ok: true };
    });
  }
  async function bookmarks(vaultId) {
    const root = await assertVault(vaultId);
    return readBookmarks(root);
  }
  async function addBookmark(data) {
    const root = await assertVault(data.vaultId);
    const items = await readBookmarks(root);
    const item = {
      id: (0, import_crypto.randomUUID)(),
      itemType: data.itemType ?? "note",
      itemId: data.itemId ?? null,
      title: data.title ?? "Untitled",
      subtitle: data.subtitle ?? "",
      query: data.query ?? "",
      position: items.length,
      createdAt: nowIso()
    };
    items.push(item);
    await writeBookmarks(root, items);
    return item;
  }
  async function removeBookmark(id, ctx) {
    const root = await assertVault(ctx.vaultId);
    const items = await readBookmarks(root);
    await writeBookmarks(
      root,
      items.filter((b) => b.id !== id)
    );
    return { ok: true };
  }
  const lastSnapshotAt = /* @__PURE__ */ new Map();
  async function maybeSnapshot(root, rel, previousContent, forceIntervalMin) {
    try {
      const settings = await getSettings();
      if (!settings.corePlugins.fileRecovery || !settings.fileRecovery.enabled) return;
      const intervalMin = forceIntervalMin ?? settings.fileRecovery.intervalMinutes ?? 5;
      const key = root + "\0" + rel;
      const now = Date.now();
      const last = lastSnapshotAt.get(key) ?? 0;
      if (now - last < intervalMin * 6e4) return;
      const dir = import_path.default.join(root, SNAPSHOT_DIR, dirOf(rel), baseOf(rel));
      await import_fs.promises.mkdir(dir, { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      await import_fs.promises.writeFile(import_path.default.join(dir, stamp), previousContent, "utf8");
      lastSnapshotAt.set(key, now);
      const retentionDays = settings.fileRecovery.retentionDays ?? 30;
      const entries = await import_fs.promises.readdir(dir);
      const stats = await Promise.all(
        entries.map(async (e) => {
          const st = await statSafe(import_path.default.join(dir, e));
          return { name: e, mtime: st?.mtimeMs ?? 0 };
        })
      );
      const cutoff = now - retentionDays * 864e5;
      for (const s of stats) {
        if (s.mtime < cutoff) await import_fs.promises.rm(import_path.default.join(dir, s.name), { force: true }).catch(() => void 0);
      }
      const kept = (await import_fs.promises.readdir(dir)).sort();
      while (kept.length > MAX_SNAPSHOTS_PER_FILE) {
        const victim = kept.shift();
        await import_fs.promises.rm(import_path.default.join(dir, victim), { force: true }).catch(() => void 0);
      }
    } catch {
    }
  }
  async function listSnapshots(vaultId) {
    const root = await assertVault(vaultId);
    const out = [];
    const { notes } = await walkVault(root);
    const live = new Map(notes.map((n) => [n.rel, n]));
    const snapRoot = import_path.default.join(root, SNAPSHOT_DIR);
    if (!await statSafe(snapRoot)) return [];
    const files = [];
    async function collect(dir) {
      let entries;
      try {
        entries = await import_fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) await collect(import_path.default.join(dir, e.name));
        else files.push(import_path.default.relative(snapRoot, import_path.default.join(dir, e.name)).split(import_path.default.sep).join("/"));
      }
    }
    await collect(snapRoot);
    const groups = /* @__PURE__ */ new Map();
    for (const f of files) {
      const i = f.lastIndexOf("/");
      if (i === -1) continue;
      const noteKey = f.slice(0, i);
      const stamp = f.slice(i + 1);
      const st = await statSafe(import_path.default.join(snapRoot, f));
      groups.set(noteKey, [
        ...groups.get(noteKey) ?? [],
        { id: noteKey + "::" + stamp, timestamp: new Date(st?.mtimeMs ?? 0).toISOString(), size: st?.size ?? 0 }
      ]);
    }
    for (const [noteKey, snaps] of groups) {
      snaps.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const row = live.get(noteKey);
      const ext = CANVAS_EXT.test(noteKey) ? ".canvas" : ".md";
      const base = noteKey.slice(0, -ext.length) || noteKey;
      const name = baseOf(base);
      out.push({
        noteId: row ? row.rel : noteKey,
        name: row ? row.name : name,
        count: snaps.length,
        latest: snaps[0]?.timestamp ?? "",
        snapshots: snaps
      });
    }
    out.sort((a, b) => b.latest.localeCompare(a.latest));
    return out;
  }
  async function readSnapshot(snapshotId, ctx) {
    const root = await assertVault(ctx.vaultId);
    const sep = snapshotId.lastIndexOf("::");
    if (sep === -1) throw new DesktopApiError("Invalid snapshot id");
    const noteKey = snapshotId.slice(0, sep);
    const stamp = snapshotId.slice(sep + 2);
    const abs = import_path.default.join(root, SNAPSHOT_DIR, ...noteKey.split("/"), stamp);
    const normSnapRoot = import_path.default.resolve(import_path.default.join(root, SNAPSHOT_DIR)) + import_path.default.sep;
    if (!import_path.default.resolve(abs).startsWith(normSnapRoot)) throw new DesktopApiError("Invalid snapshot path");
    try {
      const content = await import_fs.promises.readFile(abs, "utf8");
      return { content, noteId: noteKey };
    } catch {
      throw new DesktopApiError("Snapshot not found");
    }
  }
  async function restoreSnapshot(snapshotId, ctx) {
    const root = await assertVault(ctx.vaultId);
    return withVaultLock(root, async () => {
      const snap = await readSnapshot(snapshotId, ctx);
      const rel = normalizeRel(snap.noteId);
      try {
        const current = await import_fs.promises.readFile(absOf(root, rel), "utf8");
        await maybeSnapshot(root, rel, current, 0);
      } catch {
      }
      await writeCachedNote(root, absOf(root, rel), rel, snap.content);
      return { ok: true, noteId: rel };
    });
  }
  async function createCanvas(vaultId, name, folderId) {
    const content = JSON.stringify({ nodes: [], edges: [] }, null, 2);
    return createEntryFile(vaultId, name, folderId, ".canvas", content);
  }
  async function saveAttachment(vaultId, folderId, name, base64, ctx) {
    const root = await assertVault(vaultId);
    return withVaultLock(root, async () => {
      const dirRel = folderId ? normalizeRel(folderId) : "";
      const walk = await walkVault(root);
      if (dirRel && !walk.dirs.some((d) => sameRel(d.rel, dirRel))) {
        throw new DesktopApiError("Folder not found");
      }
      const safe = sanitizeName(name, "Pasted file", false);
      const dot = safe.lastIndexOf(".");
      const ext = dot > 0 ? safe.slice(dot) : "";
      const taken = /* @__PURE__ */ new Set([
        ...walk.files.filter((f) => (f.folderId ?? "").toLowerCase() === dirRel.toLowerCase()).map((f) => `${f.name}.${f.ext}`.toLowerCase()),
        ...walk.notes.filter((n2) => sameRel(n2.dirRel, dirRel)).map((n2) => n2.name.toLowerCase())
      ]);
      let finalName = safe;
      let n = 0;
      while (taken.has(finalName.toLowerCase())) {
        const base = dot > 0 ? safe.slice(0, dot) : safe;
        finalName = `${base} ${++n}${ext}`;
      }
      const rel = joinRel(dirRel, finalName);
      const buf = Buffer.from(base64, "base64");
      await writeFileAtomicBinary(absOf(root, rel), buf);
      const st = await statSafe(absOf(root, rel));
      const lastDot = finalName.lastIndexOf(".");
      return {
        id: rel,
        vaultId: root,
        folderId: dirRel || null,
        name: lastDot > 0 ? finalName.slice(0, lastDot) : finalName,
        ext: lastDot > 0 ? finalName.slice(lastDot + 1).toLowerCase() : "",
        size: st?.size ?? buf.length,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    });
  }
  async function writeFileAtomicBinary(abs, buf) {
    await import_fs.promises.mkdir(import_path.default.dirname(abs), { recursive: true });
    const tmp = `${abs}.${(0, import_crypto.randomUUID)()}.obsidian-tmp`;
    await import_fs.promises.writeFile(tmp, buf);
    await import_fs.promises.rename(tmp, abs);
  }
  async function readVaultBinary(vaultId, rel) {
    const root = await assertVault(vaultId);
    const abs = absOf(root, rel);
    const buf = await import_fs.promises.readFile(abs);
    return { base64: buf.toString("base64") };
  }
  async function getSettings() {
    const stored = await readJson(settingsPath());
    return mergeSettings(DEFAULT_SETTINGS, stored);
  }
  async function putSettings(patch) {
    const current = await getSettings();
    const merged = mergeSettings(current, patch);
    await writeJson(settingsPath(), merged);
    return merged;
  }
  const ops = {
    listVaults: () => listVaults(),
    createVault: ([name]) => createVault(name),
    deleteVault: ([id]) => deleteVault(id),
    tree: ([vaultId]) => tree(vaultId),
    index: ([vaultId]) => index(vaultId),
    graph: ([vaultId]) => graph(vaultId),
    tags: ([vaultId]) => tags(vaultId),
    search: ([vaultId, q, cs]) => search(vaultId, q, cs),
    note: ([id], ctx) => note(id, ctx),
    createNote: ([vaultId, name, folderId, content]) => createNote(vaultId, name, folderId, content),
    patchNote: ([id, data], ctx) => patchNote(id, data, ctx),
    deleteNote: ([id], ctx) => deleteNote(id, ctx),
    backlinks: ([noteId], ctx) => backlinks(noteId, ctx),
    createFolder: ([vaultId, name, parentId]) => createFolder(vaultId, name, parentId),
    patchFolder: ([id, data], ctx) => patchFolder(id, data, ctx),
    deleteFolder: ([id], ctx) => deleteFolder(id, ctx),
    bookmarks: ([vaultId]) => bookmarks(vaultId),
    addBookmark: ([data]) => addBookmark(data),
    removeBookmark: ([id], ctx) => removeBookmark(id, ctx),
    getSettings: () => getSettings(),
    putSettings: ([patch]) => putSettings(patch),
    createCanvas: ([vaultId, name, folderId]) => createCanvas(vaultId, name, folderId),
    saveAttachment: ([vaultId, folderId, name, base64], ctx) => saveAttachment(vaultId, folderId, name, base64, ctx),
    readVaultBinary: ([vaultId, rel]) => readVaultBinary(vaultId, rel),
    listSnapshots: ([vaultId]) => listSnapshots(vaultId),
    readSnapshot: ([id], ctx) => readSnapshot(id, ctx),
    restoreSnapshot: ([id], ctx) => restoreSnapshot(id, ctx)
  };
  return {
    /** Run one API operation. Throws DesktopApiError on failure. */
    async dispatch(op, args = [], ctx = {}) {
      const fn = ops[op];
      if (!fn) throw new DesktopApiError(`Unknown operation: ${op}`);
      return fn(args, ctx);
    },
    /** Drop cached contents for a vault (called when the watcher sees changes). */
    invalidate(root) {
      contentCache.delete(import_path.default.resolve(root));
    },
    /** Registered vault roots (used by the host to start watchers). */
    async vaultRoots() {
      const reg = await readRegistry();
      return reg.vaults.map((v) => import_path.default.resolve(v.id));
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DesktopApiError,
  createServerApi
});
