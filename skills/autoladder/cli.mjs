import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import zlib from "zlib";
import { Duplex, PassThrough, Transform, pipeline } from "stream";
import fs from "node:fs";
import { Blob } from "node:buffer";
import { types } from "node:util";
import Stream, { Readable, Transform as Transform$1 } from "node:stream";
import { createRequire as createRequire$1 } from "module";
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod, mod.exports), cb = null), mod.exports);
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
// src/core/diagram.ts
/** Mermaid 라벨 안에서 문법으로 읽히는 글자를 바꾼다 */
var label = (lines) => `"${lines.map((l) => l.replaceAll("\"", "#quot;").replaceAll("<", "#lt;").replaceAll(">", "#gt;")).join("<br/>")}"`;
var html = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** 단계 표 → Mermaid 흐름도 글 */
function flowChart(table, op, tags) {
	const tagName = new Map(tags.map((t) => [t.address, t.name]));
	const named = (address) => tagName.has(address) ? `${address} ${tagName.get(address)}` : address;
	const tagMeaning = new Map(tags.map((t) => [t.address, t.meaning]));
	const sensed = (address) => [named(address), tagMeaning.get(address)].filter((p) => p).join(" ");
	const step = new Map(table.steps.map((s, i) => [s.id, {
		node: `s${i}`,
		name: s.name,
		timer: s.timer
	}]));
	const counters = table.counters ?? [];
	const counter = new Map(counters.map((c) => [c.id, c]));
	const text = (cond, nested = false) => {
		switch (cond.kind) {
			case "input": return sensed(cond.address);
			case "timer": return `${step.get(cond.step)?.name ?? cond.step} ${step.get(cond.step)?.timer ?? "?"}초 지남`;
			case "counter": return `${counter.get(cond.id)?.name ?? cond.id} ${counter.get(cond.id)?.target ?? "?"}번 채움`;
			case "compare": return `${cond.left} ${cond.op} ${cond.right}`;
			case "not": return cond.cond.kind === "input" ? `${sensed(cond.cond.address)} 아님` : `아님(${text(cond.cond)})`;
			default: {
				const joined = cond.conds.map((c) => text(c, true)).join(cond.kind === "and" ? " 그리고 " : " 또는 ");
				return nested ? `(${joined})` : joined;
			}
		}
	};
	const condLines = (cond, prefix = "") => {
		if (cond.kind !== "and" && cond.kind !== "or") return [prefix + text(cond)];
		const word = cond.kind === "and" ? "그리고 " : "또는 ";
		return cond.conds.map((c, i) => (i === 0 ? prefix : word) + text(c, true));
	};
	const pairs = (items, prefix) => items.flatMap((_, i) => i % 2 === 0 ? [(i === 0 ? prefix : "") + items.slice(i, i + 2).join(", ")] : []);
	const lines = ["flowchart TD"];
	const start = [`시작: ${named(op.start)}`, ...op.homeCondition ? condLines(op.homeCondition, "원위치: ") : []];
	lines.push(`  idle(["대기"])`, `  idle -->|${label(start)}| ${step.get(table.initial)?.node ?? "idle"}`);
	table.steps.forEach((s, i) => {
		const body = [
			`${i + 1}. ${s.name}`,
			...pairs(s.outputs.map(named), "켜짐: "),
			...s.timer !== null ? [`타이머 ${s.timer}초`] : [],
			...s.timeLimit !== void 0 ? [`제한 시간 ${s.timeLimit}초`] : [],
			...(s.writes ?? []).map((w) => `값: ${named(w.address)} = ${w.value}`),
			...(s.calcs ?? []).map((c) => `계산: ${c.target} = ${c.left}${c.op ? ` ${c.op} ${c.right}` : ""}`)
		];
		lines.push(`  s${i}[${label(body)}]`);
	});
	let ends = 0;
	table.transitions.forEach((tr, i) => {
		const rivals = table.transitions.filter((other) => other.from.some((f) => tr.from.includes(f)));
		const rank = rivals.length > 1 ? `${rivals.indexOf(tr) + 1}순위: ` : "";
		const notes = [
			...counters.filter((c) => c.countOn === i).map((c) => `${c.name} 1번 셈`),
			...counters.filter((c) => c.resetOn === i).map((c) => `${c.name} 0으로`),
			...tr.isCycleEnd ? ["사이클 끝"] : []
		];
		const condition = [...condLines(tr.cond, rank), ...notes.map((n) => `[${n}]`)];
		const caption = label(condition);
		const from = tr.from.map((id) => step.get(id)?.node ?? id);
		const to = tr.to.length > 0 ? tr.to.map((id) => step.get(id)?.node ?? id) : [`end${ends++}`];
		if (tr.to.length === 0) lines.push(`  ${to[0]}(["끝: 대기로"])`);
		if (from.length === 1 && to.length === 1) lines.push(`  ${from[0]} -->|${caption}| ${to[0]}`);
		else {
			const what = to.length > 1 ? "동시에 시작" : "모두 끝나면";
			lines.push(`  t${i}{{${label([what, ...condition])}}}`);
			from.forEach((f) => lines.push(`  ${f} --> t${i}`));
			to.forEach((t) => lines.push(`  t${i} --> ${t}`));
		}
	});
	return lines.join("\n");
}
/** 운전 설정을 사람이 읽는 줄로 */
function opLines(op, tags) {
	const tagName = new Map(tags.map((t) => [t.address, t.name]));
	const named = (address) => tagName.has(address) ? `${address} ${tagName.get(address)}` : address;
	const pairs = (list) => list.map(([a, b]) => `${named(a)} ↔ ${named(b)}`).join(", ");
	return [
		`시작 버튼: ${named(op.start)}`,
		op.stop ? `정지 버튼(사이클 끝에서 멈춤): ${named(op.stop)}` : "",
		op.estop ? `비상정지: ${named(op.estop)}` : "",
		op.reset ? `이상 해제 버튼: ${named(op.reset)}` : "",
		op.autoManual ? `자동·수동 스위치(ON = 자동): ${named(op.autoManual)}` : "",
		op.homeButton ? `원점복귀 버튼: ${named(op.homeButton)}` : "",
		op.homeOutputs?.length ? `원점복귀 중 켜는 출력: ${op.homeOutputs.map(named).join(", ")}` : "",
		op.manual?.length ? `수동 버튼: ${op.manual.map((b) => `${named(b.button)} → ${named(b.output)}`).join(", ")}` : "",
		op.interlocks?.length ? `동시에 켜지면 안 되는 출력: ${pairs(op.interlocks)}` : "",
		op.sensorPairs?.length ? `동시에 감지되면 이상인 센서: ${pairs(op.sensorPairs)}` : "",
		op.faultLamp ? `이상 램프: ${named(op.faultLamp)}` : "",
		op.alwaysOn?.length ? `항상 켜 두는 출력: ${op.alwaysOn.map(named).join(", ")}` : "",
		op.alwaysWrites?.length ? `항상 써 두는 값: ${op.alwaysWrites.map((w) => `${named(w.address)} = ${w.value}`).join(", ")}` : ""
	].filter((l) => l);
}
/** 흐름도 + 운전 설정 + 검사 결과를 담은 HTML 한 장 */
function diagramPage(name, table, op, tags, issues) {
	const list = (items) => items.map((i) => `<li>${html(i)}</li>`).join("\n");
	const errors = issues.filter((n) => n.level === "error").map((n) => n.message);
	const warnings = issues.filter((n) => n.level === "warning").map((n) => n.message);
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${html(name)} 공정 흐름도</title>
<style>
body { margin: 0; padding: 24px; background: #F4F6F9; color: #1B2430; font: 14px/1.6 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
h2 { margin: 0 0 8px; font-size: 16px; }
p { margin: 0 0 16px; color: #4A5565; }
section { margin: 0 0 16px; padding: 16px; background: #FFFFFF; border: 1px solid #D9DEE6; border-radius: 8px; overflow-x: auto; }
ul { margin: 0; padding-left: 20px; }
.error { border-color: #C2410C; } .error h2 { color: #9A3412; }
.warning { border-color: #E0B565; } .warning h2 { color: #5C3A00; }
</style>
</head>
<body>
<h1>${html(name)}</h1>
<p>공정 흐름도입니다. 네모 = 단계(그동안 켜지는 출력), 화살표 = 단계 이동(넘어가는 조건). 맞는지 확인한 뒤 래더를 만드세요.</p>
${errors.length ? `<section class="error"><h2>오류 ${errors.length}건 (고쳐야 래더를 만들 수 있습니다)</h2><ul>\n${list(errors)}\n</ul></section>` : ""}
${warnings.length ? `<section class="warning"><h2>경고 ${warnings.length}건</h2><ul>\n${list(warnings)}\n</ul></section>` : ""}
<section>
<pre class="mermaid">
${html(flowChart(table, op, tags))}
</pre>
</section>
<section>
<h2>운전 설정</h2>
<ul>
${list(opLines(op, tags))}
</ul>
</section>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs'
mermaid.initialize({ startOnLoad: true, theme: 'neutral', flowchart: { htmlLabels: true, curve: 'linear', wrappingWidth: 2000 } })
<\/script>
</body>
</html>
`;
}
// node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function joinValues(array, separator = "|") {
	return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
var Cached = class {
	constructor(getter) {
		this._getter = getter;
		this._value = void 0;
	}
	get value() {
		const getter = this._getter;
		if (getter !== void 0) {
			this._value = getter();
			this._getter = void 0;
		}
		return this._value;
	}
};
function cached(getter) {
	return new Cached(getter);
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
/**
* Whichever object a def's `shape` currently answers from: the one the caller passed until the first read, the frozen copy after it.
*
* Its keys and descriptors read without invoking anything, which is what lets a discriminated union check its discriminator, and the cycle walk read a shape, without resolving a getter that references the schema being constructed. A def that answers `shape` from an accessor of its own has none.
*/
function rawShape(def) {
	const desc = Object.getOwnPropertyDescriptor(def, "shape");
	return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
	return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
	Object.defineProperty(target, key, {
		get() {
			const value = getter();
			assignProp(this, key, value);
			return value;
		},
		enumerable: true,
		configurable: true
	});
}
function putProp(target, key, value) {
	if (key in target) assignProp(target, key, value);
	else target[key] = value;
}
/**
* Copies `keys` of `source`'s shape onto `target`, each value passed through `wrap`.
*
* A key the source has resolved is copied through now, so the derived shape states it outright and nothing has to resolve it to learn what it holds. A key the source still defers stays deferred, and reads back through the source's own `shape`, so it resolves once and both shapes get that one schema.
*/
function mirrorShape(target, source, keys, wrap) {
	const raw = sourceShape(source);
	for (const key of keys) {
		const desc = Object.getOwnPropertyDescriptor(raw, key);
		if (!desc.enumerable) continue;
		if (desc.get) deferProp(target, key, () => {
			const value = source._zod.def.shape[key];
			return wrap ? wrap(value, key) : value;
		});
		else putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
	}
}
function mirrorProps(target, source) {
	for (const key of Reflect.ownKeys(source)) {
		const desc = Object.getOwnPropertyDescriptor(source, key);
		if (!desc.enumerable) continue;
		if (desc.get) deferProp(target, key, () => source[key]);
		else putProp(target, key, desc.value);
	}
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc$1(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject$1(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject$1(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject$1(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
var propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function stringifyPrimitive(value) {
	if (typeof value === "bigint") return value.toString() + "n";
	if (typeof value === "string") return `"${value}"`;
	return `${value}`;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
	});
}
var NUMBER_FORMAT_RANGES = /*@__PURE__*/ (() => ({
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
	int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
	uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	const newShape = {};
	mirrorShape(newShape, schema, maskedKeys(schema, mask));
	return clone(schema, mergeDefs(currDef, {
		shape: newShape,
		checks: []
	}));
}
function maskedKeys(schema, mask) {
	const raw = sourceShape(schema);
	const keys = [];
	for (const key of Reflect.ownKeys(mask)) {
		if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) throw new Error(`Unrecognized key: "${String(key)}"`);
		if (mask[key]) keys.push(key);
	}
	return keys;
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	const omitted = new Set(maskedKeys(schema, mask));
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
	return clone(schema, mergeDefs(currDef, {
		shape: newShape,
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = sourceShape(schema);
		for (const key of Reflect.ownKeys(shape)) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
	mirrorProps(newShape, shape);
	return newShape;
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
	if (!b?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	const newShape = {};
	mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
	mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
	return clone(a, mergeDefs(a._zod.def, {
		shape: newShape,
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask, name = "partial") {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
	const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({
		type: "optional",
		innerType: value
	})));
	return clone(schema, mergeDefs(schema._zod.def, {
		shape: newShape,
		checks: []
	}));
}
function required(Class, schema, mask) {
	const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
	const newShape = {};
	mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({
		type: "nonoptional",
		innerType: value
	}));
	return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
/** The leading size checks of `defChecks` that set an upper bound, each paired with it. */
function sizeCaps(defChecks) {
	const caps = [];
	for (const ch of defChecks ?? []) {
		const d = ch._zod.def;
		if (!/_(length|size)$|_equals$/.test(d.check)) break;
		const max = d.maximum ?? d.length ?? d.size;
		if (max >= 0) caps.push([max, ch]);
	}
	return caps;
}
function attachSchema(issues, start, inst) {
	var _a;
	for (let i = start; i < issues.length; i++) (_a = issues[i]).schema ?? (_a.schema = inst);
}
function finalizeIssue(iss, ctx, config) {
	var _a;
	const traits = iss.inst?._zod?.traits;
	if (traits?.has("$ZodType")) {
		if (traits.has("$ZodCheck")) (_a = iss).schema ?? (_a.schema = iss.inst);
		else iss.schema = iss.inst;
	}
	const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const full = {};
	for (const k of Object.keys(iss)) {
		if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__") continue;
		full[k] = iss[k];
	}
	full.path ?? (full.path = []);
	full.message = message;
	if (ctx?.reportInput) full.input = iss.input;
	return full;
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
	const units = str.length;
	if (!highSurrogate.test(str)) return units;
	let count = units;
	for (let i = 0; i < units - 1; i++) if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
		count--;
		i++;
	}
	return count;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function parsedType(data) {
	const t = typeof data;
	switch (t) {
		case "number": return Number.isNaN(data) ? "nan" : "number";
		case "object": {
			if (data === null) return "null";
			if (Array.isArray(data)) return "array";
			const obj = data;
			if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) return obj.constructor.name;
		}
	}
	return t;
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
/**
* Installs a trait's members on its prototype. Each value builds that member for the instance on first read; the built value shadows the accessor as an own property, so a detached `const { parse } = schema` keeps working.
*
* Call this from a `proto` initializer, which runs once per prototype — never per instance.
*/
function members(proto, table) {
	for (const key in table) {
		const desc = Object.getOwnPropertyDescriptor(table, key);
		if (desc.get) Object.defineProperty(proto, key, {
			...desc,
			enumerable: false
		});
		else defineBound(proto, key, desc.value);
	}
}
/** Shadows a prototype member with an own value, so a getter that builds from the instance runs once. */
function own(inst, key, value, enumerable = true) {
	Object.defineProperty(inst, key, {
		configurable: true,
		writable: true,
		enumerable,
		value
	});
	return value;
}
/** Like {@link own}, for a member that was never an own data property and has to stay out of `Object.keys`. */
function hide(inst, key, value) {
	return own(inst, key, value, false);
}
/** Adds members a table derives from the instance: each builds on first read and shadows as own data, and assignment shadows the same way, as when these were own properties. */
/* @__NO_SIDE_EFFECTS__ */
function derived(computes, table) {
	for (const key in computes) {
		const compute = computes[key];
		Object.defineProperty(table, key, {
			configurable: true,
			enumerable: true,
			get() {
				return own(this, key, compute(this));
			},
			set(value) {
				own(this, key, value);
			}
		});
	}
	return table;
}
function defineBound(proto, key, fn) {
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			return this == null ? fn : own(this, key, fn.bind(this));
		},
		set(value) {
			own(this, key, value);
		}
	});
}
/** Returns the prototype to install on, or `undefined` if this group is already installed on it. */
function claim(inst, sentinel) {
	const proto = Object.getPrototypeOf(inst);
	return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
	configurable: true,
	get() {
		broke = true;
	}
};
/**
* Installs a lazily-derived internal on the `_zod` prototype of `inst`'s
* constructor, computed from the internals object itself and cached there on
* first read. One accessor per constructor rather than one per instance.
*/
function defineLazyInternal(inst, key, compute) {
	const proto = Object.getPrototypeOf(inst._zod);
	if (key in proto && installing !== inst._zod) {
		installing = void 0;
		return;
	}
	installing = inst._zod;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			Object.defineProperty(this, key, breaker);
			const outer = broke;
			broke = false;
			try {
				const value = compute(this);
				if (broke) delete this[key];
				else Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					value
				});
				broke = broke || outer;
				return value;
			} catch (err) {
				delete this[key];
				broke = broke || outer;
				throw err;
			}
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				value
			});
		}
	});
}
/**
* Installs `key` on `inst`'s prototype, computed by `make` on first read and cached there as an own
* data property. One accessor per constructor rather than one per instance, because an own accessor
* puts every instance after the first into v8 dictionary mode. The key doubles as the sentinel.
*/
function installLazyProp(inst, key, make, enumerable) {
	const proto = claim(inst, key);
	if (!proto) return;
	Object.defineProperty(proto, key, {
		configurable: true,
		get() {
			const desc = {
				configurable: true,
				writable: true,
				enumerable,
				value: void 0
			};
			Object.defineProperty(this, key, desc);
			desc.value = make(this);
			Object.defineProperty(this, key, desc);
			return desc.value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				configurable: true,
				writable: true,
				enumerable,
				value
			});
		}
	});
}
/** Marks the thunk `_catch` synthesises for a constant catch value. `Function.length` cannot tell that thunk from a user callback — rest and defaulted parameters both report arity 0 — and a user callback reads `ctx.error`, whose issues only finalize correctly against the caller's per-parse error map. Provenance can say what arity cannot. A plain string key rather than `Symbol.for`, whose call at module scope no bundler can prove pure — the same shape that anchored `urlCanParse` into every build. */
var CONSTANT_CATCH = "~constantCatch";
/** Wraps a constant catch value in a thunk tagged with {@link CONSTANT_CATCH}. */
function constantCatch(value) {
	const fn = () => value;
	fn[CONSTANT_CATCH] = true;
	return fn;
}
// node_modules/zod/v4/core/core.js
var _a$2;
var _zodDesc = {
	value: void 0,
	enumerable: false
};
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
	const E = _E;
	if (E) {
		const saved = E.stackTraceLimit;
		if (typeof saved === "number") {
			try {
				E.stackTraceLimit = 0;
			} catch {
				_E = null;
				return new Definition();
			}
			try {
				return new Definition();
			} finally {
				E.stackTraceLimit = saved;
			}
		}
	}
	return new Definition();
}
/* @__NO_SIDE_EFFECTS__ */
function $constructor(name, initializer, proto, params) {
	const zodProto = {};
	function Internals(def) {
		this.def = def;
		this.constr = _;
		this.traits = /* @__PURE__ */ new Set();
	}
	Internals.prototype = zodProto;
	const protoMembers = proto;
	const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
	function init(inst, def) {
		if (!inst._zod) {
			_zodDesc.value = new Internals(def);
			try {
				Object.defineProperty(inst, "_zod", _zodDesc);
			} finally {
				_zodDesc.value = void 0;
			}
		} else if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		if (initialized) {
			const own = Object.getPrototypeOf(inst);
			const ctorProto = inst._zod.constr.prototype;
			let up = own;
			while (up && up !== ctorProto) up = Object.getPrototypeOf(up);
			const target = up ?? own;
			if (!initialized.has(target)) {
				initialized.add(target);
				members(target, protoMembers);
			}
		}
		const proto = _.prototype;
		for (const k in proto) {
			if (!Object.prototype.hasOwnProperty.call(proto, k)) continue;
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		const inst = params?.Parent ? newError(Definition) : this;
		init(inst, def);
		const deferred = inst._zod.deferred;
		if (deferred) {
			for (const fn of deferred) fn();
			inst._zod.deferred = void 0;
		}
		const pp = globalThis.__zod_globalConfig?.postProcessor;
		if (pp) pp(inst);
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$2 = globalThis).__zod_globalConfig ?? (_a$2.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
// node_modules/zod/v4/core/errors.js
function _getMessage() {
	const internals = this._zod;
	internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
	return internals.message;
}
function _setMessage(value) {
	this._zod.message = value;
}
var _messageDesc = {
	get: _getMessage,
	set: _setMessage,
	enumerable: true,
	configurable: true
};
var _issuesDesc = {
	value: void 0,
	enumerable: false
};
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	_issuesDesc.value = def;
	Object.defineProperty(inst, "issues", _issuesDesc);
	_issuesDesc.value = void 0;
	Object.defineProperty(inst, "message", _messageDesc);
	const proto = Object.getPrototypeOf(inst);
	if (!_installedToString.has(proto)) {
		_installedToString.add(proto);
		Object.defineProperty(proto, "toString", {
			configurable: true,
			enumerable: false,
			get() {
				const value = () => this.message;
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
				return value;
			},
			set(value) {
				Object.defineProperty(this, "toString", {
					value,
					configurable: true,
					writable: true
				});
			}
		});
	}
};
var $ZodError = /* @__PURE__ */ $constructor("$ZodError", initializer$1);
/** Get-or-create `obj[key]` as an own data property. A path segment naming an inherited member
* ("toString", "constructor") would otherwise read through to the prototype, and assigning
* "__proto__" would hit the setter instead of creating a key. */
function node(obj, key, make) {
	if (!Object.prototype.hasOwnProperty.call(obj, key)) {
		if (key === "__proto__") Object.defineProperty(obj, key, {
			value: make(),
			writable: true,
			enumerable: true,
			configurable: true
		});
		else obj[key] = make();
	}
	return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
	else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					const terminal = i === fullpath.length - 1;
					if (el === "_errors") {
						if (terminal) curr._errors.push(mapper(issue));
						i++;
						continue;
					}
					if (!Object.prototype.hasOwnProperty.call(curr, el)) Object.defineProperty(curr, el, {
						value: { _errors: [] },
						enumerable: true,
						writable: true,
						configurable: true
					});
					const node = curr[el];
					if (terminal) node._errors.push(mapper(issue));
					curr = node;
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
// node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
	return {
		callee: params?.callee ?? callee,
		Err: params?.Err
	};
}
var _parse = (_Err) => {
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: false
		} : { async: false };
		const result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) throw new $ZodAsyncError();
		if (result.issues.length) {
			const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, _params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
var _parseAsync = (_Err) => {
	const fn = async (schema, value, _ctx, params) => {
		const ctx = _ctx ? {
			..._ctx,
			async: true
		} : { async: true };
		let result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) result = await result;
		if (result.issues.length) {
			const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, params?.callee ?? fn);
			throw e;
		}
		return result.value;
	};
	return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? failure(_Err, result.issues, ctx) : {
		success: true,
		data: result.value
	};
};
function failure(Err, issues, ctx) {
	let error;
	return {
		success: false,
		get error() {
			if (!error) {
				error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
				issues = void 0;
				ctx = void 0;
			}
			return error;
		},
		set error(e) {
			error = e;
			issues = void 0;
			ctx = void 0;
		}
	};
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? failure(_Err, result.issues, ctx) : {
		success: true,
		data: result.value
	};
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = ((schema, value, _ctx) => {
	const validator = schema._zod.bag.validator;
	if (validator !== void 0) {
		if (validator(value) !== COMPILE_INVALID) return true;
		if (validator.definite === true && _ctx === void 0) return false;
	}
	return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
	const ctx = _ctx ? {
		..._ctx,
		async: false,
		abortEarly: true
	} : {
		async: false,
		abortEarly: true
	};
	const fallbackRun = schema._zod.bag.fallbackRun;
	let result;
	if (fallbackRun) {
		ctx[COMPILE_FALLBACK] = true;
		result = fallbackRun({
			value,
			issues: []
		}, ctx);
	} else result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length === 0;
}
var validateAsync$1 = async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true,
		abortEarly: true
	} : {
		async: true,
		abortEarly: true
	};
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length === 0;
};
var _encode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return parse(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
var _decode = (_Err) => {
	const parse = _parse(_Err);
	const fn = (schema, value, _ctx, _params) => {
		return parse(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
var _encodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		const ctx = _ctx ? {
			..._ctx,
			direction: "backward"
		} : { direction: "backward" };
		return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
	};
	return fn;
};
var _decodeAsync = (_Err) => {
	const parseAsync = _parseAsync(_Err);
	const fn = async (schema, value, _ctx, _params) => {
		return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
	};
	return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
// node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
	return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
var uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
/** Anchors a pattern source. The interpolation lives here rather than at the call site because
* esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
* will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */
function anchor(source) {
	return new RegExp(`^${source}$`);
}
var date = /*@__PURE__*/ anchor(dateSource);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
	const opts = ["Z"];
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const qualified = `${timeSource({
		precision: args.precision,
		seconds: true
	})}(?:${opts.join("|")})`;
	const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var number$1 = /^-?\d+(?:\.\d+)?$/;
var boolean$1 = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
// node_modules/zod/v4/core/checks.js
var $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
/** Default `when` for length-based checks: run only on non-nullish values with a `length`. */
var _whenHasLength = (payload) => {
	const val = payload.value;
	return !nullish(val) && val.length !== void 0;
};
var numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
var $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin: numericOriginMap[typeof payload.value] ?? origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
	inst._zod.check = (payload) => {
		const input = payload.value;
		const units = input.length;
		const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	def.pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
// node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = [], closed = {}) {
		this.content = [];
		this.indent = 0;
		this.args = args;
		this.closed = closed;
	}
	indented(fn) {
		this.indent += 1;
		try {
			fn(this);
		} finally {
			this.indent -= 1;
		}
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const content = this?.content ?? [``];
		return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${content.join("\n")}\n};`)(...Object.values(this.closed));
	}
};
// node_modules/zod/v4/core/versions.js
var version = {
	major: 4,
	minor: 6,
	patch: 7
};
// node_modules/zod/v4/core/schemas.js
var $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const defChecks = inst._zod.def.checks;
	const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			if (payload.memo) return payload;
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					attachSchema(payload.issues, currLen, inst);
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
}, {
	get "~standard"() {
		return hide(this, "~standard", standardProps(this));
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	}
});
/** The Standard Schema surface for `inst`. Shared so wrappers can extend it without forcing it. */
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
	const ctx = { async: true };
	return toStandardResult(await inst._zod.run({
		value,
		issues: []
	}, ctx), ctx);
}
function standardProps(inst) {
	return {
		validate: (value) => {
			const ctx = { async: false };
			try {
				const r = inst._zod.run({
					value,
					issues: []
				}, ctx);
				if (!(r instanceof Promise)) return toStandardResult(r, ctx);
			} catch (_) {}
			return validateAsync(inst, value);
		},
		vendor: "zod",
		version: 1
	};
}
var $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = def.pattern ?? anyString;
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
var $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
var $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
var $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
var $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
function canParseURL(input) {
	try {
		if (typeof URL !== "undefined" && typeof URL.canParse === "function") return URL.canParse(input);
		new URL(input);
		return true;
	} catch {
		return false;
	}
}
function validateURL(trimmed, def) {
	if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) return canParseURL(trimmed) || 2;
	return parseURLObject(trimmed, def);
}
/** Parses a URL while preserving the non-normalizing HTTP guard. */
function parseURLObject(trimmed, def) {
	if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) return 1;
	try {
		if (typeof URL !== "undefined") {
			const URLStatic = URL;
			if (typeof URLStatic.parse === "function") return URLStatic.parse(trimmed) ?? 2;
		}
		return new URL(trimmed);
	} catch {
		return 2;
	}
}
var asciiTabOrNewline = /[\t\n\r]/g;
/** The URL parser deletes every ASCII tab, LF and CR from its input before it parses, so `new URL("https://exa\nmple.com")` reports on `example.com`. Applying the same deletion to the returned value closes the half of that divergence which can move the host; the parser's other rewrite, stripping C0 controls at the edges, cannot. */
function stripTabAndNewline(value) {
	return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
	hostname.lastIndex = 0;
	return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
	protocol.lastIndex = 0;
	return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			const url = validateURL(trimmed, def);
			if (url === 1) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (url === 2) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
				return;
			}
			if (url === true) {
				payload.value = stripTabAndNewline(trimmed);
				return;
			}
			if (def.hostname && !urlHostnameOk(url, def.hostname)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: def.hostname.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			if (def.protocol && !urlProtocolOk(url, def.protocol)) payload.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: def.protocol.source,
				input: payload.value,
				inst,
				continue: !def.abort
			});
			payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
var $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1)) throw new Error(`Invalid nanoid length: ${def.length}`);
	def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
var $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
var $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date);
	$ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration);
	$ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
});
/** An IPv6 address is written with hex digits, colons and dots, and nothing else. The guard is what makes the check below an IPv6 check: `new URL("http://[...]")` parses an authority, not an address, so `@` and `\` re-delimit it and `"::@1\\"` validates against the host `0.0.0.1`. The URL parser also deletes ASCII tab, LF and CR rather than failing, which is how `"::1\n"` validated as `::1`. */
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
	if (!ipv6Alphabet.test(value)) return false;
	return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (!isValidIPv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
	const parts = value.split("/");
	if (parts.length !== 2) return false;
	const [address, prefix] = parts;
	if (!prefix) return false;
	const prefixNum = Number(prefix);
	if (`${prefixNum}` !== prefix) return false;
	if (prefixNum < 0 || prefixNum > 128) return false;
	return isValidIPv6(address);
}
var $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (!isValidCIDRv6(payload.value)) payload.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64Charset);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
	if (!base64urlCharset.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
var $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64urlCharset);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
var $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
var $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
var $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
var $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
var $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function capSize(inst, size) {
	const caps = sizeCaps(inst._zod.def.checks);
	if (!caps.length) return;
	const cap = Math.min(...caps.map((c) => c[0]));
	const parse = inst._zod.parse;
	inst._zod.parse = (payload, ctx) => {
		const n = size(payload.value);
		if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
			for (const [max, ch] of sizeCaps(inst._zod.def.checks)) if (n > max && ch._zod.def.when(payload)) {
				const start = payload.issues.length;
				ch._zod.check(payload);
				payload.issues[start].continue = false;
				attachSchema(payload.issues, start, inst);
				return payload;
			}
		}
		return parse(payload, ctx);
	};
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
var $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
		const proms = [];
		const abortEarly = ctx?.abortEarly;
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else {
				handleArrayResult(result, payload, i);
				if (abortEarly && result.issues.length !== 0 && aborted(result)) break;
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
	capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
	const isPresent = key in input;
	const isOptionalOut = optout === "optional";
	if (!isPresent && isOptionalOut && optin === "optional") return;
	if (result.issues.length) {
		if (optin !== void 0 && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && optin === void 0) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent || optin === "defaulted" && !isOptionalOut) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	const ownSymbols = Object.getOwnPropertySymbols(def.shape);
	const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
	const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
	for (const k of allKeys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		allKeys,
		symbolKeys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const optin = _catchall.optin;
	const optout = _catchall.optout;
	let seen = 0;
	for (const key in input) {
		if (abortEarly && payload.issues.length !== seen) {
			if (aborted(payload, seen)) break;
			seen = payload.issues.length;
		}
		if (keySet.has(key)) continue;
		if (key === "__proto__") {
			if (t === "never") unrecognized.push(key);
			continue;
		}
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
		else handlePropertyResult(r, payload, key, input, optin, optout);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst,
		continue: true
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
var $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	const desc = Object.getOwnPropertyDescriptor(def, "shape");
	const sh = desc?.get ? desc.get.raw : def.shape ?? {};
	if (sh) {
		const get = () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			get.raw = newSh;
			return newSh;
		};
		get.raw = sh;
		Object.defineProperty(def, "shape", { get });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazyInternal(inst, "propValues", (zod) => {
		const shape = zod.def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				if (!Object.prototype.hasOwnProperty.call(propValues, key)) assignProp(propValues, key, /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
				if (field.optin !== void 0) propValues[key].add(void 0);
			}
		}
		return propValues;
	});
	const isObject = isObject$1;
	const catchall = def.catchall;
	let value;
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
		const proms = [];
		const shape = value.shape;
		const abortEarly = ctx?.abortEarly;
		let seen = payload.issues.length;
		for (const key of value.allKeys) {
			if (abortEarly && payload.issues.length !== seen) {
				if (aborted(payload, seen)) break;
				seen = payload.issues.length;
			}
			if (key === "__proto__") continue;
			const el = shape[key];
			const optin = el._zod.optin;
			const optout = el._zod.optout;
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
			else handlePropertyResult(r, payload, key, input, optin, optout);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
	};
});
var $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const memo = globalConfig.memoizer;
	const generateFastpass = (shape) => {
		const normalized = _normalized.value;
		const syms = normalized.symbolKeys;
		const doc = new Doc(["payload", "ctx"], {
			shape,
			inst,
			memo,
			syms
		});
		const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.allKeys) ids[key] = `key_${counter++}`;
		doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
		for (const key of normalized.allKeys) {
			if (key === "__proto__") continue;
			const id = ids[key];
			const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc$1(key);
			const isPresent = `${k} in input`;
			const schema = shape[key];
			const optin = schema?._zod?.optin;
			const isOptionalIn = optin !== void 0;
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(k)};`);
			if (isOptionalIn && isOptionalOut) {
				const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
				doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			} else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
			else {
				doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
				if (optin === "defaulted") doc.write(`newResult[${k}] = ${id}.value;`);
				else doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
			}
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		return doc.compile();
	};
	let fastpass;
	const isObject = isObject$1;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
var $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
	defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazyInternal(inst, "values", (zod) => {
		if (zod.def.options.every((o) => o._zod.values)) return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		if (zod.def.options.every((o) => o._zod.pattern)) {
			const patterns = zod.def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
var $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		if (Object.prototype.hasOwnProperty.call(newObj, "__proto__")) delete newObj.__proto__;
		for (const key of sharedKeys) {
			if (key === "__proto__") continue;
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	const keyIssues = /* @__PURE__ */ new Map();
	const collect = (iss, side) => {
		let keys;
		if (iss.code === "unrecognized_keys" && !iss.path?.length) {
			unrecIssue ?? (unrecIssue = iss);
			keys = iss.keys;
		} else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
			const k = String(iss.path[0]);
			if (!keyIssues.has(k)) keyIssues.set(k, iss);
			keys = [k];
		} else return false;
		for (const k of keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k)[side] = true;
		}
		return true;
	};
	for (const iss of left.issues) if (!collect(iss, "l")) result.issues.push(iss);
	for (const iss of right.issues) if (!collect(iss, "r")) result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length) {
		const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
		if (aggregated.length) result.issues.push({
			...unrecIssue,
			keys: aggregated
		});
		for (const k of bothKeys) if (!aggregated.includes(k) && keyIssues.has(k)) result.issues.push(keyIssues.get(k));
	}
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) {
		if (aborted(result)) return result;
		throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	}
	result.value = merged.data;
	return result;
}
var $ZodTuple = /*@__PURE__*/ $constructor("$ZodTuple", (inst, def) => {
	$ZodType.init(inst, def);
	const items = def.items;
	const memo = globalConfig.memoizer;
	memo?.attach(inst);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				input,
				inst,
				expected: "tuple",
				code: "invalid_type"
			});
			return payload;
		}
		payload.value = memo ? memo.alloc(inst, payload, [], ctx) : [];
		const proms = [];
		const optinStart = getTupleOptStart(items, "optin");
		const optoutStart = getTupleOptStart(items, "optout");
		if (!def.rest) {
			if (input.length < optinStart) {
				payload.issues.push({
					code: "too_small",
					minimum: optinStart,
					inclusive: true,
					input,
					inst,
					origin: "array"
				});
				return payload;
			}
			if (input.length > items.length) payload.issues.push({
				code: "too_big",
				maximum: items.length,
				inclusive: true,
				input,
				inst,
				origin: "array"
			});
		}
		const itemResults = new Array(items.length);
		const abortEarly = def.rest ? ctx?.abortEarly : void 0;
		let itemAborted = false;
		for (let i = 0; i < items.length; i++) {
			const r = items[i]._zod.run({
				value: input[i],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((rr) => {
				itemResults[i] = rr;
			}));
			else {
				itemResults[i] = r;
				if (abortEarly && !itemAborted && r.issues.length) itemAborted = aborted(r);
			}
		}
		if (def.rest && !itemAborted) {
			let i = items.length - 1;
			const rest = input.slice(items.length);
			let seen = payload.issues.length;
			for (const el of rest) {
				if (abortEarly && payload.issues.length !== seen) {
					if (aborted(payload, seen)) break;
					seen = payload.issues.length;
				}
				i++;
				const result = def.rest._zod.run({
					value: el,
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((r) => handleTupleResult(r, payload, i)));
				else handleTupleResult(result, payload, i);
			}
		}
		if (proms.length) return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input, optoutStart));
		return handleTupleResults(itemResults, payload, items, input, optoutStart);
	};
});
function getTupleOptStart(items, key) {
	for (let i = items.length - 1; i >= 0; i--) if (!(key === "optin" ? items[i]._zod.optin !== void 0 : items[i]._zod.optout === "optional")) return i + 1;
	return 0;
}
function handleTupleResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input, optoutStart) {
	for (let i = 0; i < items.length; i++) {
		const r = itemResults[i];
		const isPresent = i < input.length;
		if (!isPresent && i >= optoutStart && items[i]._zod.optin === "optional") {
			final.value.length = i;
			break;
		}
		if (r.issues.length) {
			if (!isPresent && i >= optoutStart) {
				final.value.length = i;
				break;
			}
			final.issues.push(...prefixIssues(i, r.issues));
		}
		final.value[i] = r.value;
	}
	for (let i = final.value.length - 1; i >= input.length; i--) if (items[i]._zod.optout === "optional" && final.value[i] === void 0) final.value.length = i;
	else break;
	return final;
}
var $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	defineLazyInternal(inst, "pattern", (zod) => {
		const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
		return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
	});
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
var $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	const values = new Set(def.values);
	inst._zod.values = values;
	defineLazyInternal(inst, "pattern", (zod) => {
		const vals = zod.def.values;
		return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
	});
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
var $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	globalConfig.memoizer?.guard(inst);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		return payload;
	};
});
function handleOptionalResult(payload, result) {
	payload.value = result.issues.length ? void 0 : result.value;
	return payload;
}
var $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	inst._zod.optout = "optional";
	defineLazyInternal(inst, "values", (zod) => {
		const values = zod.def.innerType._zod.values;
		return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
	});
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === void 0) {
			if (def.innerType._zod.optin !== "defaulted") return payload;
			const result = def.innerType._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) return result.then((result) => handleOptionalResult(payload, result));
			return handleOptionalResult(payload, result);
		}
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "pattern", (zod) => {
		const pattern = zod.def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazyInternal(inst, "values", (zod) => {
		return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
var $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "defaulted";
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => {
		const v = zod.def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
function handleCatchResult(payload, result, def, ctx) {
	if (!result.issues.length) {
		payload.value = result.value;
		if (result.memo) payload.memo = true;
		return payload;
	}
	payload.value = def.catchValue({
		...result,
		value: payload.value,
		error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
		input: payload.value
	});
	return payload;
}
var $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run({
			value: payload.value,
			issues: []
		}, ctx);
		if (result instanceof Promise) return result.then((result) => handleCatchResult(payload, result, def, ctx));
		return handleCatchResult(payload, result, def, ctx);
	};
});
var $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues
	}, ctx);
}
var $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
	defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
	defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
	defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	if (!payload.memo) payload.value = Object.freeze(payload.value);
	return payload;
}
var $ZodLazy = /*@__PURE__*/ $constructor("$ZodLazy", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "innerType", () => {
		const d = def;
		if (!d._cachedInner) d._cachedInner = def.getter();
		return d._cachedInner;
	});
	defineLazyInternal(inst, "pattern", (zod) => zod.innerType?._zod?.pattern);
	defineLazyInternal(inst, "propValues", (zod) => zod.innerType?._zod?.propValues);
	defineLazyInternal(inst, "optin", (zod) => zod.innerType?._zod?.optin ?? void 0);
	defineLazyInternal(inst, "optout", (zod) => zod.innerType?._zod?.optout ?? void 0);
	inst._zod.parse = (payload, ctx) => {
		return inst._zod.innerType._zod.run(payload, ctx);
	};
});
var $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
// node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
	constructor() {
		super(`Cannot parse a reference cycle that closes through a transform`);
		this.name = "ZodCyclicError";
	}
};
/** Keyed off the context object every schema in one parse call already shares. */
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
	return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
	return issues.map((iss) => iss.path ? {
		...iss,
		path: iss.path.slice()
	} : { ...iss });
}
var recursive = /*@__PURE__*/ new WeakMap();
/** What the walk established, in order of certainty: ordered so the strongest answer among children wins. */
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
/** Whether this schema's subtree contains a cycle, so one parse can re-enter it. */
function isRecursive(inst, stack, resolve) {
	const cached = recursive.get(inst);
	if (cached !== void 0) return cached ? PROVEN : NONE;
	if (stack.has(inst)) return PROVEN;
	stack.add(inst);
	let result = NONE;
	const check = (child) => {
		if (result !== PROVEN && child?._zod) {
			const answer = isRecursive(child, stack, resolve);
			if (answer > result) result = answer;
		}
	};
	const shape = (sh, spread) => {
		let answer = NONE;
		for (const key of Reflect.ownKeys(sh)) {
			const desc = Object.getOwnPropertyDescriptor(sh, key);
			if (spread && !desc.enumerable) continue;
			const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
			if (child > answer) answer = child;
		}
		return answer;
	};
	const merge = (answer) => {
		if (answer > result) result = answer;
	};
	const def = inst._zod.def;
	switch (def.type) {
		case "object": {
			const raw = rawShape(def);
			merge(raw ? shape(raw, true) : ASSUMED);
			check(def.catchall);
			break;
		}
		case "array":
			check(def.element);
			break;
		case "tuple":
			for (const el of def.items) check(el);
			check(def.rest);
			break;
		case "record":
		case "map":
			check(def.keyType);
			check(def.valueType);
			break;
		case "set":
			check(def.valueType);
			break;
		case "union":
			for (const el of def.options) check(el);
			break;
		case "intersection":
			check(def.left);
			check(def.right);
			break;
		case "optional":
		case "nullable":
		case "default":
		case "prefault":
		case "catch":
		case "readonly":
		case "nonoptional":
		case "promise":
		case "success":
			check(def.innerType);
			break;
		case "pipe":
			check(def.in);
			check(def.out);
			break;
		case "function":
			check(def.input);
			check(def.output);
			break;
		case "lazy": {
			const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
			merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
			break;
		}
		case "template_literal":
		case "string":
		case "number":
		case "int":
		case "boolean":
		case "bigint":
		case "symbol":
		case "undefined":
		case "null":
		case "void":
		case "never":
		case "any":
		case "unknown":
		case "date":
		case "nan":
		case "enum":
		case "literal":
		case "file":
		case "transform":
		case "custom": break;
		default: for (const key in def) {
			const desc = Object.getOwnPropertyDescriptor(def, key);
			if (!desc || desc.get) continue;
			const value = desc.value;
			if (!value || typeof value !== "object") continue;
			if (value._zod) check(value);
			else if (Array.isArray(value)) for (const el of value) check(el);
		}
	}
	stack.delete(inst);
	return settle(inst, result);
}
/** An assumed answer must not outlive the resolution that settles it, so only a certain one is cached. */
function settle(inst, answer) {
	if (answer !== ASSUMED) recursive.set(inst, answer === PROVEN);
	return answer;
}
function bucketFor(state, inst) {
	let bucket = state.buckets.get(inst);
	if (!bucket) {
		bucket = /* @__PURE__ */ new WeakMap();
		state.buckets.set(inst, bucket);
	}
	return bucket;
}
var handoff;
var open = [];
var memo = {
	alloc(_inst, payload, empty) {
		const bucket = handoff;
		if (!bucket) return empty;
		handoff = void 0;
		const entry = {
			value: empty,
			issues: null
		};
		bucket.set(payload.value, entry);
		open.push(entry);
		return empty;
	},
	guard(inst) {
		var _a;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value)) throw new $ZodCyclicError();
				return base(payload, ctx);
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	},
	attach(inst) {
		var _a;
		let isRecursiveInst;
		let rechecked = false;
		let lastCtx;
		let lastBucket;
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred.push(() => {
			const base = inst._zod.parse;
			const wrapped = (payload, ctx) => {
				if (isRecursiveInst === void 0) {
					const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
					if (walked === NONE) {
						inst._zod.parse = base;
						if (inst._zod.run === wrapped) inst._zod.run = base;
						return base(payload, ctx);
					}
					if (walked === PROVEN || rechecked) isRecursiveInst = true;
					else rechecked = true;
				}
				const input = payload.value;
				if (!isRef(input)) return base(payload, ctx);
				let state = ctx[STATE];
				if (!state) {
					state = {
						buckets: /* @__PURE__ */ new WeakMap(),
						backEdges: void 0
					};
					ctx[STATE] = state;
				}
				let bucket;
				if (lastCtx === ctx) bucket = lastBucket;
				else {
					bucket = bucketFor(state, inst);
					lastCtx = ctx;
					lastBucket = bucket;
				}
				const hit = bucket.get(input);
				if (hit) {
					payload.value = hit.value;
					if (hit.issues) {
						if (hit.issues.length) payload.issues.push(...cloneIssues(hit.issues));
					} else {
						payload.memo = true;
						state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
						state.backEdges.add(hit.value);
					}
					return payload;
				}
				handoff = bucket;
				const depth = open.length;
				const result = base(payload, ctx);
				handoff = void 0;
				const entry = open.length > depth ? open.pop() : void 0;
				if (result instanceof Promise) return result.then((r) => {
					if (entry) entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
					return r;
				});
				if (entry) entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
				return result;
			};
			inst._zod.parse = wrapped;
			if (inst._zod.run === base) inst._zod.run = wrapped;
		});
	}
};
/** The memoizer that gives containers cycle support. `zod` installs it by default; `zod/mini` opts in with `config({ memoizer: memoizer() })`. */
function memoizer() {
	return memo;
}
/** Whether this value is a node a back-edge resolved to before it finished. */
function isBackEdge(ctx, value) {
	const backEdges = ctx[STATE]?.backEdges;
	return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}
// node_modules/zod/v4/locales/en.js
var error$1 = () => {
	const Sizable = {
		string: {
			unit: "characters",
			verb: "to have"
		},
		file: {
			unit: "bytes",
			verb: "to have"
		},
		array: {
			unit: "items",
			verb: "to have"
		},
		set: {
			unit: "items",
			verb: "to have"
		},
		map: {
			unit: "entries",
			verb: "to have"
		}
	};
	function getSizing(origin) {
		return Sizable[origin] ?? null;
	}
	const FormatDictionary = {
		regex: "input",
		email: "email address",
		url: "URL",
		emoji: "emoji",
		uuid: "UUID",
		uuidv4: "UUIDv4",
		uuidv6: "UUIDv6",
		nanoid: "nanoid",
		guid: "GUID",
		cuid: "cuid",
		cuid2: "cuid2",
		ulid: "ULID",
		xid: "XID",
		ksuid: "KSUID",
		datetime: "ISO datetime",
		date: "ISO date",
		time: "ISO time",
		duration: "ISO duration",
		ipv4: "IPv4 address",
		ipv6: "IPv6 address",
		mac: "MAC address",
		cidrv4: "IPv4 range",
		cidrv6: "IPv6 range",
		base64: "base64-encoded string",
		base64url: "base64url-encoded string",
		json_string: "JSON string",
		e164: "E.164 number",
		currency_code: "currency code",
		credit_card: "credit card number",
		iban: "IBAN",
		jwt: "JWT",
		template_literal: "input"
	};
	const TypeDictionary = { nan: "NaN" };
	function getTypeName(type, input) {
		if (type === "number" && typeof input === "number" && !Number.isFinite(input)) return String(input);
		return TypeDictionary[type] ?? type;
	}
	return (issue) => {
		switch (issue.code) {
			case "invalid_type": return `Invalid input: expected ${getTypeName(issue.expected)}, received ${getTypeName(parsedType(issue.input), issue.input)}`;
			case "invalid_value":
				if (issue.values.length === 1) return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
				return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
			case "too_big": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
				return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
			}
			case "too_small": {
				const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
				const sizing = getSizing(issue.origin);
				if (sizing) return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
				return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
			}
			case "invalid_format": {
				const _issue = issue;
				if (_issue.format === "starts_with") return `Invalid string: must start with "${_issue.prefix}"`;
				if (_issue.format === "ends_with") return `Invalid string: must end with "${_issue.suffix}"`;
				if (_issue.format === "includes") return `Invalid string: must include "${_issue.includes}"`;
				if (_issue.format === "regex") return `Invalid string: must match pattern ${_issue.pattern}`;
				return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
			}
			case "not_multiple_of": return `Invalid number: must be a multiple of ${issue.divisor}`;
			case "unrecognized_keys": return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${issue.origin}`;
			case "invalid_union":
				if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
				if (issue.inclusive === false) return "Invalid input: more than one option matched";
				return "Invalid input";
			case "invalid_element": return `Invalid value in ${issue.origin}`;
			default: return `Invalid input`;
		}
	};
};
function en_default() {
	return { localeError: error$1() };
}
// node_modules/zod/v4/locales/ko.js
var error = () => {
	const Sizable = {
		string: {
			unit: "문자",
			verb: "to have"
		},
		file: {
			unit: "바이트",
			verb: "to have"
		},
		array: {
			unit: "개",
			verb: "to have"
		},
		set: {
			unit: "개",
			verb: "to have"
		},
		map: {
			unit: "개",
			verb: "to have"
		}
	};
	function getSizing(origin) {
		return Sizable[origin] ?? null;
	}
	const FormatDictionary = {
		regex: "입력",
		email: "이메일 주소",
		url: "URL",
		emoji: "이모지",
		uuid: "UUID",
		uuidv4: "UUIDv4",
		uuidv6: "UUIDv6",
		nanoid: "nanoid",
		guid: "GUID",
		cuid: "cuid",
		cuid2: "cuid2",
		ulid: "ULID",
		xid: "XID",
		ksuid: "KSUID",
		datetime: "ISO 날짜시간",
		date: "ISO 날짜",
		time: "ISO 시간",
		duration: "ISO 기간",
		ipv4: "IPv4 주소",
		ipv6: "IPv6 주소",
		mac: "MAC 주소",
		cidrv4: "IPv4 범위",
		cidrv6: "IPv6 범위",
		base64: "base64 인코딩 문자열",
		base64url: "base64url 인코딩 문자열",
		json_string: "JSON 문자열",
		e164: "E.164 번호",
		credit_card: "신용카드 번호",
		currency_code: "통화 코드",
		iban: "IBAN",
		jwt: "JWT",
		template_literal: "입력"
	};
	const TypeDictionary = { nan: "NaN" };
	return (issue) => {
		switch (issue.code) {
			case "invalid_type": {
				const expected = TypeDictionary[issue.expected] ?? issue.expected;
				const receivedType = parsedType(issue.input);
				const received = TypeDictionary[receivedType] ?? receivedType;
				if (/^[A-Z]/.test(issue.expected)) return `잘못된 입력: 예상 타입은 instanceof ${issue.expected}, 받은 타입은 ${received}입니다`;
				return `잘못된 입력: 예상 타입은 ${expected}, 받은 타입은 ${received}입니다`;
			}
			case "invalid_value":
				if (issue.values.length === 1) return `잘못된 입력: 값은 ${stringifyPrimitive(issue.values[0])} 이어야 합니다`;
				return `잘못된 옵션: ${joinValues(issue.values, "또는 ")} 중 하나여야 합니다`;
			case "too_big": {
				const adj = issue.inclusive ? "이하" : "미만";
				const suffix = adj === "미만" ? "이어야 합니다" : "여야 합니다";
				const sizing = getSizing(issue.origin);
				const unit = sizing?.unit ?? "요소";
				if (sizing) return `${issue.origin ?? "값"}이 너무 큽니다: ${issue.maximum.toString()}${unit} ${adj}${suffix}`;
				return `${issue.origin ?? "값"}이 너무 큽니다: ${issue.maximum.toString()} ${adj}${suffix}`;
			}
			case "too_small": {
				const adj = issue.inclusive ? "이상" : "초과";
				const suffix = adj === "이상" ? "이어야 합니다" : "여야 합니다";
				const sizing = getSizing(issue.origin);
				const unit = sizing?.unit ?? "요소";
				if (sizing) return `${issue.origin ?? "값"}이 너무 작습니다: ${issue.minimum.toString()}${unit} ${adj}${suffix}`;
				return `${issue.origin ?? "값"}이 너무 작습니다: ${issue.minimum.toString()} ${adj}${suffix}`;
			}
			case "invalid_format": {
				const _issue = issue;
				if (_issue.format === "starts_with") return `잘못된 문자열: "${_issue.prefix}"(으)로 시작해야 합니다`;
				if (_issue.format === "ends_with") return `잘못된 문자열: "${_issue.suffix}"(으)로 끝나야 합니다`;
				if (_issue.format === "includes") return `잘못된 문자열: "${_issue.includes}"을(를) 포함해야 합니다`;
				if (_issue.format === "regex") return `잘못된 문자열: 정규식 ${_issue.pattern} 패턴과 일치해야 합니다`;
				return `잘못된 ${FormatDictionary[_issue.format] ?? issue.format}`;
			}
			case "not_multiple_of": return `잘못된 숫자: ${issue.divisor}의 배수여야 합니다`;
			case "unrecognized_keys": return `인식할 수 없는 키: ${joinValues(issue.keys, ", ")}`;
			case "invalid_key": return `잘못된 키: ${issue.origin}`;
			case "invalid_union": return `잘못된 입력`;
			case "invalid_element": return `잘못된 값: ${issue.origin}`;
			default: return `잘못된 입력`;
		}
	};
};
function ko_default() {
	return { localeError: error() };
}
// node_modules/zod/v4/core/registries.js
var _a$1;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a$1 = globalThis).__zod_globalRegistry ?? (_a$1.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
	if (def.checks) def.checks = [...def.checks];
	return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class(snapshotChecks({
		type: "string",
		...normalizeParams(params)
	}));
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class(snapshotChecks({
		type: "number",
		checks: [],
		...normalizeParams(params)
	}));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
// node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
	for (const source of sources) for (const key of Reflect.ownKeys(source)) if (Object.prototype.propertyIsEnumerable.call(source, key)) assignProp(target, key, source[key]);
	return target;
}
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		sharedDefsExtractedFor: void 0,
		sharedEmitDoneFor: void 0,
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		intersections: [],
		deferred: [],
		external: params?.external ?? void 0
	};
}
/**
* Applies the `unrepresentable` setting at a site that has no JSON Schema equivalent. Throws
* `message` unless the setting (or the handler's return value) says otherwise. Returns `true` if a
* custom JSON Schema was written into `json`, in which case the caller must not write its own.
*/
function handleUnrepresentable(schema, ctx, json, params, message) {
	const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({
		zodSchema: schema,
		path: params.path,
		message
	}) : ctx.unrepresentable;
	if (result === "any") return false;
	if (result === void 0 || result === "throw") throw new Error(message);
	Object.assign(json, result);
	return true;
}
function processSchema(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	ctx.sharedDefsExtractedFor = void 0;
	ctx.sharedEmitDoneFor = void 0;
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			processSchema(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) assignProps(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function encodeJSONPointerSegment(segment) {
	return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external) return;
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}`
			};
		}
		const uriPrefix = `#`;
		const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
		if (entry[1] === root && !entry[1].schema.id) return { ref: uriPrefix };
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + encodeJSONPointerSegment(defId)
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") extractToDef(entry);
		}
	}
	if (ctx.external) ctx.sharedDefsExtractedFor = ctx.external;
}
/** Rewrites `anyOf: [{type: "a"}, {type: "b"}]` to `type: ["a", "b"]`, which every JSON Schema draft treats as equivalent and most consumers render far better for the nullable case. Only branches that are a bare type assertion qualify — anything carrying a constraint, `$ref`, `const` or metadata is left alone. Runs after `flattenRef`, so a branch an override decorated or `$defs` extraction turned into a `$ref` is no longer bare and correctly stays in `anyOf`. `oneOf` is excluded: `integer` and `number` overlap, so "exactly one" and "at least one" are not the same there. OpenAPI 3.0 is excluded: its `type` must be a single string. */
function compactTypeUnion(schema) {
	const options = schema.anyOf;
	if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0) return;
	const types = [];
	for (const option of options) {
		if (!option || typeof option !== "object") return;
		compactTypeUnion(option);
		const keys = Object.keys(option);
		if (keys.length !== 1 || keys[0] !== "type") return;
		const type = option.type;
		for (const member of Array.isArray(type) ? type : [type]) {
			if (typeof member !== "string") return;
			if (!types.includes(member)) types.push(member);
		}
	}
	delete schema.anyOf;
	schema.type = types.length === 1 ? types[0] : types;
}
/** Keywords `foldIntersection` knows how to combine. Anything else — `$ref`, `patternProperties`,
* an annotation like `description` — makes a member unfoldable, so a constraint this does not
* understand leaves the `allOf` alone instead of being silently dropped or misattributed. */
var FOLDABLE_KEYS = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]);
var UNION_KEYS = ["oneOf", "anyOf"];
/** A member's constraint on a key it does not declare itself. A `catchall` states one; `false`, an absent `additionalProperties`, and the empty schema a loose object emits state nothing. */
function undeclaredConstraint(member) {
	const extra = member.additionalProperties;
	if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null) return null;
	return Object.keys(extra).length ? extra : null;
}
/** Combines object members into the single object they describe together, or returns `null` if any of them carries a keyword outside {@link FOLDABLE_KEYS}. */
function foldObjects(members) {
	const objects = [];
	for (const member of members) {
		if (typeof member !== "object" || member.type !== "object") return null;
		for (const key in member) if (!FOLDABLE_KEYS.has(key)) return null;
		objects.push(member);
	}
	const properties = {};
	const required = /* @__PURE__ */ new Set();
	for (const object of objects) {
		for (const key in object.properties) {
			if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
			const parts = [];
			for (const other of objects) {
				const part = other.properties?.[key] ?? undeclaredConstraint(other);
				if (part === null || part === void 0) continue;
				if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part))) parts.push(part);
			}
			assignProp(properties, key, parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts });
		}
		for (const key of object.required ?? []) required.add(key);
	}
	const folded = {
		type: "object",
		properties
	};
	if (required.size) folded.required = [...required];
	if (objects.every((object) => object.additionalProperties === false)) folded.additionalProperties = false;
	else {
		const constraints = [];
		for (const object of objects) {
			const constraint = undeclaredConstraint(object);
			if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint))) constraints.push(constraint);
		}
		if (constraints.length === 1) folded.additionalProperties = constraints[0];
		else if (constraints.length > 1) folded.additionalProperties = { allOf: constraints };
	}
	return folded;
}
/** `additionalProperties` in an `allOf` member sees only that member's own `properties`, so two
* closed object members reject each other's keys and the schema validates nothing. Zod's parser
* pools the key sets instead — `handleIntersectionResults` reports a key as unrecognized only when
* *every* side rejects it — so the emitted schema has to pool them too, and folding the members
* into one object is the encoding that says so on every target.
*
* This runs from `finalize`, after `extractDefs`, which is what keeps it clear of the `$ref`
* machinery: a member extracted into `$defs` is already a `$ref` by now and declines to fold, so it
* keeps its reference and its own closedness rather than being inlined as a stale copy. */
function foldIntersection(json) {
	const allOf = json.allOf;
	if (!Array.isArray(allOf) || allOf.length < 2) return;
	for (const key of FOLDABLE_KEYS) if (key in json) return;
	const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
	let folded = null;
	if (!unions.length) folded = foldObjects(allOf);
	else {
		const union = unions[0];
		const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
		if (Object.keys(union).length !== 1) return;
		const rest = allOf.filter((m) => m !== union);
		const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
		if (branches.some((b) => !b)) return;
		folded = { [keyword]: branches };
	}
	if (!folded) return;
	delete json.allOf;
	assignProps(json, folded);
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else assignProps(schema, refSchema);
			assignProps(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
		for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
		if (ctx.target !== "openapi-3.0") for (const entry of ctx.seen.entries()) compactTypeUnion(entry[1].def ?? entry[1].schema);
		for (const rewrite of ctx.deferred) rewrite();
		if (ctx.intersections.length) {
			const carriers = /* @__PURE__ */ new Map();
			for (const seen of ctx.seen.values()) for (const json of [seen.schema, seen.def]) {
				const allOf = json?.allOf;
				if (!Array.isArray(allOf)) continue;
				const existing = carriers.get(allOf);
				if (existing) existing.push(json);
				else carriers.set(allOf, [json]);
			}
			for (const allOf of ctx.intersections) for (const json of carriers.get(allOf) ?? []) foldIntersection(json);
		}
	}
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			assignProp(defs, seen.defId, seen.def);
		}
	}
	if (ctx.external) ctx.sharedEmitDoneFor = ctx.external;
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	processSchema(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	processSchema(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
// node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
	if (agg[key] === void 0 || value > agg[key]) agg[key] = value;
};
var narrowMax = (agg, key, value) => {
	if (agg[key] === void 0 || value < agg[key]) agg[key] = value;
};
var narrowBoth = (agg, value) => {
	narrowMin(agg, "minimum", value);
	narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
	agg.multipleOf ?? (agg.multipleOf = []);
	if (!agg.multipleOf.includes(value)) agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
	agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
	agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
	agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
	agg.format = format;
	if (format.includes("int")) agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
	setFormat(agg, def.format);
	const [minimum, maximum] = ranges[def.format];
	narrowMin(agg, "minimum", minimum);
	narrowMax(agg, "maximum", maximum);
};
var contributors = {
	greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
	less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
	multiple_of: (agg, def) => addDivisor(agg, def.value),
	number_format: formatContributor(NUMBER_FORMAT_RANGES),
	bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
	min_length: minContributor,
	max_length: maxContributor,
	length_equals: (agg, def) => narrowBoth(agg, def.length),
	min_size: minContributor,
	max_size: maxContributor,
	size_equals: (agg, def) => narrowBoth(agg, def.size),
	string_format: (agg, def) => {
		setFormat(agg, def.format);
		if (def.pattern) addPattern(agg, def.pattern);
		if (def.format === "base64" || def.format === "base64url") agg.contentEncoding = def.format;
		if (def.local || def.precision === -1) agg.laxFormat = true;
	},
	mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
	const agg = {};
	const def = schema._zod.def;
	const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
	for (const ch of list) contributors[ch._zod.def.check]?.(agg, ch._zod.def);
	const bag = schema._zod.bag;
	if (bag.minimum !== void 0) narrowMin(agg, "minimum", bag.minimum);
	if (bag.exclusiveMinimum !== void 0) narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
	if (bag.maximum !== void 0) narrowMax(agg, "maximum", bag.maximum);
	if (bag.exclusiveMaximum !== void 0) narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
	if (bag.multipleOf !== void 0) addDivisor(agg, bag.multipleOf);
	if (bag.format !== void 0) {
		agg.format ?? (agg.format = bag.format);
		if (bag.format.includes("int")) agg.isInt = true;
	}
	if (bag.mime) intersectMime(agg, bag.mime);
	for (const pattern of bag.patterns ?? []) addPattern(agg, pattern);
	return agg;
}
var formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
var exactPatterns = /* @__PURE__ */ new Map([[base64Charset, base64], [base64urlCharset, base64url]]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time" || laxFormat) delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const patternList = [...patterns].map(exactPattern);
		if (patternList.length === 1) json.pattern = patternList[0].source;
		else if (patternList.length > 1) json.allOf = [...patternList.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
var numberProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
	json.type = isInt ? "integer" : "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (multipleOf) {
		const divisors = /* @__PURE__ */ new Set();
		for (const divisor of multipleOf) if (Number.isFinite(divisor) && divisor !== 0) divisors.add(Math.abs(divisor));
		else handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
		const [first, ...rest] = divisors;
		if (first !== void 0) json.multipleOf = first;
		if (rest.length) json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
	}
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
var enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.length === 0) {
		json.not = {};
		return;
	}
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	if (def.values.length === 0) {
		json.not = {};
		return;
	}
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof val === "bigint") {
		if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema")) return;
		vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
var customProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
	handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = aggregateChecks(schema);
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = processSchema(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
function inputOptin(schema) {
	const def = schema._zod.def;
	if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) return inputOptin(def.out);
	if (def.type === "catch") return inputOptin(def.innerType);
	return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const shape = def.shape;
	if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) return;
	json.type = "object";
	json.properties = {};
	for (const key in shape) assignProp(json.properties, key, processSchema(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	}));
	const requiredKeys = [];
	for (const key of Object.keys(shape)) {
		const field = def.shape[key];
		if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) requiredKeys.push(key);
	}
	if (requiredKeys.length > 0) json.required = requiredKeys;
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = processSchema(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
var unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => processSchema(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
var intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = processSchema(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = processSchema(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	const allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
	json.allOf = allOf;
	ctx.intersections.push(allOf);
};
var tupleProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "array";
	const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
	const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
	const prefixItems = def.items.map((x, i) => processSchema(x, ctx, {
		...params,
		path: [
			...params.path,
			prefixPath,
			i
		]
	}));
	const rest = def.rest ? processSchema(def.rest, ctx, {
		...params,
		path: [
			...params.path,
			restPath,
			...ctx.target === "openapi-3.0" ? [def.items.length] : []
		]
	}) : null;
	let minItems = def.items.length;
	while (minItems > 0) {
		const item = def.items[minItems - 1];
		if (!(ctx.io === "input" ? inputOptin(item) !== void 0 : item._zod.optout === "optional")) break;
		minItems--;
	}
	const maxItems = def.items.length;
	const isClosed = !def.rest;
	if (ctx.target === "draft-2020-12") {
		json.prefixItems = prefixItems;
		if (isClosed) json.items = false;
		else if (rest) json.items = rest;
		if (minItems > 0) json.minItems = minItems;
		if (isClosed) json.maxItems = maxItems;
	} else if (ctx.target === "openapi-3.0") {
		json.items = { anyOf: prefixItems };
		if (rest) json.items.anyOf.push(rest);
		if (minItems > 0) json.minItems = minItems;
		if (isClosed) json.maxItems = maxItems;
	} else {
		json.items = prefixItems;
		if (isClosed) json.additionalItems = false;
		else if (rest) json.additionalItems = rest;
		if (minItems > 0) json.minItems = minItems;
		if (isClosed) json.maxItems = maxItems;
	}
	const { minimum, maximum } = aggregateChecks(schema);
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
};
var nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
/** Round-trips a default value through JSON so the emitted schema is guaranteed to be valid JSON.
* A BigInt has no reliable encoding, so it goes through `unrepresentable` like any other
* unrepresentable value. Returns a sentinel when the caller must not write a default of its own. */
var UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
	let unrepresentable = false;
	const serialized = JSON.stringify(value, (_, val) => {
		if (typeof val !== "bigint") return val;
		unrepresentable = true;
		return null;
	});
	if (!unrepresentable) return JSON.parse(serialized);
	handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
	return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io !== "input") return;
	const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
	if (value !== UNREPRESENTABLE_DEFAULT) json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	processSchema(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	processSchema(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
var lazyProcessor = (schema, ctx, _json, params) => {
	const innerType = schema._zod.innerType;
	processSchema(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
// node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
	Object.defineProperty(proto, key, {
		configurable: true,
		enumerable: false,
		get() {
			const value = make(this);
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
			return value;
		},
		set(value) {
			Object.defineProperty(this, key, {
				value,
				configurable: true,
				writable: true
			});
		}
	});
}
var initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	const proto = Object.getPrototypeOf(inst);
	if (_installedErrorProtos.has(proto)) return;
	_installedErrorProtos.add(proto);
	_lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
	_lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
	_lazyMethod(proto, "addIssue", (self) => (issue) => {
		self.issues.push(issue);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	_lazyMethod(proto, "addIssues", (self) => (issues) => {
		self.issues.push(...issues);
		self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
	});
	Object.defineProperty(proto, "isEmpty", {
		configurable: true,
		enumerable: false,
		get() {
			return this.issues.length === 0;
		}
	});
};
var ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, void 0, { Parent: Error });
// node_modules/zod/v4/classic/parse.js
var parse$1 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode$1 = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
// node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
	if (!globalConfig.localeError) config(en_default());
}
function _ensureDefaultMemoizer() {
	if (!globalConfig.memoizer) config({ memoizer: memoizer() });
}
var ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	_ensureDefaultLocale();
	$ZodType.init(inst, def);
	inst.def = def;
	inst.type = def.type;
	return inst;
}, {
	check(...chks) {
		const def = this.def;
		return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
			check: ch,
			def: { check: "custom" },
			onattach: []
		} } : ch)] }), { parent: true });
	},
	with(...chks) {
		return this.check(...chks);
	},
	clone(def, params) {
		return clone(this, def, params);
	},
	brand() {
		return this;
	},
	register(reg, meta) {
		reg.add(this, meta);
		return this;
	},
	refine(check, params) {
		return this.check(refine(check, params));
	},
	superRefine(refinement, params) {
		return this.check(superRefine(refinement, params));
	},
	overwrite(fn) {
		return this.check(/* @__PURE__ */ _overwrite(fn));
	},
	optional() {
		return optional(this);
	},
	exactOptional() {
		return exactOptional(this);
	},
	nullable() {
		return nullable(this);
	},
	nullish() {
		return optional(nullable(this));
	},
	nonoptional(params) {
		return nonoptional(this, params);
	},
	array() {
		return array(this);
	},
	or(arg) {
		return union([this, arg]);
	},
	and(arg) {
		return intersection(this, arg);
	},
	transform(tx) {
		return pipe(this, transform(tx));
	},
	default(d) {
		return _default(this, d);
	},
	prefault(d) {
		return prefault(this, d);
	},
	catch(params) {
		return _catch(this, params);
	},
	pipe(target) {
		return pipe(this, target);
	},
	readonly() {
		return readonly(this);
	},
	describe(description) {
		const cl = this.clone();
		globalRegistry.add(cl, { description });
		return cl;
	},
	meta(...args) {
		if (args.length === 0) return globalRegistry.get(this);
		const cl = this.clone();
		globalRegistry.add(cl, args[0]);
		return cl;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(fn, ...args) {
		return args.length === 0 ? fn(this) : fn(this, ...args);
	},
	get "~standard"() {
		return hide(this, "~standard", {
			...standardProps(this),
			jsonSchema: {
				input: createStandardJSONSchemaMethod(this, "input"),
				output: createStandardJSONSchemaMethod(this, "output")
			}
		});
	},
	set "~standard"(value) {
		own(this, "~standard", value);
	},
	parse: function _parse(data, params) {
		return parse$1(this, data, params, { callee: _parse });
	},
	parseAsync: async function _parseAsync(data, params) {
		return await parseAsync(this, data, params, { callee: _parseAsync });
	},
	safeParse(data, params) {
		return safeParse(this, data, params);
	},
	async safeParseAsync(data, params) {
		return safeParseAsync(this, data, params);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(value) {
		own(this, "spa", value);
	},
	validate(data, params) {
		return validate(this, data, params);
	},
	validateAsync(data, params) {
		return validateAsync$1(this, data, params);
	},
	encode: function _encode(data, params) {
		return encode(this, data, params, { callee: _encode });
	},
	decode: function _decode(data, params) {
		return decode$1(this, data, params, { callee: _decode });
	},
	encodeAsync: async function _encodeAsync(data, params) {
		return await encodeAsync(this, data, params, { callee: _encodeAsync });
	},
	decodeAsync: async function _decodeAsync(data, params) {
		return await decodeAsync(this, data, params, { callee: _decodeAsync });
	},
	safeEncode(data, params) {
		return safeEncode(this, data, params);
	},
	safeDecode(data, params) {
		return safeDecode(this, data, params);
	},
	async safeEncodeAsync(data, params) {
		return safeEncodeAsync(this, data, params);
	},
	async safeDecodeAsync(data, params) {
		return safeDecodeAsync(this, data, params);
	},
	toJSONSchema(params) {
		return createToJSONSchemaMethod(this, {})(params);
	},
	get description() {
		return globalRegistry.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
});
/** @internal */
var _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /*@__PURE__*/ derived({
	format: (inst) => aggregateChecks(inst).format ?? null,
	minLength: (inst) => aggregateChecks(inst).minimum ?? null,
	maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
	regex(...args) {
		return this.check(/* @__PURE__ */ _regex(...args));
	},
	includes(...args) {
		return this.check(/* @__PURE__ */ _includes(...args));
	},
	startsWith(...args) {
		return this.check(/* @__PURE__ */ _startsWith(...args));
	},
	endsWith(...args) {
		return this.check(/* @__PURE__ */ _endsWith(...args));
	},
	min(...args) {
		return this.check(/* @__PURE__ */ _minLength(...args));
	},
	max(...args) {
		return this.check(/* @__PURE__ */ _maxLength(...args));
	},
	length(...args) {
		return this.check(/* @__PURE__ */ _length(...args));
	},
	nonempty(...args) {
		return this.check(/* @__PURE__ */ _minLength(1, ...args));
	},
	lowercase(params) {
		return this.check(/* @__PURE__ */ _lowercase(params));
	},
	uppercase(params) {
		return this.check(/* @__PURE__ */ _uppercase(params));
	},
	trim() {
		return this.check(/* @__PURE__ */ _trim());
	},
	normalize(...args) {
		return this.check(/* @__PURE__ */ _normalize(...args));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ _toLowerCase());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ _toUpperCase());
	},
	slugify() {
		return this.check(/* @__PURE__ */ _slugify());
	}
}));
var ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
}, {
	email(params) {
		return this.check(/* @__PURE__ */ _email(ZodEmail, params));
	},
	url(params) {
		return this.check(/* @__PURE__ */ _url(ZodURL, params));
	},
	jwt(params) {
		return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	},
	emoji(params) {
		return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	},
	guid(params) {
		return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
	},
	uuid(params) {
		return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	},
	uuidv4(params) {
		return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	},
	uuidv6(params) {
		return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	},
	uuidv7(params) {
		return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	},
	nanoid(params) {
		return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	},
	cuid(params) {
		return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	},
	cuid2(params) {
		return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	},
	ulid(params) {
		return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
	},
	base64(params) {
		return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
	},
	base64url(params) {
		return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	},
	xid(params) {
		return this.check(/* @__PURE__ */ _xid(ZodXID, params));
	},
	ksuid(params) {
		return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	},
	ipv4(params) {
		return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	},
	ipv6(params) {
		return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	},
	cidrv4(params) {
		return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	},
	cidrv6(params) {
		return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	},
	e164(params) {
		return this.check(/* @__PURE__ */ _e164(ZodE164, params));
	},
	datetime(params) {
		return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
	},
	date(params) {
		return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
	},
	time(params) {
		return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
	},
	duration(params) {
		return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
	}
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
var ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
var ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	inst.isFinite = true;
}, /*@__PURE__*/ derived({
	minValue: (inst) => {
		const { minimum, exclusiveMinimum } = aggregateChecks(inst);
		return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
	},
	maxValue: (inst) => {
		const { maximum, exclusiveMaximum } = aggregateChecks(inst);
		return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
	},
	isInt: (inst) => {
		const { isInt, multipleOf } = aggregateChecks(inst);
		return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
	},
	format: (inst) => aggregateChecks(inst).format ?? null
}, {
	gt(value, params) {
		return this.check(/* @__PURE__ */ _gt(value, params));
	},
	gte(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	min(value, params) {
		return this.check(/* @__PURE__ */ _gte(value, params));
	},
	lt(value, params) {
		return this.check(/* @__PURE__ */ _lt(value, params));
	},
	lte(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	max(value, params) {
		return this.check(/* @__PURE__ */ _lte(value, params));
	},
	int(params) {
		return this.check(int(params));
	},
	safe(params) {
		return this.check(int(params));
	},
	positive(params) {
		return this.check(/* @__PURE__ */ _gt(0, params));
	},
	nonnegative(params) {
		return this.check(/* @__PURE__ */ _gte(0, params));
	},
	negative(params) {
		return this.check(/* @__PURE__ */ _lt(0, params));
	},
	nonpositive(params) {
		return this.check(/* @__PURE__ */ _lte(0, params));
	},
	multipleOf(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	step(value, params) {
		return this.check(/* @__PURE__ */ _multipleOf(value, params));
	},
	finite() {
		return this;
	}
}));
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
var ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
var ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
var ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
var ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
var ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
}, {
	min(n, params) {
		return this.check(/* @__PURE__ */ _minLength(n, params));
	},
	nonempty(params) {
		return this.check(/* @__PURE__ */ _minLength(1, params));
	},
	max(n, params) {
		return this.check(/* @__PURE__ */ _maxLength(n, params));
	},
	length(n, params) {
		return this.check(/* @__PURE__ */ _length(n, params));
	},
	unwrap() {
		return this.element;
	}
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
var ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
	keyof() {
		return _enum(Object.keys(this._zod.def.shape));
	},
	catchall(catchall) {
		return this.clone(mergeDefs(this._zod.def, { catchall }));
	},
	passthrough() {
		return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
	},
	loose() {
		return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
	},
	strict() {
		return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
	},
	strip() {
		return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
	},
	extend(incoming) {
		return extend(this, incoming);
	},
	safeExtend(incoming) {
		return safeExtend(this, incoming);
	},
	merge(other) {
		return merge(this, other);
	},
	pick(mask) {
		return pick(this, mask);
	},
	omit(mask) {
		return omit(this, mask);
	},
	partial(...args) {
		return partial(ZodOptional, this, args[0]);
	},
	exactPartial(...args) {
		return partial(ZodExactOptional, this, args[0], "exactPartial");
	},
	required(...args) {
		return required(ZodNonOptional, this, args[0]);
	}
});
function strictObject(shape, params) {
	return new ZodObject({
		type: "object",
		shape,
		catchall: never(),
		...normalizeParams(params)
	});
}
var ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
var ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
var ZodTuple = /*@__PURE__*/ $constructor("ZodTuple", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodTuple.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => tupleProcessor(inst, ctx, json, params);
}, {
	rest(rest) {
		return this.clone({
			...this._zod.def,
			rest
		});
	},
	partial() {
		const def = this._zod.def;
		if (def.checks?.length) throw new Error(".partial() cannot be used on tuple schemas containing refinements");
		return this.clone({
			...def,
			items: def.items.map((item) => new ZodOptional({
				type: "optional",
				innerType: item
			}))
		});
	}
});
function tuple(items, _paramsOrRest, _params) {
	const hasRest = _paramsOrRest instanceof $ZodType;
	return new ZodTuple({
		type: "tuple",
		items,
		rest: hasRest ? _paramsOrRest : null,
		...normalizeParams(hasRest ? _params : _paramsOrRest)
	});
}
var ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = [...inst._zod.values];
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	return new ZodEnum({
		type: "enum",
		entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
		...normalizeParams(params)
	});
}
var ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
var ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	_ensureDefaultMemoizer();
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				if (!("input" in _issue)) _issue.input = payload.value;
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			return payload;
		});
		payload.value = output;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
var ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
var ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
var ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
var ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
var ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
	});
}
var ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
var ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
var ZodLazy = /*@__PURE__*/ $constructor("ZodLazy", (inst, def) => {
	$ZodLazy.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => lazyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.getter();
});
function lazy(getter) {
	return new ZodLazy({
		type: "lazy",
		getter
	});
}
var ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
// src/core/export.ts
var defaultExportOptions = {
	projectName: "(프로젝트 미설정)",
	plcInfo: "QCPU (Q mode) Q03UDV"
};
/** 명령이 차지하는 스텝 수 (샘플에서 확인한 명령만) */
function stepCount(instr) {
	const { op, args } = instr;
	if (op === "RST" && /^C\d/.test(args[0] ?? "")) return 4;
	if ((op === "SET" || op === "RST") && /^[TC]\d/.test(args[0] ?? "")) throw new Error(`GX Works2 샘플로 확인하지 않은 명령: ${op} ${args[0]}`);
	if (op === "OUT" && /^[TC]\d/.test(args[0] ?? "")) return 4;
	if (op === "FMOV" || op === "BMOV") return 4;
	if (op === "BKRST" || op === "MOVP" || op === "DMOV") return 3;
	if (op === "+P" || op === "-P") return args[0] === args[2] ? 5 : 4;
	if (op === "*P" || op === "/P") return 4;
	if (op === "MOV" || op === "PLS" || op === "LDP") return 2;
	if (/^(LD|AND|OR)[=<>]/.test(op)) return 3;
	if (oneStep.has(op)) return 1;
	throw new Error(`GX Works2 샘플로 확인하지 않은 명령: ${op}`);
}
var oneStep = /* @__PURE__ */ new Set([
	"LD",
	"LDI",
	"AND",
	"ANI",
	"OR",
	"ORI",
	"ORB",
	"ANB",
	"OUT",
	"SET",
	"RST",
	"END"
]);
function utf16le(text) {
	const bytes = new Uint8Array(2 + text.length * 2);
	bytes[0] = 255;
	bytes[1] = 254;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		bytes[2 + i * 2] = code & 255;
		bytes[3 + i * 2] = code >> 8;
	}
	return bytes;
}
var line = (cells) => cells.map((c) => `"${c}"`).join("	");
/** 프로그램 CSV: UTF-16 LE + BOM, 탭 구분, CRLF. END는 자동으로 붙인다 */
function exportProgram(rungs, options = defaultExportOptions) {
	const lines = [
		line([options.projectName]),
		line(["PLC 정보:", options.plcInfo]),
		line([
			"스텝 번호",
			"행 간 스테이트먼트",
			"명령",
			"I/O(디바이스)",
			"공백란",
			"PI 스테이트먼트",
			"노트"
		])
	];
	let step = 0;
	const write = (instr) => {
		lines.push(line([
			String(step),
			"",
			instr.op,
			instr.args[0] ?? "",
			"",
			"",
			""
		]));
		for (const arg of instr.args.slice(1)) lines.push(line([
			"",
			"",
			"",
			arg,
			"",
			"",
			""
		]));
		step += stepCount(instr);
	};
	for (const rung of rungs) {
		const statement = rung.statement ?? noteStatement(rung.note);
		if (statement) {
			lines.push(line([
				String(step),
				statement,
				"",
				"",
				"",
				"",
				""
			]));
			step += statementSteps(statement);
		}
		rung.instrs.forEach(write);
	}
	write({
		op: "END",
		args: []
	});
	return utf16le(lines.map((l) => l + "\r\n").join(""));
}
/**
* 렁 설명 → 행 간 스테이트먼트. 앞에 *를 붙인 주변 방식이라 PLC에 저장되지 않고 1스텝만 차지한다.
* 가정: 길이 제한 64칸(한글 2칸)에서 자른다. 화살표는 샘플에 없는 글자라 ->로 바꾼다
*/
function noteStatement(note) {
	return note ? fit(`*${note.replaceAll("→", "->")}`, 64).text : "";
}
/** 스테이트먼트가 차지하는 스텝 수 (샘플로 확인): 주변 방식(*로 시작) 1, 통합 방식 2 + 글자 칸 수의 절반(올림) */
function statementSteps(statement) {
	if (statement.startsWith("*")) return 1;
	const width = [...statement].reduce((sum, ch) => sum + cellWidth(ch), 0);
	return 2 + Math.ceil(width / 2);
}
/** 코멘트 CSV: UTF-16 LE + BOM, 탭 구분, LF (프로그램 CSV와 줄바꿈이 다름) */
function exportComments(entries, projectName = defaultExportOptions.projectName) {
	return utf16le([
		line([projectName]),
		line(["디바이스명", "코멘트"]),
		...entries.map((e) => line([e.device, e.comment]))
	].map((l) => l + "\n").join(""));
}
var cellWidth = (ch) => ch.charCodeAt(0) > 127 ? 2 : 1;
function fit(text, cells) {
	let out = "";
	let width = 0;
	for (const ch of text) {
		if (width + cellWidth(ch) > cells) return {
			text: out,
			width,
			cut: true
		};
		out += ch;
		width += cellWidth(ch);
	}
	return {
		text: out,
		width,
		cut: false
	};
}
/**
* 디바이스 코멘트 최대 3행×8칸(한글 2칸, 영문·숫자·공백 1칸).
* 코멘트는 한 문자열이므로 마지막 행을 뺀 각 행을 공백으로 8칸까지 채워 잇는다.
*/
function formatComment(...lines) {
	const filled = lines.filter((l) => l);
	const rows = filled.slice(0, 3).map((l) => fit(l, 8));
	return {
		comment: rows.map((r, i) => i < rows.length - 1 ? r.text + " ".repeat(8 - r.width) : r.text).join(""),
		truncated: filled.length > 3 || rows.some((r) => r.cut)
	};
}
// src/core/types.ts
var defaultDeviceConfig = {
	mStart: 0,
	tStart: 0,
	cStart: 0,
	dStart: 0,
	timerTicksPerSecond: 10
};
// src/core/generate.ts
var isLit = (n) => "device" in n;
var lit = (device, neg = false) => ({
	device,
	neg
});
var ins = (op, ...args) => ({
	op,
	args
});
var operand$1 = (value) => typeof value === "number" ? `K${value}` : value;
var opposite = {
	"=": "<>",
	"<>": "=",
	">": "<=",
	"<=": ">",
	"<": ">=",
	">=": "<"
};
var negated = {
	LD: "LDI",
	AND: "ANI",
	OR: "ORI"
};
/** 접점 명령. 비교 접점의 부정은 반대 연산자로 바꾼다 */
function contact(base, l) {
	if (l.cmp) return ins(base + (l.neg ? opposite[l.cmp] : l.cmp), l.device, l.right);
	return ins(l.neg ? negated[base] : base, l.device);
}
/** 같은 종류의 중첩 묶음을 펴고, 항목이 하나뿐인 묶음은 그 항목으로 바꾼다 */
function group(kind, items) {
	const flat = items.flatMap((n) => !isLit(n) && n.kind === kind ? n.items : [n]);
	if (flat.length === 0) throw new Error("빈 조건식");
	return flat.length === 1 ? flat[0] : {
		kind,
		items: flat
	};
}
/** 조건 묶음 → LD로 시작하는 명령 블록 */
function compile(node) {
	if (isLit(node)) return [contact("LD", node)];
	const [series, join] = node.kind === "and" ? ["AND", "ANB"] : ["OR", "ORB"];
	const out = compile(node.items[0]);
	for (const item of node.items.slice(1)) if (isLit(item)) out.push(contact(series, item));
	else out.push(...compile(item), ins(join));
	return out;
}
/**
* 단계 표 + 운전 설정 → 래더 (단계 릴레이 방식).
* 블록 순서: 운전 상태 → 전이 성립 비트 → 단계 갱신 → 타이머·카운터 → 이상 감지
* → 모든 단계 해제 → 원점복귀 → 출력.
* 전이 판정 블록은 단계 릴레이를 바꾸지 않으므로 한 스캔에 한 단계만 진행하고,
* 출력 코일은 마지막 블록에만 있어 이중 코일이 생기지 않는다.
*/
function generate(table, op, tags = [], config = defaultDeviceConfig) {
	const { steps, transitions } = table;
	const counters = table.counters ?? [];
	const { stop, estop, reset, autoManual, homeButton, homeCondition } = op;
	const sensorPairs = op.sensorPairs ?? [];
	const limited = steps.filter((s) => s.timeLimit !== void 0);
	const timed = steps.filter((s) => s.timer !== null);
	let m = config.mStart;
	const nextM = () => `M${m++}`;
	const stepM = new Map(steps.map((s) => [s.id, nextM()]));
	const trM = transitions.map(() => nextM());
	const runM = nextM();
	const stopM = stop ? nextM() : null;
	const faultM = limited.length + sensorPairs.length > 0 ? nextM() : null;
	const homingM = homeButton && homeCondition ? nextM() : null;
	const stepT = new Map(timed.map((s, i) => [s.id, `T${config.tStart + i}`]));
	const limitT = new Map(limited.map((s, i) => [s.id, `T${config.tStart + timed.length + i}`]));
	const counterC = new Map(counters.map((c, i) => [c.id, `C${config.cStart + i}`]));
	const faultD = `D${config.dStart}`;
	const stepName = new Map(steps.map((s) => [s.id, s.name]));
	const ticks = (seconds) => `K${Math.round(seconds * config.timerTicksPerSecond)}`;
	const relay = (id) => {
		const device = stepM.get(id);
		if (!device) throw new Error(`없는 단계: ${id}`);
		return device;
	};
	const bContact = new Set(tags.filter((t) => t.contact === "B").map((t) => t.address));
	const inp = (address, neg = false) => lit(address, neg !== bContact.has(address));
	const toNode = (cond, neg = false) => {
		switch (cond.kind) {
			case "input": return inp(cond.address, neg);
			case "timer": {
				const t = stepT.get(cond.step);
				if (!t) throw new Error(`타이머가 없는 단계: ${cond.step}`);
				return lit(t, neg);
			}
			case "counter": {
				const c = counterC.get(cond.id);
				if (!c) throw new Error(`없는 카운터: ${cond.id}`);
				return lit(c, neg);
			}
			case "compare": return {
				device: cond.left,
				neg,
				cmp: cond.op,
				right: operand$1(cond.right)
			};
			case "not": return toNode(cond.cond, !neg);
			default: return group(neg ? cond.kind === "and" ? "or" : "and" : cond.kind, cond.conds.map((c) => toNode(c, neg)));
		}
	};
	const names = (ids) => ids.map((id) => stepName.get(id) ?? id).join(", ");
	const rungs = [];
	const rung = (note, cond, ...outs) => void rungs.push({
		note,
		instrs: [...compile(cond), ...outs]
	});
	/** 비상정지도 이상도 아닐 때만 참 */
	const safe = [...estop ? [inp(estop, true)] : [], ...faultM ? [lit(faultM, true)] : []];
	rung("운전 상태: 진행 중인 단계가 있으면 자동 운전 중", group("or", steps.map((s) => lit(relay(s.id)))), ins("OUT", runM));
	if (stop && stopM) rung("정지 예약: 정지 버튼을 누르면 사이클 끝까지 기억", group("and", [group("or", [inp(stop), lit(stopM)]), lit(runM)]), ins("OUT", stopM));
	transitions.forEach((tr, i) => {
		const earlier = transitions.slice(0, i).flatMap((other, j) => other.from.some((f) => tr.from.includes(f)) ? [lit(trM[j], true)] : []);
		rung(`단계 이동 ${i + 1} 조건: ${names(tr.from)} → ${names(tr.to) || "종료"}`, group("and", [
			...tr.from.map((f) => lit(relay(f))),
			toNode(tr.cond),
			...earlier
		]), ins("OUT", trM[i]));
	});
	rung(`시작: 대기 상태에서 시작 버튼으로 ${names([table.initial])} 시작`, group("and", [
		inp(op.start),
		...autoManual ? [inp(autoManual)] : [],
		lit(runM, true),
		...homeCondition ? [toNode(homeCondition)] : [],
		...safe,
		...homingM ? [lit(homingM, true)] : []
	]), ins("SET", relay(table.initial)));
	transitions.forEach((tr, i) => {
		const where = `${names(tr.from)} → ${names(tr.to) || "종료"}`;
		const sets = tr.to.map((t) => ins("SET", relay(t)));
		const hold = stopM && tr.isCycleEnd && sets.length > 0;
		rung(`단계 이동 ${i + 1} 실행: ${where}`, lit(trM[i]), ...tr.from.map((f) => ins("RST", relay(f))), ...hold ? [] : sets);
		if (hold) rung(`단계 이동 ${i + 1} 실행: 정지 예약이 없을 때만 ${names(tr.to)} 시작`, group("and", [lit(trM[i]), lit(stopM, true)]), ...sets);
	});
	for (const s of timed) rung(`타이머: ${s.name} ${s.timer}초`, lit(relay(s.id)), ins("OUT", stepT.get(s.id), ticks(s.timer)));
	for (const c of counters) {
		const device = counterC.get(c.id);
		rung(`횟수 ${c.name}: 단계 이동 ${c.countOn + 1}마다 1번, ${c.target}번이면 완료`, lit(trM[c.countOn]), ins("OUT", device, `K${c.target}`));
		rung(`횟수 ${c.name} 지움: 단계 이동 ${c.resetOn + 1}`, lit(trM[c.resetOn]), ins("RST", device));
	}
	for (const s of steps) {
		const calcs = s.calcs ?? [];
		if (calcs.length === 0) continue;
		const formula = calcs.map((c) => `${c.target} = ${c.left}${c.op ? ` ${c.op} ${c.right}` : ""}`).join(", ");
		rung(`계산: ${s.name}에 들어올 때 ${formula}`, lit(relay(s.id)), ...calcs.map((c) => c.op ? ins(`${c.op}P`, operand$1(c.left), operand$1(c.right), c.target) : ins("MOVP", operand$1(c.left), c.target)));
	}
	if (faultM) {
		const raise = (note, cond, code) => rung(note, group("and", [...cond, lit(faultM, true)]), ins("MOV", `K${code}`, faultD), ins("SET", faultM));
		if (reset) rung("이상 해제: 리셋 버튼", inp(reset), ins("RST", faultM), ins("MOV", "K0", faultD));
		for (const s of limited) {
			const t = limitT.get(s.id);
			const code = steps.indexOf(s) + 1;
			rung(`제한 시간: ${s.name} ${s.timeLimit}초`, lit(relay(s.id)), ins("OUT", t, ticks(s.timeLimit)));
			raise(`이상 ${code}: ${s.name} 제한 시간 초과`, [lit(t)], code);
		}
		sensorPairs.forEach(([a, b], j) => raise(`이상 ${101 + j}: ${a}, ${b} 동시 감지`, [inp(a), inp(b)], 101 + j));
	}
	const clear = [
		...estop ? [inp(estop)] : [],
		...faultM ? [lit(faultM)] : [],
		...autoManual ? [inp(autoManual, true)] : []
	];
	if (clear.length > 0) rung("비상정지·이상·수동 전환: 모든 단계 해제", group("or", clear), ins("BKRST", `M${config.mStart}`, `K${steps.length}`), ...counters.map((c) => ins("RST", counterC.get(c.id))));
	if (homeButton && homeCondition && homingM) rung("원점복귀: 버튼을 누르면 원위치까지 (자동 운전 중 무시)", group("and", [
		group("or", [inp(homeButton), lit(homingM)]),
		lit(runM, true),
		toNode(homeCondition, true),
		...safe
	]), ins("OUT", homingM));
	const movs = (writes) => writes.map((w) => ins("MOV", `K${w.value}`, w.address));
	const text = (writes) => writes.map((w) => `${w.address} = ${w.value}`).join(", ");
	const alwaysWrites = op.alwaysWrites ?? [];
	if (alwaysWrites.length > 0) rung(`상시 값: ${text(alwaysWrites)}`, lit("SM400"), ...movs(alwaysWrites));
	for (const s of steps) if (s.writes?.length) rung(`값 쓰기: ${s.name} 동안 ${text(s.writes)}`, lit(relay(s.id)), ...movs(s.writes));
	const manual = autoManual ? op.manual ?? [] : [];
	const homeOutputs = homingM ? op.homeOutputs ?? [] : [];
	const alwaysOn = op.alwaysOn ?? [];
	const outputs = [
		...steps.flatMap((s) => s.outputs),
		...manual.map((b) => b.output),
		...homeOutputs,
		...alwaysOn
	];
	for (const y of new Set(outputs)) {
		const users = steps.filter((s) => s.outputs.includes(y));
		const buttons = manual.filter((b) => b.output === y).map((b) => b.button);
		const home = homeOutputs.includes(y);
		const always = alwaysOn.includes(y);
		const sources = [
			...users.map((s) => lit(relay(s.id))),
			...buttons.map((b) => group("and", [inp(b), inp(autoManual, true)])),
			...home ? [lit(homingM)] : [],
			...always ? [lit("SM400")] : []
		];
		const partners = (op.interlocks ?? []).flatMap(([a, b]) => a === y ? [b] : b === y ? [a] : []);
		rung(`출력 ${y}: ${[
			names(users.map((s) => s.id)),
			buttons.length ? `수동 ${buttons.join(", ")}` : "",
			home ? "원점복귀" : "",
			always ? "항상 켬" : ""
		].filter((w) => w).join(" / ")}`, group("and", [
			group("or", sources),
			...partners.map((p) => lit(p, true)),
			...safe
		]), ins("OUT", y));
	}
	if (op.faultLamp && faultM) rung("이상 램프", lit(faultM), ins("OUT", op.faultLamp));
	const brief = (ids) => names(ids.slice(0, 1)) + (ids.length > 1 ? "등" : "");
	return {
		rungs,
		comments: [
			...steps.map((s) => ({
				device: relay(s.id),
				lines: [s.name, "하는 중"]
			})),
			...transitions.map((tr, i) => ({
				device: trM[i],
				lines: [
					brief(tr.from),
					"다음은",
					brief(tr.to) || "끝"
				]
			})),
			{
				device: runM,
				lines: ["자동", "운전 중"]
			},
			...stopM ? [{
				device: stopM,
				lines: ["정지", "예약"]
			}] : [],
			...faultM ? [{
				device: faultM,
				lines: ["이상", "발생"]
			}] : [],
			...homingM ? [{
				device: homingM,
				lines: ["원점", "복귀 중"]
			}] : [],
			...timed.map((s) => ({
				device: stepT.get(s.id),
				lines: [
					s.name,
					"타이머",
					`${s.timer}초`
				]
			})),
			...limited.map((s) => ({
				device: limitT.get(s.id),
				lines: [
					s.name,
					"시간초과",
					`${s.timeLimit}초`
				]
			})),
			...counters.map((c) => ({
				device: counterC.get(c.id),
				lines: [
					c.name,
					"횟수",
					`${c.target}번`
				]
			})),
			...faultM ? [{
				device: faultD,
				lines: ["이상", "번호"]
			}] : [],
			...(table.data ?? []).map((d) => ({
				device: d.address,
				lines: [d.name]
			}))
		]
	};
}
// src/core/steptable.ts
/**
* 조건을 무시하고 전이를 따라가며, 동시에 켜질 수 있는 단계 조합을 전부 찾는다.
* steps = 한 번이라도 켜지는 단계, fired = 성립할 수 있는 전이, remet = 이미 켜진 단계를 다시 켜는 전이
*/
function explore(transitions, start) {
	const steps = /* @__PURE__ */ new Set();
	const fired = /* @__PURE__ */ new Set();
	const remet = /* @__PURE__ */ new Map();
	const seen = /* @__PURE__ */ new Set();
	const queue = [[...new Set(start)].sort()];
	while (queue.length > 0 && seen.size < 5e3) {
		const active = queue.pop();
		const key = active.join("\n");
		if (seen.has(key)) continue;
		seen.add(key);
		active.forEach((s) => steps.add(s));
		transitions.forEach((tr, i) => {
			if (!tr.from.every((f) => active.includes(f))) return;
			fired.add(i);
			const rest = active.filter((s) => !tr.from.includes(s));
			const again = tr.to.find((t) => rest.includes(t));
			if (again !== void 0) remet.set(i, again);
			queue.push([.../* @__PURE__ */ new Set([...rest, ...tr.to])].sort());
		});
	}
	return {
		steps,
		fired,
		remet
	};
}
/** 단계 표의 구조 검사. 오류가 있으면 래더를 생성하지 않는다 */
function validateStepTable(table, config = defaultDeviceConfig) {
	const issues = [];
	const add = (code, message) => void issues.push({
		level: "error",
		code,
		message
	});
	/** 참조 오류: 없는 단계·타이머·카운터를 가리킴 */
	const error = (message) => add("step-ref", message);
	/** 값 오류: 시간, 횟수, 상수 */
	const badValue = (message) => add("step-value", message);
	/** 계산용 워드 오류 */
	const badWord = (message) => add("word", message);
	const ids = /* @__PURE__ */ new Set();
	for (const s of table.steps) {
		if (ids.has(s.id)) error(`단계 id 중복: ${s.id}`);
		ids.add(s.id);
		if (s.timer !== null && s.timer <= 0) badValue(`단계 "${s.name}"의 타이머는 0보다 커야 합니다`);
		if (s.timeLimit !== void 0 && s.timeLimit <= 0) badValue(`단계 "${s.name}"의 제한 시간은 0보다 커야 합니다`);
	}
	if (!ids.has(table.initial)) error(`첫 단계가 단계 목록에 없습니다: ${table.initial}`);
	const counters = table.counters ?? [];
	const counterIds = /* @__PURE__ */ new Set();
	for (const c of counters) {
		if (counterIds.has(c.id)) error(`카운터 id 중복: ${c.id}`);
		counterIds.add(c.id);
		if (!Number.isInteger(c.target) || c.target < 1) badValue(`카운터 "${c.name}"의 목표 횟수는 1 이상의 정수여야 합니다`);
		for (const index of [c.countOn, c.resetOn]) if (!table.transitions[index]) error(`카운터 "${c.name}": 없는 단계 이동 ${index + 1}`);
	}
	const words = /* @__PURE__ */ new Set();
	for (const d of table.data ?? []) {
		if (!/^D\d+$/.test(d.address)) badWord(`워드 주소 형식 오류: ${d.address}`);
		if (words.has(d.address)) badWord(`워드 주소 중복: ${d.address}`);
		if (d.address === `D${config.dStart}`) badWord(`${d.address}은 이상 번호에 씁니다. 다른 워드를 쓰거나 설정에서 이상 번호 워드를 바꾸세요`);
		words.add(d.address);
	}
	const checkOperand = (value, where) => {
		if (typeof value === "string") {
			if (!words.has(value)) badWord(`${where}: 워드 목록에 없는 주소 ${value}`);
		} else if (!Number.isInteger(value) || value < -32768 || value > 32767) badValue(`${where}: 상수는 -32768~32767의 정수여야 합니다 (${value})`);
	};
	for (const s of table.steps) {
		for (const w of s.writes ?? []) checkOperand(w.value, `단계 "${s.name}"의 값 쓰기`);
		for (const c of s.calcs ?? []) {
			const where = `단계 "${s.name}"의 계산`;
			checkOperand(c.target, where);
			checkOperand(c.left, where);
			if (c.op === void 0 !== (c.right === void 0)) badValue(`${where}: 연산자와 둘째 값은 함께 있어야 합니다`);
			if (c.right !== void 0) checkOperand(c.right, where);
			if (c.op === "/" && c.right === 0) badValue(`${where}: 0으로 나눌 수 없습니다`);
			if (c.op === "*" || c.op === "/") {
				const next = `D${Number(c.target.slice(1)) + 1}`;
				const what = c.op === "*" ? "곱셈 결과의 윗자리" : "나머지";
				if (words.has(next) || next === `D${config.dStart}`) badWord(`${where}: ${what}가 ${next}에 쓰여 값이 덮어쓰입니다. ${next}을 비워 두세요`);
			}
		}
	}
	const timed = new Set(table.steps.filter((s) => s.timer !== null).map((s) => s.id));
	const checkCond = (cond, where) => {
		if (cond.kind === "compare") {
			checkOperand(cond.left, where);
			checkOperand(cond.right, where);
		}
		if (cond.kind === "timer" && !timed.has(cond.step)) error(`${where}: 타이머가 없는 단계를 조건으로 씁니다 (${cond.step})`);
		if (cond.kind === "counter" && !counterIds.has(cond.id)) error(`${where}: 없는 카운터를 조건으로 씁니다 (${cond.id})`);
		if (cond.kind === "not") checkCond(cond.cond, where);
		if (cond.kind === "and" || cond.kind === "or") {
			if (cond.conds.length === 0) badValue(`${where}: 조건이 비어 있습니다`);
			cond.conds.forEach((c) => checkCond(c, where));
		}
	};
	table.transitions.forEach((tr, i) => {
		const where = `단계 이동 ${i + 1}`;
		if (tr.from.length === 0) error(`${where}: 출발 단계가 없습니다`);
		for (const id of [...tr.from, ...tr.to]) if (!ids.has(id)) error(`${where}: 없는 단계 ${id}`);
		checkCond(tr.cond, where);
	});
	if (issues.length > 0) return issues;
	const all = explore(table.transitions, [table.initial]);
	for (const s of table.steps) if (!all.steps.has(s.id)) add("unreachable", `어떤 단계 이동으로도 갈 수 없는 단계: ${s.name}`);
	table.transitions.forEach((tr, i) => {
		if (tr.to.length < 2 || !all.fired.has(i)) return;
		if (![...explore(table.transitions, tr.to).fired].some((j) => table.transitions[j].from.length > 1)) add("parallel-join", `단계 이동 ${i + 1}: 병렬 분기 뒤에 합류가 없습니다`);
	});
	for (const [i, id] of [...all.remet].sort((a, b) => a[0] - b[0])) add("parallel-join", `단계 이동 ${i + 1}: 이미 진행 중인 단계 ${id}를 다시 켭니다 (병렬 흐름이 합류 없이 만남)`);
	return issues;
}
// src/core/tags.ts
/** 열 제목으로 쓰이는 말. 앞에 있는 것이 우선 (PlcTwin의 device_comments.xlsx는 디바이스 / 1행 / 2행 / 방향) */
var headerWords = {
	address: [/주소|address/i, /디바이스|device/i],
	name: [/이름|명칭|name/i, /1행/],
	meaning: [/의미|설명|meaning/i, /2행/],
	contact: [/접점|contact/i],
	direction: [/방향|입출력|direction/i]
};
/** 붙여넣은 표나 CSV 글 → 행 배열. 탭이 있으면 탭 구분, 없으면 쉼표 구분(큰따옴표 지원) */
function parseDelimited(text) {
	const delimiter = text.includes("	") ? "	" : ",";
	const rows = [];
	let row = [];
	let cell = "";
	let quoted = false;
	const body = text.replace(/^﻿/, "");
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (quoted) {
			if (ch === "\"" && body[i + 1] === "\"") cell += body[++i];
			else if (ch === "\"") quoted = false;
			else cell += ch;
		} else if (ch === "\"" && cell === "") quoted = true;
		else if (ch === delimiter) {
			row.push(cell);
			cell = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && body[i + 1] === "\n") i++;
			rows.push([...row, cell]);
			row = [];
			cell = "";
		} else cell += ch;
	}
	if (cell !== "" || row.length > 0) rows.push([...row, cell]);
	return rows;
}
/** 첫 행의 열 제목에서 열 종류를 추정한다. 못 찾은 열은 비워 둔다 */
function guessColumns(header) {
	const map = {};
	for (const column of Object.keys(headerWords)) for (const word of headerWords[column]) {
		const index = header.findIndex((cell) => word.test(cell));
		if (index >= 0) {
			map[column] = index;
			break;
		}
	}
	return map;
}
var addressFormat = /^([XY][0-9A-F]+|D\d+(\.[0-9A-F])?)$/;
/** D 주소의 방향 글자 → 입력·출력. PlcTwin 표의 "앱→PLC" / "PLC→앱"도 읽는다 */
function parseDirection(text) {
	if (/입력|input|→\s*PLC/i.test(text)) return "input";
	if (/출력|output|PLC\s*→/i.test(text)) return "output";
}
/**
* 표 → 태그 목록. columns를 주지 않으면 첫 행의 열 제목에서 추정한다.
* 오류가 하나라도 있으면 다음 단계로 가지 않는다. 행 번호는 표의 1부터 센 행이다.
*/
function readTags(rows, columns, header) {
	const guessed = guessColumns(rows[0] ?? []);
	const hasHeader = header ?? Object.keys(guessed).length > 0;
	const map = columns ?? guessed;
	const issues = [];
	const error = (message, row, code = "tag-field") => void issues.push({
		level: "error",
		code,
		row,
		message
	});
	const missing = [map.address === void 0 ? "주소" : "", map.name === void 0 ? "이름" : ""].filter((m) => m);
	if (missing.length > 0) {
		error(`${missing.join(", ")} 열을 찾지 못했습니다. 열을 지정해 주세요`);
		return {
			tags: [],
			issues,
			columns: map
		};
	}
	const cell = (row, column) => (map[column] === void 0 ? "" : row[map[column]] ?? "").trim();
	const tags = [];
	const firstRow = /* @__PURE__ */ new Map();
	rows.forEach((row, index) => {
		const rowNo = index + 1;
		if (index === 0 && hasHeader || row.every((c) => c.trim() === "")) return;
		const address = cell(row, "address").toUpperCase();
		if (!addressFormat.test(address)) return error(`주소 형식 오류: ${cell(row, "address") || "(빈칸)"}`, rowNo, "tag-address");
		const first = firstRow.get(address);
		if (first !== void 0) {
			if (first > 0) error(`주소 중복: ${address}`, first, "tag-duplicate");
			firstRow.set(address, -1);
			return error(`주소 중복: ${address}`, rowNo, "tag-duplicate");
		}
		firstRow.set(address, rowNo);
		const name = cell(row, "name");
		if (!name) return error(`이름이 비어 있습니다: ${address}`, rowNo);
		const contactText = cell(row, "contact");
		if (contactText && !/^[ab]/i.test(contactText)) return error(`접점은 A 또는 B여야 합니다: ${contactText}`, rowNo);
		const direction = address[0] === "X" ? "input" : address[0] === "Y" ? "output" : parseDirection(cell(row, "direction"));
		if (!direction) return error(`${address}의 방향(입력/출력)을 알 수 없습니다. D 주소는 방향 열이 필요합니다`, rowNo);
		tags.push({
			address,
			name,
			meaning: cell(row, "meaning"),
			direction,
			contact: /^b/i.test(contactText) ? "B" : "A"
		});
	});
	issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
	return {
		tags,
		issues,
		columns: map
	};
}
// src/core/verify.ts
/** 할당표에 있어야 하는 주소: X·Y, 워드의 비트(D0.F), 워드(D144) */
var isIo = (device) => /^([XY][0-9A-F]+|D\d+(\.[0-9A-F])?)$/.test(device);
/** D0.F → D0 */
var wordOf = (device) => device.split(".")[0];
/** 명령이 값을 쓰는 디바이스. 접점이면 없음 */
function target(op, args) {
	if ([
		"OUT",
		"SET",
		"RST",
		"BKRST"
	].includes(op)) return args[0];
	if (/^(MOVP?|[-+*/]P)$/.test(op)) return args[args.length - 1];
}
/** 생성된 래더를 I/O 할당표, 운전 설정의 인터록 쌍과 대조한다 */
function verify(program, tags, op) {
	const { rungs } = program;
	const issues = [];
	const byAddress = new Map(tags.map((t) => [t.address, t]));
	const internal = new Set(program.comments.map((c) => c.device));
	const used = /* @__PURE__ */ new Set();
	const coilRungs = /* @__PURE__ */ new Map();
	rungs.forEach((rung, i) => {
		for (const instr of rung.instrs) {
			for (const arg of instr.args) {
				used.add(arg);
				if (isIo(arg) && !byAddress.has(arg) && !internal.has(arg)) issues.push({
					level: "error",
					code: "io-known",
					rung: i,
					message: `I/O 할당표에 없는 주소: ${arg}`
				});
			}
			const written = target(instr.op, instr.args);
			if (written && byAddress.get(written)?.direction === "input") issues.push({
				level: "error",
				code: "input-write",
				rung: i,
				message: `입력 주소에 쓰는 명령: ${instr.op} ${written}`
			});
			if (instr.op === "OUT") coilRungs.set(instr.args[0], [...coilRungs.get(instr.args[0]) ?? [], i]);
		}
	});
	for (const [device, where] of coilRungs) if (where.length > 1) for (const rung of where) issues.push({
		level: "error",
		code: "double-coil",
		rung,
		message: `이중 코일: ${device}`
	});
	for (const [a, b] of op?.interlocks ?? []) for (const [coil, partner] of [[a, b], [b, a]]) for (const rung of coilRungs.get(coil) ?? []) if (!rungs[rung].instrs.some((n) => [
		"LDI",
		"ANI",
		"ORI"
	].includes(n.op) && n.args[0] === partner)) issues.push({
		level: "error",
		code: "interlock",
		rung,
		message: `인터록 누락: ${coil} 렁에 ${partner}의 B접점이 없습니다`
	});
	for (const device of internal) {
		const clash = tags.find((t) => wordOf(t.address) === device);
		if (clash) issues.push({
			level: "error",
			code: "device-overlap",
			message: `내부 디바이스 ${device}이 할당표 주소 ${clash.address}와 겹칩니다. 설정에서 시작 번호를 바꾸세요`
		});
	}
	for (const tag of tags) if (tag.direction === "output" && !used.has(tag.address)) issues.push({
		level: "warning",
		code: "unused-output",
		message: `래더에서 쓰지 않는 출력: ${tag.address} ${tag.name}`
	});
	return issues;
}
// src/core/project.ts
config(ko_default());
var operand = union([string(), number()]);
var compareOp = _enum([
	"=",
	"<>",
	">",
	">=",
	"<",
	"<="
]);
var cond = lazy(() => union([
	strictObject({
		kind: literal("input"),
		address: string()
	}),
	strictObject({
		kind: literal("timer"),
		step: string()
	}),
	strictObject({
		kind: literal("counter"),
		id: string()
	}),
	strictObject({
		kind: literal("compare"),
		left: string(),
		op: compareOp,
		right: operand
	}),
	strictObject({
		kind: literal("not"),
		cond
	}),
	strictObject({
		kind: _enum(["and", "or"]),
		conds: array(cond)
	})
]));
var wordWrite = strictObject({
	address: string(),
	value: number()
});
var table = strictObject({
	initial: string(),
	steps: array(strictObject({
		id: string(),
		name: string(),
		outputs: array(string()).default([]),
		timer: number().nullable().default(null),
		timeLimit: number().optional(),
		writes: array(wordWrite).optional(),
		calcs: array(strictObject({
			target: string(),
			left: operand,
			op: _enum([
				"+",
				"-",
				"*",
				"/"
			]).optional(),
			right: operand.optional()
		})).optional()
	})),
	transitions: array(strictObject({
		from: array(string()),
		to: array(string()),
		cond,
		isCycleEnd: boolean().optional()
	})),
	counters: array(strictObject({
		id: string(),
		name: string(),
		countOn: number(),
		target: number(),
		resetOn: number()
	})).optional(),
	data: array(strictObject({
		address: string(),
		name: string()
	})).optional()
});
var op = strictObject({
	start: string(),
	stop: string().optional(),
	estop: string().optional(),
	reset: string().optional(),
	autoManual: string().optional(),
	homeButton: string().optional(),
	homeCondition: cond.optional(),
	homeOutputs: array(string()).optional(),
	manual: array(strictObject({
		button: string(),
		output: string()
	})).optional(),
	interlocks: array(tuple([string(), string()])).optional(),
	sensorPairs: array(tuple([string(), string()])).optional(),
	faultLamp: string().optional(),
	alwaysOn: array(string()).optional(),
	alwaysWrites: array(wordWrite).optional()
});
var index = number().int().min(0);
var projectSchema = strictObject({
	/** 공정 이름 (기록용) */
	name: string().optional(),
	/** 할당표를 직접 적을 때. X·Y는 방향을 생략할 수 있고, D 주소는 방향이 필요하다 */
	tags: array(strictObject({
		address: string(),
		name: string(),
		meaning: string().default(""),
		direction: _enum(["input", "output"]).optional(),
		contact: _enum(["A", "B"]).default("A")
	})).optional(),
	/** 할당표를 파일(.xlsx, .csv)로 줄 때. 이 프로젝트 파일 기준 상대 경로 */
	tagsFile: string().optional(),
	/** tagsFile의 열 제목으로 열을 못 찾을 때: 열 종류 → 열 번호(0부터) */
	tagColumns: strictObject({
		address: index,
		name: index,
		meaning: index,
		contact: index,
		direction: index
	}).partial().optional(),
	op,
	table,
	/** 내부 디바이스 시작 번호. 생략하면 M0, T0, C0, D0, 타이머 100ms */
	devices: strictObject({
		mStart: index,
		tStart: index,
		cStart: index,
		dStart: index,
		timerTicksPerSecond: number().positive()
	}).partial().optional()
}).refine((p) => p.tags === void 0 !== (p.tagsFile === void 0), { message: "tags와 tagsFile 중 하나만 적어야 합니다" });
/** JSON 값 → 프로젝트. 형식이 틀리면 어디가 틀렸는지 알려 준다 */
function parseProject(json) {
	const result = projectSchema.safeParse(json);
	if (result.success) return {
		project: result.data,
		issues: []
	};
	return { issues: result.error.issues.map((issue) => ({
		level: "error",
		code: "format",
		message: `프로젝트 파일 형식 오류 (${issue.path.join(".") || "전체"}): ${issue.message}`
	})) };
}
/** 프로젝트에 직접 적은 할당표 → 태그 목록 (파일에서 읽은 표와 같은 검사를 거친다) */
function inlineTags(project) {
	return readTags((project.tags ?? []).map((t) => [
		t.address,
		t.name,
		t.meaning,
		t.contact,
		t.direction ?? ""
	]), {
		address: 0,
		name: 1,
		meaning: 2,
		contact: 3,
		direction: 4
	}, false);
}
/** 프로젝트 + 태그 목록 → 구조 검사 → 래더 생성 → 검증 → CSV. 오류가 있으면 CSV를 만들지 않는다 */
function build(project, tags) {
	const stepTable = project.table;
	const opConfig = project.op;
	const config = {
		...defaultDeviceConfig,
		...project.devices
	};
	const hasError = (issues) => issues.some((n) => n.level === "error");
	const thrown = (error) => error instanceof Error ? error.message : String(error);
	const issues = validateStepTable(stepTable, config);
	if (hasError(issues)) return { issues };
	let program;
	try {
		program = generate(stepTable, opConfig, tags, config);
	} catch (error) {
		return { issues: [...issues, {
			level: "error",
			code: "generate",
			message: thrown(error)
		}] };
	}
	issues.push(...verify(program, tags, opConfig));
	if (hasError(issues)) return {
		issues,
		program
	};
	const comments = [...tags.map((t) => ({
		device: t.address,
		lines: [t.name, t.meaning]
	})), ...program.comments].map((c) => {
		const { comment, truncated } = formatComment(...c.lines);
		if (truncated) issues.push({
			level: "warning",
			code: "comment-length",
			message: `코멘트가 3행×8칸을 넘어 잘렸습니다: ${c.device} "${c.lines.join(" / ")}"`
		});
		return {
			device: c.device,
			comment
		};
	});
	try {
		return {
			issues,
			program,
			files: {
				main: exportProgram(program.rungs),
				comment: exportComments(comments)
			}
		};
	} catch (error) {
		return {
			issues: [...issues, {
				level: "error",
				code: "export",
				message: thrown(error)
			}],
			program
		};
	}
}
// src/core/report.ts
var checks = [
	{
		code: "format",
		stage: 0,
		group: "프로젝트 파일",
		name: "파일 형식",
		rule: "정해진 항목만 있고 빠진 값이 없다"
	},
	{
		code: "tag-address",
		stage: 1,
		group: "할당표",
		name: "주소 형식",
		rule: "X·Y + 16진수, 워드의 비트(D0.F), 워드(D144) 형식이다"
	},
	{
		code: "tag-duplicate",
		stage: 1,
		group: "할당표",
		name: "주소 중복",
		rule: "같은 주소가 두 번 나오지 않는다"
	},
	{
		code: "tag-field",
		stage: 1,
		group: "할당표",
		name: "이름·접점·방향",
		rule: "이름이 있고, 접점은 A 또는 B, D 주소는 입력·출력 방향이 있다"
	},
	{
		code: "step-ref",
		stage: 2,
		group: "단계 표",
		name: "단계·타이머·카운터 참조",
		rule: "없는 단계, 타이머, 카운터를 가리키지 않는다"
	},
	{
		code: "step-value",
		stage: 2,
		group: "단계 표",
		name: "시간·횟수·상수 값",
		rule: "시간과 횟수는 0보다 크고, 상수는 16비트 범위이며, 0으로 나누지 않는다"
	},
	{
		code: "word",
		stage: 2,
		group: "단계 표",
		name: "계산용 워드",
		rule: "선언한 워드만 쓰고, 이상 번호나 덮어쓰이는 워드와 겹치지 않는다"
	},
	{
		code: "unreachable",
		stage: 3,
		group: "단계 표",
		name: "도달 불가 단계",
		rule: "모든 단계에 갈 수 있다"
	},
	{
		code: "parallel-join",
		stage: 3,
		group: "단계 표",
		name: "병렬 분기 합류",
		rule: "병렬 분기는 합류하고, 진행 중인 단계를 다시 켜지 않는다"
	},
	{
		code: "generate",
		stage: 4,
		group: "래더",
		name: "래더 생성",
		rule: "단계 표와 운전 설정으로 래더가 만들어진다"
	},
	{
		code: "io-known",
		stage: 5,
		group: "래더",
		name: "할당표 밖 주소",
		rule: "래더에 쓰인 모든 I/O 주소가 할당표에 있다"
	},
	{
		code: "input-write",
		stage: 5,
		group: "래더",
		name: "입력 주소 쓰기",
		rule: "입력 주소에 값을 쓰는 명령이 없다"
	},
	{
		code: "double-coil",
		stage: 5,
		group: "래더",
		name: "이중 코일",
		rule: "출력 코일은 디바이스당 한 번만 나온다"
	},
	{
		code: "interlock",
		stage: 5,
		group: "래더",
		name: "인터록",
		rule: "인터록 쌍의 출력 렁에 상대 출력의 B접점이 있다"
	},
	{
		code: "device-overlap",
		stage: 5,
		group: "래더",
		name: "내부 디바이스 겹침",
		rule: "자동 할당한 디바이스가 할당표 주소와 겹치지 않는다"
	},
	{
		code: "unused-output",
		stage: 5,
		group: "래더",
		name: "미사용 출력",
		rule: "할당표의 출력을 래더에서 모두 쓴다 (안 쓰면 경고)"
	},
	{
		code: "export",
		stage: 6,
		group: "내보내기",
		name: "명령 형식",
		rule: "GX Works2에서 내보낸 샘플로 확인한 명령만 쓴다"
	},
	{
		code: "comment-length",
		stage: 6,
		group: "내보내기",
		name: "코멘트 길이",
		rule: "디바이스 코멘트가 3행×8칸 안에 들어간다 (넘으면 잘라내고 경고)"
	}
];
/** 검사 항목별 판정. 앞 단계에 오류가 있으면 뒤 단계 항목은 미실시 */
function judge(issues) {
	const stageOf = new Map(checks.map((c) => [c.code, c.stage]));
	const errorStages = issues.filter((n) => n.level === "error").map((n) => stageOf.get(n.code));
	const firstFailed = errorStages.length > 0 ? Math.min(...errorStages) : Infinity;
	return checks.map((check) => {
		const found = issues.filter((n) => n.code === check.code);
		return {
			check,
			verdict: check.stage > firstFailed ? "미실시" : found.some((n) => n.level === "error") ? "불합격" : found.length > 0 ? "경고" : "합격",
			found
		};
	});
}
var esc = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** 사람이 해야 하는 확인. 자동 검사로는 알 수 없는 것 */
var manualChecks = [
	"GX Works2에서 프로그램 CSV를 읽고 변환했을 때 오류가 0건이다",
	"GX Works2에서 코멘트 CSV를 읽었을 때 디바이스 코멘트가 표시된다",
	"GX Works2 시뮬레이터에서 공정 설명대로 단계가 진행된다",
	"비상정지, 이상 정지, 수동 운전이 의도대로 동작한다 (설정한 경우)",
	"실기 투입 전에 담당자가 래더를 검토했다"
];
/** 검증 결과서 HTML */
function reportPage(input) {
	const rows = judge(input.issues);
	const errors = input.issues.filter((n) => n.level === "error").length;
	const warnings = input.issues.filter((n) => n.level === "warning").length;
	const overall = errors > 0 ? "불합격" : "합격";
	const count = (v) => rows.filter((r) => r.verdict === v).length;
	const where = (n) => n.row !== void 0 ? `[할당표 ${n.row}행] ` : n.rung !== void 0 ? `[렁 ${n.rung + 1}] ` : "";
	const number = (value) => value === void 0 ? "-" : String(value);
	const body = rows.map(({ check, verdict, found }, i) => `<tr>
<td class="num">${i + 1}</td><td class="keep">${esc(check.group)}</td><td class="keep">${esc(check.name)}</td><td>${esc(check.rule)}</td>
<td class="verdict v-${verdict}">${verdict}</td>
<td>${found.length === 0 ? verdict === "미실시" ? "앞 단계 오류로 검사하지 않음" : "위반 0건" : `${found.length}건<ul>${found.map((n) => `<li>${esc(where(n) + n.message)}</li>`).join("")}</ul>`}</td>
</tr>`).join("\n");
	const devices = (input.program?.comments ?? []).map((c) => `<tr><td class="mono">${esc(c.device)}</td><td>${esc(c.lines.join(" "))}</td></tr>`).join("\n");
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(input.name)} 래더 프로그램 검증 결과서</title>
<style>
body { margin: 0; padding: 32px; background: #FFFFFF; color: #1B2430; font: 13px/1.6 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { margin: 0 0 16px; font-size: 22px; text-align: center; }
h2 { margin: 24px 0 8px; font-size: 15px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #8A94A3; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #EEF1F5; font-weight: 700; white-space: nowrap; }
ul { margin: 4px 0 0; padding-left: 18px; }
p { margin: 0 0 8px; }
.num { text-align: center; white-space: nowrap; }
.keep { white-space: nowrap; }
.mono { font-family: Consolas, monospace; white-space: nowrap; }
.verdict { text-align: center; font-weight: 700; white-space: nowrap; }
.v-합격 { color: #1E6B34; } .v-경고 { color: #8A5A00; } .v-불합격 { color: #B42318; } .v-미실시 { color: #5B6675; }
.overall { font-size: 18px; }
.box { display: inline-block; width: 14px; height: 14px; border: 1px solid #1B2430; vertical-align: -2px; }
.note { color: #4A5565; }
@media print { body { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>래더 프로그램 검증 결과서</h1>

<table>
<tr><th>공정</th><td>${esc(input.name)}</td><th>프로젝트 파일</th><td>${esc(input.file)}</td></tr>
<tr><th>대상</th><td>미쓰비시 Q(Q03UDV), GX Works2</td><th>작성 일시</th><td>${esc(input.date)}</td></tr>
<tr><th>검사 도구</th><td>Autoladder 자동 검사</td><th>종합 판정</th><td class="verdict overall v-${overall}">${overall}</td></tr>
</table>

<h2>1. 요약</h2>
<table>
<tr><th>할당표 행</th><th>단계</th><th>단계 이동</th><th>렁</th><th>내부 디바이스</th><th>오류</th><th>경고</th></tr>
<tr><td class="num">${number(input.tags)}</td><td class="num">${number(input.steps)}</td><td class="num">${number(input.transitions)}</td><td class="num">${number(input.program?.rungs.length)}</td><td class="num">${number(input.program?.comments.length)}</td><td class="num">${errors}</td><td class="num">${warnings}</td></tr>
</table>
<p class="note">검사 항목 ${rows.length}개: 합격 ${count("합격")}, 경고 ${count("경고")}, 불합격 ${count("불합격")}, 미실시 ${count("미실시")}. 오류가 하나라도 있으면 CSV를 만들지 않습니다.</p>

<h2>2. 자동 검사 항목</h2>
<table>
<tr><th>번호</th><th>구분</th><th>검사 항목</th><th>기준</th><th>판정</th><th>내용</th></tr>
${body}
</table>

<h2>3. 사람이 확인할 항목</h2>
<p class="note">자동 검사는 래더가 할당표·단계 표와 어긋나지 않는지만 봅니다. 아래는 GX Works2와 설비에서 직접 확인해야 합니다.</p>
<table>
<tr><th>번호</th><th>확인 항목</th><th>확인</th><th>확인자</th><th>일자</th></tr>
${manualChecks.map((m, i) => `<tr><td class="num">${i + 1}</td><td>${esc(m)}</td><td class="num"><span class="box"></span></td><td></td><td></td></tr>`).join("\n")}
</table>
${devices ? `
<h2>4. 자동 할당한 내부 디바이스</h2>
<table>
<tr><th>디바이스</th><th>쓰임</th></tr>
${devices}
</table>` : ""}
</main>
</body>
</html>
`;
}
// node_modules/worker-f/lib/stringifyFunctionReferences.js
var JAVASCRIPT_VARIABLE_NAME_REG_EXP = /^[$_\u0080-\uFFFFa-zA-Z][$_\u0080-\uFFFF\w]*$/;
/**
* In a given list of dependencies, it stringifies any functions to their javascript source code strings.
* It could've used simple `.toString()` if it wasn't for "minification" process which eventually renames
* all functions to random shortened names. Why do function names matter? Because the worker will have to
* call those functions by name rather than by reference, because a worker can't share any runtime code
* with the parent thread, hence the stringification to javascript source code.
*
* Alternatively, the code that is executed inside a worker could abstain from using global function references
* and instead reference any functions from some kind of a `context` object. In that case, minifiers
* won't touch the property names in that `context` object. The "pros" would be not having to use this "magic" function.
* The "cons" would be having to prepend the `context.` prefix to every function being called,
* and if any of those functions happen to call another functions, those would have to be called
* from the `context` too, which could quickly turn the code into a context-passing "spaghetti" mess.
* Not to mention having to define the `Context` type in case of TypeScript.
* But otherwise, both approaches would work and there's no other difference between them.
*
* @param {function} getDependencies — Returns an array of dependencies. This function must adhere to a strict form: it has to be a "closure" that returns an array of named variables. The restriction is because the exact variable names have to be known from the stringified form of this function.
* @returns {object} — An object of shape: `{ functions, values }` where `functions` contains the source code of any functions by their actual name, and `values` contains any "regular values" — strings, numbers, objects, arrays, etc — in their original (non-stringified) form.
*/
function stringifyFunctionReferences(getDependencies) {
	const functions = {};
	const variables = {};
	const references = getDependencies();
	const getReferencesSourceCode = getDependencies.toString();
	const referencedNames = getReferencesSourceCode.slice(getReferencesSourceCode.indexOf("[") + 1, getReferencesSourceCode.lastIndexOf("]")).split(",").map((_) => _.trim());
	for (const name of referencedNames) if (!JAVASCRIPT_VARIABLE_NAME_REG_EXP.test(name)) throw new Error(`Invalid dependency name: ${name}`);
	let i = 0;
	while (i < references.length) {
		let name = referencedNames[i];
		let value = references[i];
		if (typeof value === "function") functions[name] = getFunctionSourceCode(value, name);
		else variables[name] = value;
		i++;
	}
	return {
		functions,
		variables
	};
}
/**
* Returns the source code for a function or a class.
*
* For non-"native" classes, the end result will depend on the name of the class,
* which should be passed as a second argument for that reason. Specifically,
* the name of the class will be used when defining its `prototype` properties.
*
* "Native" functions or classes will be stringified to their "native" global name.
* For example, a reference to `ArrayBuffer` will be stringified as `"ArrayBuffer"`.
*
* @param {function} func
* @param {string} name
* @returns {string}
*/
function getFunctionSourceCode(func, name) {
	const funcSourceCode = func.toString();
	if (func.prototype) {
		if (funcSourceCode.indexOf("[native code]") >= 0) {
			const funcNameStartsAt = funcSourceCode.indexOf(" ", 8) + 1;
			const funcNameEndsBefore = funcSourceCode.indexOf("(", funcNameStartsAt);
			return funcSourceCode.slice(funcNameStartsAt, funcNameEndsBefore);
		} else {
			let code = funcSourceCode;
			for (const key in func.prototype) code += ";" + name + ".prototype." + key + "=" + func.prototype[key].toString();
			return code;
		}
	} else return funcSourceCode;
}
// node_modules/worker-f/lib/createWorker.js
/**
* Creates a worker.
*
* @example
* ```js
* // When running in a web browser.
* import createWorkerInBrowser from './createWorkerInBrowser.ts'
*
* // Create a worker.
* const workerFn = createWorkerFn(
* 	// Creates a worker in a given environment.
* 	createWorkerInBrowser,
*
* 	// (optional) Filters `transferList` argument.
* 	undefined,
*
* 	// Any "outside" dependencies that're referenced in the function (below).
* 	[() => [outsideVar1, outsideVar2, func1, func2]],
*
* 	// Returns a function in the worker that processes input data.
* 	(respond) => {
*  	return (data) => {
* 			// Process the data (perform some kind of calculation).
* 			const result = processData(data)
* 			// Post the result of the calculation back to the main thread.
* 			respond(result) // (optional) add `transferList` argument.
* 		}
*  },
*
* 	// A function in the main thread that will be called every time
* 	// when the worker has finished processing the data
* 	// (or threw an error while doing that).
* 	(error, result) => {
* 		if (error) {
* 			workerFn.stop()
* 			throw error
* 		}
* 		// If no more data will be passed to the worker, it should be terminated.
* 		workerFn.stop()
* 		console.log(result)
* 	}
* )
*
* workerFn.start()
*
* // Post a message with some data to the worker
* // so that it starts processing the data
* // and later posts a message back to the main thread
* // with the result of the calculation.
* workerFn.input(inputData) // (optional) add `transferList` argument.
* ```
*
* @param {function} createWorkerInEnvironment — Creates a worker in a given environment. The worker must call globally-available `onMessage(data)` function every time it receives a message, and it must define a `var postMessage = (data) => void` function that posts a message to the parent (main) thread.
* @param {function} createInputHandler — A "creator" that creates a function that will be called with message data every time a message is sent to this worker. The "creator" function receives a single argument — a function that posts data back to the main thread, with two arguments: `outputData` and (optional) `transferList`.
* @param {function} onError — This function will be called every time when there was an error while processing an incoming message. It would be logical to call `worker.terminate()` inside this function.
* @param {function} onOutput — This function will be called every time when done processing an incoming message.
* @param {function} getFromCache — Could be used to add caching. Has no arguments. Returns the cached value.
* @param {function} setInCache — Could be used to add caching. Receives the value to cache as an argument. Doesn't return anything.
* @returns {Worker} — An object with methods: `start(getDependenciesFunctionOrArrayOfGetDependenciesFunctions)`, `stop()`, `input(data, [transferList])`. Calling `stop()` requests termination of the worker. Calling `stop()` multiple times is safe and will not throw any errors.
*/
function createWorker(createWorkerInEnvironment, createInputHandler, onError, onOutput, getFromCache, setInCache) {
	let started = false;
	let worker;
	const stop = () => {
		worker.stop();
	};
	const ingest = (data, transferList) => {
		try {
			worker.ingest(data, transferList);
		} catch (error) {
			stop();
			throw error;
		}
	};
	const start = (arrayOfGetDependenciesFunctions, dependenciesTransferList) => {
		if (started) throw new Error("Was started");
		started = true;
		let codeAndVars = getFromCache();
		if (!codeAndVars) {
			codeAndVars = getCodeAndVars(createInputHandler, arrayOfGetDependenciesFunctions);
			setInCache(codeAndVars);
		}
		const [code, vars] = codeAndVars;
		worker = createWorkerInEnvironment(code, onError, onOutput);
		if (vars) ingest(vars, dependenciesTransferList);
	};
	return {
		start,
		stop,
		ingest
	};
}
var JAVASCRIPT_CODE_AFTER_CREATE_INPUT_HANDLER_FUNCTION = ")(postMessage)}";
function getCodeAndVars(createInputHandler, arrayOfGetDependenciesFunctions) {
	const [functionDefinitions, vars] = createFunctionsCodeAndVars(arrayOfGetDependenciesFunctions);
	return [functionDefinitions + ";var onMessage = function(data) {for (var key in data) {self[key] = data[key]}onMessage = (" + createInputHandler.toString() + JAVASCRIPT_CODE_AFTER_CREATE_INPUT_HANDLER_FUNCTION, vars];
}
function createFunctionsCodeAndVars(arrayOfGetDependenciesFunctions) {
	let funcs = {};
	let vars = {};
	for (const getDependencies of arrayOfGetDependenciesFunctions) {
		const { functions, variables } = stringifyFunctionReferences(getDependencies);
		funcs = Object.assign(Object.assign({}, funcs), functions);
		vars = Object.assign(Object.assign({}, vars), variables);
	}
	return [Object.keys(funcs).map((functionName) => {
		return functionName + "=" + funcs[functionName];
	}).join(";"), vars];
}
// node_modules/worker-f/lib/createWorkerFunctionOrStream.js
function createWorkerFunctionOrStream(createWorkerInEnvironment, fnOrAlias, createMethods, createInputHandler, handleError, handleOutput) {
	let started = false;
	let stopped = false;
	let getDependenciesFunctions = [];
	const dependenciesTransferList = void 0;
	let inputTransferList = () => [];
	let outputTransferList = () => [];
	let alias = void 0;
	let cacheValue = void 0;
	const getFromCache = (cacheKey) => {
		return CACHE[cacheKey];
	};
	const setInCache = (cacheKey, value) => {
		CACHE[cacheKey] = value;
	};
	const mustHaveStarted = () => {
		if (!started) throw new Error("Not started");
	};
	const mustNotHaveStarted = () => {
		if (started) throw new Error("Was started");
	};
	const mustNotHaveStopped = () => {
		if (stopped) throw new Error("Was stopped");
	};
	const mustNotHaveAlias = () => {
		if (alias) throw new Error("Has alias");
	};
	const argumentMustBeFunction = (arg) => {
		if (typeof arg !== "function") throw new TypeError("Argument must be a function");
	};
	let fn;
	if (typeof fnOrAlias === "string") {
		alias = fnOrAlias;
		cacheValue = getFromCache(alias);
		if (!cacheValue || !cacheValue.$) throw new Error("Not found");
		fn = cacheValue.$[0];
		getDependenciesFunctions = cacheValue.$[1];
		inputTransferList = cacheValue.$[2];
		outputTransferList = cacheValue.$[3];
		cacheValue.$[4];
	} else fn = fnOrAlias;
	argumentMustBeFunction(fn);
	let worker;
	/**
	* Adds external dependencies.
	* These dependencies must not change after the function is started.
	*
	* @param {function} getDependencies — A "closure" function that returns an array of dependencies — global variables or functions — that will be used in this worker. If some dependencies get overlooked, the worker will throw "[name] is not defined".
	*/
	const addDependencies_ = (getDependencies) => {
		mustNotHaveStopped();
		mustNotHaveStarted();
		argumentMustBeFunction(getDependencies);
		getDependenciesFunctions.push(getDependencies);
	};
	const start = () => {
		mustNotHaveStopped();
		mustNotHaveStarted();
		const getInitialDependencies = () => [
			fn,
			outputTransferList,
			createInputHandler
		];
		addDependencies_(getInitialDependencies);
		started = true;
		worker.start(getDependenciesFunctions, dependenciesTransferList);
	};
	const stop = () => {
		stopped = true;
		worker.stop();
	};
	const sendToWorker = (inputArgs) => {
		worker.ingest([Date.now(), inputArgs], inputTransferList(...inputArgs));
	};
	let numberOrUndefined;
	const workerFn = Object.assign({
		inputLatency: numberOrUndefined,
		outputLatency: numberOrUndefined,
		/**
		* Adds external dependencies.
		* These dependencies must not change after the function is started.
		*
		* @param {function} getDependencies — A "closure" function that returns an array of dependencies — global variables or functions — that will be used in this worker. If some dependencies get overlooked, the worker will throw "[name] is not defined".
		*/
		addDependencies(getDependencies) {
			mustNotHaveAlias();
			addDependencies_(getDependencies);
		},
		inputTransferList: (fn) => {
			mustNotHaveStopped();
			mustNotHaveStarted();
			mustNotHaveAlias();
			argumentMustBeFunction(fn);
			inputTransferList = fn;
		},
		outputTransferList: (fn) => {
			mustNotHaveStopped();
			mustNotHaveStarted();
			mustNotHaveAlias();
			argumentMustBeFunction(fn);
			outputTransferList = fn;
		},
		alias(alias_) {
			mustNotHaveStopped();
			mustNotHaveStarted();
			mustNotHaveAlias();
			alias = alias_;
			setInCache(alias, { $: [
				fn,
				getDependenciesFunctions,
				inputTransferList,
				outputTransferList
			] });
		},
		start,
		stop
	}, createMethods(start, stop, started, stopped, sendToWorker, mustHaveStarted, mustNotHaveStarted, mustNotHaveStopped));
	const getOtherFromCache = () => {
		if (alias) {
			const properties = getFromCache(alias);
			if (properties) return properties.other;
		}
	};
	const setOtherInCache = (value) => {
		if (alias) setInCache(alias, Object.assign(Object.assign({}, getFromCache(alias)), { other: value }));
	};
	worker = createWorker(createWorkerInEnvironment, (sendOutput_) => {
		let inputSentTimestamp = -1;
		let inputReceivedTimestamp = -1;
		const sendOutput = (output) => {
			sendOutput_([
				inputSentTimestamp,
				inputReceivedTimestamp,
				Date.now(),
				output
			], outputTransferList(output));
		};
		const inputHandler = createInputHandler(fn, sendOutput);
		return ([inputSentAt, input]) => {
			inputSentTimestamp = inputSentAt;
			inputReceivedTimestamp = Date.now();
			return inputHandler(input);
		};
	}, (error) => {
		if (!stopped) handleError(error);
	}, ([inputSentTimestamp, inputReceivedTimestamp, outputTimestamp, output]) => {
		if (!stopped) {
			if (inputSentTimestamp !== -1) workerFn.inputLatency = inputReceivedTimestamp - inputSentTimestamp;
			workerFn.outputLatency = Date.now() - outputTimestamp;
			handleOutput(output, stop);
		}
	}, getOtherFromCache, setOtherInCache);
	return workerFn;
}
var CACHE = {};
// node_modules/worker-f/lib/createWorkerFunction.js
function createWorkerFunction(createWorkerInEnvironment, fnOrAlias) {
	let resolveCall = void 0;
	let rejectCall = void 0;
	const createMethods = (start, stop, started, stopped, sendToWorker, mustHaveStarted, mustNotHaveStarted, mustNotHaveStopped) => ({
		call(...args) {
			mustNotHaveStopped();
			mustHaveStarted();
			if (resolveCall || rejectCall) throw new Error("Previous call not finished");
			return new Promise((resolve, reject) => {
				resolveCall = resolve;
				rejectCall = reject;
				sendToWorker(args);
			});
		},
		callOnce(...args) {
			start();
			return this.call(...args).finally(stop);
		}
	});
	const createInputHandler = (fn, emit) => {
		const isPromise = (anything) => {
			return anything !== null && typeof anything === "object" && typeof anything.then === "function";
		};
		return (args) => {
			const result = fn(...args);
			if (isPromise(result)) result.then(emit);
			else emit(result);
		};
	};
	const handleError = (error) => {
		if (rejectCall) {
			rejectCall(error);
			resolveCall = void 0;
			rejectCall = void 0;
		} else throw new Error("`reject` callback not found");
	};
	const handleOutput = (output, stop) => {
		if (resolveCall) {
			resolveCall(output);
			resolveCall = void 0;
			rejectCall = void 0;
		} else throw new Error("`resolve` callback not found");
	};
	return createWorkerFunctionOrStream(createWorkerInEnvironment, fnOrAlias, createMethods, createInputHandler, handleError, handleOutput);
}
// node_modules/worker-f/lib/environment/createWorkerInNode.js
/**
* Creates a worker in Node.js.
*
* Defines a `var postMessage = (data, [transferList]) => ...` function.
* Requires a `var onMessage = (data) => ...` function to be defined.
*
* @param {string} javascriptCode
* @param {function} onError — This function will be called every time when there was an error while processing an incoming message. It would be logical to call `worker.terminate()` inside this function.
* @param {function} onOutput — This function will be called every time when done processing an incoming message.
* @returns {Worker} — An object with methods: `ingest(data, transferList)`, `stop()`.
*/
function createWorkerInNode(javascriptCode, onError, onOutput) {
	let requestedTermination = false;
	let processedError = false;
	const code = createWorkerCode(javascriptCode);
	const worker = new Worker(code, { eval: true }).on("error", (error) => {
		processedError = true;
		onError(error);
	}).on("message", (message) => {
		onOutput(message);
	}).on("exit", (exitCode) => {
		if (exitCode && !processedError && !requestedTermination) onError(/* @__PURE__ */ new Error("Exited with code " + exitCode));
	});
	const stop = () => {
		requestedTermination = true;
		Worker.prototype.terminate.call(worker);
	};
	return {
		stop,
		ingest: worker.postMessage.bind(worker)
	};
}
function createWorkerCode(javascriptCode) {
	return javascriptCode + ";" + JAVASCRIPT_CODE_ADDITIONAL;
}
var JAVASCRIPT_CODE_ADDITIONAL = "var workerThreads = require(\"worker_threads\");workerThreads.parentPort.on(\"message\", function(data) {onMessage(data)});var postMessage = function(data, transferList) {workerThreads.parentPort.postMessage(data, transferList)};self = global";
// node_modules/worker-f/lib/export/node/createWorkerFunctionInNode.js
function createWorkerFunctionInNode(fnOrAlias) {
	return createWorkerFunction(createWorkerInNode, fnOrAlias);
}
// node_modules/read-excel-file/modules/saxen/parser.js
function _typeof$11(o) {
	"@babel/helpers - typeof";
	return _typeof$11 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$11(o);
}
function Parser_(options) {
	var fromCharCode = String.fromCharCode;
	var hasOwnProperty = Object.prototype.hasOwnProperty;
	var ENTITY_PATTERN = /&#(\d+);|&#x([0-9a-f]+);|&(\w+);/gi;
	var ENTITY_MAPPING = {
		"amp": "&",
		"apos": "'",
		"gt": ">",
		"lt": "<",
		"quot": "\""
	};
	Object.keys(ENTITY_MAPPING).forEach(function(k) {
		ENTITY_MAPPING[k.toUpperCase()] = ENTITY_MAPPING[k];
	});
	function replaceEntities(_, d, x, z) {
		if (z) {
			if (hasOwnProperty.call(ENTITY_MAPPING, z)) return ENTITY_MAPPING[z];
			else return "&" + z + ";";
		}
		if (d) return fromCharCode(d);
		return fromCharCode(parseInt(x, 16));
	}
	/**
	* A basic entity decoder that can decode a minimal
	* sub-set of reserved names (&amp;) as well as
	* hex (&#xaaf;) and decimal (&#1231;) encoded characters.
	*
	* @param {string} s
	*
	* @return {string} decoded string
	*/
	function decodeEntities(s) {
		if (s.length > 3 && s.indexOf("&") !== -1) return s.replace(ENTITY_PATTERN, replaceEntities);
		return s;
	}
	var NON_WHITESPACE_OUTSIDE_ROOT_NODE = "non-whitespace outside of root node";
	function error(msg) {
		return new Error(msg);
	}
	function missingNamespaceForPrefix(prefix) {
		return "missing namespace for prefix <" + prefix + ">";
	}
	function getter(getFn) {
		return {
			"get": getFn,
			"enumerable": true
		};
	}
	function cloneNsMatrix(nsMatrix) {
		var clone = {}, key;
		for (key in nsMatrix) clone[key] = nsMatrix[key];
		return clone;
	}
	var NAME_CACHE = Symbol("nameCache");
	function uriPrefix(prefix) {
		return prefix + "$uri";
	}
	function buildNsMatrix(nsUriToPrefix) {
		var nsMatrix = {}, uri, prefix;
		for (uri in nsUriToPrefix) {
			prefix = nsUriToPrefix[uri];
			nsMatrix[prefix] = prefix;
			nsMatrix[uriPrefix(prefix)] = uri;
		}
		return nsMatrix;
	}
	function noopGetContext() {
		return {
			line: 0,
			column: 0
		};
	}
	function throwFunc(err) {
		throw err;
	}
	/**
	* Creates a new parser with the given options.
	*
	* @constructor
	*
	* @param  {!Object<string, ?>=} options
	*/
	function Parser(options) {
		if (!this) return new Parser(options);
		var proxy = options && options["proxy"];
		var onText, onOpenTag, onCloseTag, onCDATA, onError = throwFunc, onWarning, onComment, onQuestion, onAttention;
		var getContext = noopGetContext;
		/**
		* Are we currently consuming a chunked stream of XML,
		* i.e. is a `write` call in progress that may be followed
		* by more chunks?
		*
		* @type {boolean}
		*/
		var streaming = false;
		/**
		* Did we already encounter the root tag?
		*
		* Persisted across `write` calls so we can detect a missing
		* start tag once the stream ends.
		*
		* @type {boolean}
		*/
		var rootTagFound = false;
		/**
		* Not yet parsed remainder of the previously written chunk,
		* i.e. an incomplete token that awaits more input.
		*
		* @type {string}
		*/
		var leftoverXml = "";
		/**
		* Do we need to parse the current elements attributes for namespaces?
		*
		* @type {boolean}
		*/
		var maybeNS = false;
		/**
		* Do we process namespaces at all?
		*
		* @type {boolean}
		*/
		var isNamespace = false;
		/**
		* The caught error returned on parse end
		*
		* @type {Error}
		*/
		var returnError = null;
		/**
		* Should we stop parsing?
		*
		* @type {boolean}
		*/
		var parseStop = false;
		/**
		* Namespace + node state shared across (streamed) parse runs.
		*/
		var nsMatrixStack, nsMatrix, nodeStack;
		/**
		* A map of { uri: prefix } used by the parser.
		*
		* This map will ensure we can normalize prefixes during processing;
		* for each uri, only one prefix will be exposed to the handlers.
		*
		* @type {!Object<string, string>}}
		*/
		var nsUriToPrefix;
		/**
		* Handle parse error.
		*
		* @param  {string|Error} err
		*/
		function handleError(err) {
			if (!(err instanceof Error)) err = error(err);
			returnError = err;
			onError(err, getContext);
		}
		/**
		* Handle parse error.
		*
		* @param  {string|Error} err
		*/
		function handleWarning(err) {
			if (!onWarning) return;
			if (!(err instanceof Error)) err = error(err);
			onWarning(err, getContext);
		}
		/**
		* Register parse listener.
		*
		* @param  {string}   name
		* @param  {Function} cb
		*
		* @return {Parser}
		*/
		this["on"] = function(name, cb) {
			if (typeof cb !== "function") throw error("required args <name, cb>");
			switch (name) {
				case "openTag":
					onOpenTag = cb;
					break;
				case "text":
					onText = cb;
					break;
				case "closeTag":
					onCloseTag = cb;
					break;
				case "error":
					onError = cb;
					break;
				case "warn":
					onWarning = cb;
					break;
				case "cdata":
					onCDATA = cb;
					break;
				case "attention":
					onAttention = cb;
					break;
				case "question":
					onQuestion = cb;
					break;
				case "comment":
					onComment = cb;
					break;
				default: throw error("unsupported event: " + name);
			}
			return this;
		};
		/**
		* Set the namespace to prefix mapping.
		*
		* @example
		*
		* parser.ns({
		*   'http://foo': 'foo',
		*   'http://bar': 'bar'
		* });
		*
		* @param  {!Object<string, string>} nsMap
		*
		* @return {Parser}
		*/
		this["ns"] = function(nsMap) {
			if (typeof nsMap === "undefined") nsMap = {};
			if (_typeof$11(nsMap) !== "object") throw error("required args <nsMap={}>");
			var _nsUriToPrefix = {}, k;
			for (k in nsMap) _nsUriToPrefix[k] = nsMap[k];
			isNamespace = true;
			nsUriToPrefix = _nsUriToPrefix;
			return this;
		};
		/**
		* Reset the parser state before a (streamed) parse run.
		*/
		function resetState() {
			nsMatrixStack = isNamespace ? [] : null;
			nsMatrix = isNamespace ? buildNsMatrix(nsUriToPrefix) : null;
			nodeStack = [];
			getContext = noopGetContext;
			parseStop = false;
			returnError = null;
			rootTagFound = false;
			leftoverXml = "";
		}
		/**
		* Parse a complete xml string.
		*
		* @param  {string} xml
		*
		* @return {Error} returnError, if not thrown
		*/
		this["parse"] = function(xml) {
			if (typeof xml !== "string") throw error("required args <xml=string>");
			if (streaming) throw error("parse during stream; call end() first");
			resetState();
			parse(xml);
			getContext = noopGetContext;
			parseStop = false;
			return returnError;
		};
		/**
		* Write the next chunk of a streamed xml string.
		*
		* Parse events are emitted for all complete tokens; an
		* incomplete trailing token is buffered until the next
		* `write` or, ultimately, reported as an error on `end`.
		*
		* @param  {string} xml
		*
		* @return {Parser} self
		*/
		this["write"] = function(xml) {
			if (typeof xml !== "string") throw error("required args <xml=string>");
			if (!streaming) {
				resetState();
				streaming = true;
			}
			if (!returnError) leftoverXml = parse(leftoverXml + xml, true) || "";
			return this;
		};
		/**
		* Finish parsing a streamed xml string, i.e. signal that
		* no more chunks will be written.
		*
		* @return {Error} returnError, if not thrown
		*/
		this["end"] = function() {
			if (!streaming) resetState();
			streaming = false;
			if (!returnError) parse(leftoverXml);
			leftoverXml = "";
			getContext = noopGetContext;
			parseStop = false;
			return returnError;
		};
		/**
		* Stop parsing.
		*/
		this["stop"] = function() {
			parseStop = true;
		};
		/**
		* Parse string, invoking configured listeners on element.
		*
		* Namespace and node stack state is shared across (streamed)
		* invocations via the enclosing parser scope.
		*
		* Internal note: while `streaming`, an incomplete trailing token
		* is not treated as an error but returned so `write` can buffer it
		* and prepend it to the next chunk. This buffered remainder is an
		* implementation detail of the streaming buffer, not a public API;
		* outside of that case the return value is `undefined`.
		*
		* @param {string} xml
		* @param {boolean} streaming
		*
		* @return {string|undefined} buffered remainder, streaming internal use only
		*/
		function parse(xml) {
			var streaming = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
			var elNameCache = null, elNameCacheMatrix = null;
			var _nsMatrix, anonymousNsCount = 0, tagStart = false, tagEnd = false, i = 0, j = 0, x, y, q, w, v, xmlns, elementName, _elementName, elementProxy;
			var attrsString = "", attrsStart = 0, cachedAttrs;
			/**
			* Normalize a namespaced attribute name against the current
			* namespace matrix.
			*
			* @param {string} name
			* @param {string|boolean} defaultAlias
			*
			* @return {string|null} normalized name, or `null` when the prefix
			*                       has no namespace (a warning is emitted)
			*/
			function normalizeAttrName(name, defaultAlias) {
				var w = name.indexOf(":");
				if (w === -1) return name;
				var nsName = nsMatrix[name.substring(0, w)];
				if (!nsName) {
					handleWarning(missingNamespaceForPrefix(name.substring(0, w)));
					return null;
				}
				return defaultAlias === nsName ? name.substr(w + 1) : nsName + name.substr(w);
			}
			/**
			* Parse attributes on demand and returns the parsed attributes.
			*
			* Return semantics: (1) `false` on attribute parse error,
			* (2) object hash on extracted attrs.
			*
			* @return {boolean|Object}
			*/
			function getAttrs() {
				if (cachedAttrs !== null) return cachedAttrs;
				var nsUri, nsUriPrefix, defaultAlias = isNamespace && nsMatrix["xmlns"], attrList = isNamespace && maybeNS ? [] : null, i = attrsStart, s = attrsString, l = s.length, hasNewMatrix, newalias, value, alias, name, attrs = {}, seenAttrs = /* @__PURE__ */ new Set(), skipAttr, w, j;
				parseAttr: for (; i < l; i++) {
					skipAttr = false;
					w = s.charCodeAt(i);
					if (w === 32 || w < 14 && w > 8) continue;
					if (w < 65 || w > 122 || w > 90 && w < 97) {
						if (w !== 95 && w !== 58) {
							handleWarning("illegal first char attribute name");
							skipAttr = true;
						}
					}
					for (j = i + 1; j < l; j++) {
						w = s.charCodeAt(j);
						if (w > 96 && w < 123 || w > 64 && w < 91 || w > 47 && w < 59 || w === 46 || w === 45 || w === 95) continue;
						if (w === 32 || w < 14 && w > 8) {
							handleWarning("missing attribute value");
							i = j;
							continue parseAttr;
						}
						if (w === 61) break;
						handleWarning("illegal attribute name char");
						skipAttr = true;
					}
					name = s.substring(i, j);
					if (name === "xmlns:xmlns") {
						handleWarning("illegal declaration of xmlns");
						skipAttr = true;
					}
					w = s.charCodeAt(j + 1);
					if (w === 34) {
						j = s.indexOf("\"", i = j + 2);
						if (j === -1) {
							j = s.indexOf("'", i);
							if (j !== -1) {
								handleWarning("attribute value quote missmatch");
								skipAttr = true;
							}
						}
					} else if (w === 39) {
						j = s.indexOf("'", i = j + 2);
						if (j === -1) {
							j = s.indexOf("\"", i);
							if (j !== -1) {
								handleWarning("attribute value quote missmatch");
								skipAttr = true;
							}
						}
					} else {
						handleWarning("missing attribute value quotes");
						skipAttr = true;
						for (j = j + 1; j < l; j++) {
							w = s.charCodeAt(j + 1);
							if (w === 32 || w < 14 && w > 8) break;
						}
					}
					if (j === -1) {
						handleWarning("missing closing quotes");
						j = l;
						skipAttr = true;
					}
					if (!skipAttr) value = s.substring(i, j);
					i = j;
					for (; j + 1 < l; j++) {
						w = s.charCodeAt(j + 1);
						if (w === 32 || w < 14 && w > 8) break;
						if (i === j) {
							handleWarning("illegal character after attribute end");
							skipAttr = true;
						}
					}
					i = j + 1;
					if (skipAttr) continue parseAttr;
					if (seenAttrs.has(name)) {
						handleWarning("attribute <" + name + "> already defined");
						continue;
					}
					seenAttrs.add(name);
					if (!isNamespace) {
						attrs[name] = value;
						continue;
					}
					if (maybeNS) {
						newalias = name === "xmlns" ? "xmlns" : name.charCodeAt(0) === 120 && name.substr(0, 6) === "xmlns:" ? name.substr(6) : null;
						if (newalias !== null) {
							nsUri = decodeEntities(value);
							nsUriPrefix = uriPrefix(newalias);
							alias = nsUriToPrefix[nsUri];
							if (!alias) {
								if (newalias === "xmlns" || nsUriPrefix in nsMatrix && nsMatrix[nsUriPrefix] !== nsUri) do
									alias = "ns" + anonymousNsCount++;
								while (typeof nsMatrix[alias] !== "undefined");
								else alias = newalias;
								nsUriToPrefix[nsUri] = alias;
							}
							if (nsMatrix[newalias] !== alias) {
								if (!hasNewMatrix) {
									nsMatrix = cloneNsMatrix(nsMatrix);
									hasNewMatrix = true;
								}
								nsMatrix[newalias] = alias;
								if (newalias === "xmlns") {
									nsMatrix[uriPrefix(alias)] = nsUri;
									defaultAlias = alias;
								}
								nsMatrix[nsUriPrefix] = nsUri;
							}
							attrs[name] = value;
							continue;
						}
						attrList.push(name, value);
						continue;
					}
					name = normalizeAttrName(name, defaultAlias);
					if (name === null) continue;
					attrs[name] = value;
				}
				if (maybeNS) for (i = 0, l = attrList.length; i < l; i++) {
					name = normalizeAttrName(attrList[i++], defaultAlias);
					value = attrList[i];
					if (name === null) continue;
					attrs[name] = value;
				}
				return cachedAttrs = attrs;
			}
			/**
			* Extract the parse context { line, column, part }
			* from the current parser position.
			*
			* @return {Object} parse context
			*/
			function getParseContext() {
				var splitsRe = /(\r\n|\r|\n)/g;
				var line = 0;
				var column = 0;
				var startOfLine = 0;
				var endOfLine = j;
				var match;
				var data;
				while (i >= startOfLine) {
					match = splitsRe.exec(xml);
					if (!match) break;
					endOfLine = match[0].length + match.index;
					if (endOfLine > i) break;
					line += 1;
					startOfLine = endOfLine;
				}
				if (i == -1) {
					column = endOfLine;
					data = xml.substring(j);
				} else if (j === 0) data = xml.substring(j, i);
				else {
					column = i - startOfLine;
					data = j == -1 ? xml.substring(i) : xml.substring(i, j + 1);
				}
				return {
					"data": data,
					"line": line,
					"column": column
				};
			}
			getContext = getParseContext;
			if (proxy) elementProxy = Object.create({}, {
				"name": getter(function() {
					return elementName;
				}),
				"originalName": getter(function() {
					return _elementName;
				}),
				"attrs": getter(getAttrs),
				"ns": getter(function() {
					return nsMatrix;
				})
			});
			while (j !== -1) {
				if (xml.charCodeAt(j) === 60) i = j;
				else i = xml.indexOf("<", j);
				if (i === -1) {
					if (streaming) return xml.substring(j);
					if (nodeStack.length) return handleError("unexpected end of file");
					if (!rootTagFound) return handleError("missing start tag");
					if (j < xml.length) {
						if (xml.substring(j).trim()) handleWarning(NON_WHITESPACE_OUTSIDE_ROOT_NODE);
					}
					return;
				}
				if (!rootTagFound) rootTagFound = true;
				if (j !== i) {
					if (nodeStack.length) {
						if (onText) {
							onText(xml.substring(j, i), decodeEntities, getContext);
							if (parseStop) return;
						}
					} else if (xml.substring(j, i).trim()) {
						handleWarning(NON_WHITESPACE_OUTSIDE_ROOT_NODE);
						if (parseStop) return;
					}
				}
				w = xml.charCodeAt(i + 1);
				if (w === 33) {
					q = xml.charCodeAt(i + 2);
					if (q === 91 && xml.substr(i + 3, 6) === "CDATA[") {
						j = xml.indexOf("]]>", i);
						if (j === -1) {
							if (streaming) return xml.substring(i);
							return handleError("unclosed cdata");
						}
						if (onCDATA) {
							onCDATA(xml.substring(i + 9, j), getContext);
							if (parseStop) return;
						}
						j += 3;
						continue;
					}
					if (q === 45 && xml.charCodeAt(i + 3) === 45) {
						j = xml.indexOf("-->", i);
						if (j === -1) {
							if (streaming) return xml.substring(i);
							return handleError("unclosed comment");
						}
						if (onComment) {
							onComment(xml.substring(i + 4, j), decodeEntities, getContext);
							if (parseStop) return;
						}
						j += 3;
						continue;
					}
				}
				if (w === 63) {
					j = xml.indexOf("?>", i);
					if (j === -1) {
						if (streaming) return xml.substring(i);
						return handleError("unclosed question");
					}
					if (onQuestion) {
						onQuestion(xml.substring(i, j + 2), getContext);
						if (parseStop) return;
					}
					j += 2;
					continue;
				}
				for (x = i + 1;; x++) {
					v = xml.charCodeAt(x);
					if (isNaN(v)) {
						if (streaming) return xml.substring(i);
						j = -1;
						return handleError("unclosed tag");
					}
					if (v === 34) {
						q = xml.indexOf("\"", x + 1);
						x = q !== -1 ? q : x;
					} else if (v === 39) {
						q = xml.indexOf("'", x + 1);
						x = q !== -1 ? q : x;
					} else if (v === 62) {
						j = x;
						break;
					}
				}
				if (w === 33) {
					if (onAttention) {
						onAttention(xml.substring(i, j + 1), decodeEntities, getContext);
						if (parseStop) return;
					}
					j += 1;
					continue;
				}
				cachedAttrs = {};
				if (w === 47) {
					tagStart = false;
					tagEnd = true;
					if (!nodeStack.length) return handleError("missing open tag");
					x = elementName = nodeStack.pop();
					q = i + 2 + x.length;
					if (xml.substring(i + 2, q) !== x) return handleError("closing tag mismatch");
					for (; q < j; q++) {
						w = xml.charCodeAt(q);
						if (w === 32 || w > 8 && w < 14) continue;
						return handleError("close tag");
					}
				} else {
					if (xml.charCodeAt(j - 1) === 47) {
						x = elementName = xml.substring(i + 1, j - 1);
						tagStart = true;
						tagEnd = true;
					} else {
						x = elementName = xml.substring(i + 1, j);
						tagStart = true;
						tagEnd = false;
					}
					if (!(w > 96 && w < 123 || w > 64 && w < 91 || w === 95 || w === 58)) return handleError("illegal first char nodeName");
					for (q = 1, y = x.length; q < y; q++) {
						w = x.charCodeAt(q);
						if (w > 96 && w < 123 || w > 64 && w < 91 || w > 47 && w < 59 || w === 45 || w === 95 || w == 46) continue;
						if (w === 32 || w < 14 && w > 8) {
							elementName = x.substring(0, q);
							cachedAttrs = null;
							break;
						}
						return handleError("invalid nodeName");
					}
					if (!tagEnd) nodeStack.push(elementName);
				}
				if (isNamespace) {
					_nsMatrix = nsMatrix;
					if (tagStart) {
						if (!tagEnd) nsMatrixStack.push(_nsMatrix);
						if (cachedAttrs === null) {
							if (maybeNS = x.indexOf("xmlns", q) !== -1) {
								attrsStart = q;
								attrsString = x;
								getAttrs();
								maybeNS = false;
							}
						}
					}
					_elementName = elementName;
					if (elNameCacheMatrix !== nsMatrix) {
						elNameCache = nsMatrix[NAME_CACHE];
						if (elNameCache === void 0) elNameCache = nsMatrix[NAME_CACHE] = {};
						elNameCacheMatrix = nsMatrix;
					}
					var _cachedName = elNameCache[elementName];
					if (_cachedName !== void 0) elementName = _cachedName;
					else {
						w = elementName.indexOf(":");
						if (w !== -1) {
							xmlns = nsMatrix[elementName.substring(0, w)];
							if (!xmlns) return handleError("missing namespace on <" + _elementName + ">");
							elementName = elementName.substr(w + 1);
						} else xmlns = nsMatrix["xmlns"];
						if (xmlns) elementName = xmlns + ":" + elementName;
						elNameCache[_elementName] = elementName;
					}
				}
				if (tagStart) {
					attrsStart = q;
					attrsString = x;
					if (onOpenTag) {
						if (proxy) onOpenTag(elementProxy, decodeEntities, tagEnd, getContext);
						else onOpenTag(elementName, getAttrs, decodeEntities, tagEnd, getContext);
						if (parseStop) return;
					}
				}
				if (tagEnd) {
					if (onCloseTag) {
						onCloseTag(proxy ? elementProxy : elementName, decodeEntities, tagStart, getContext);
						if (parseStop) return;
					}
					if (isNamespace) {
						if (!tagStart) nsMatrix = nsMatrixStack.pop();
						else nsMatrix = _nsMatrix;
					}
				}
				j += 1;
			}
		}
	}
	return new Parser(options);
}
// node_modules/read-excel-file/modules/xml/parseXmlStream.saxen.js
/**
* Parses XML markup in a streaming fashion by calling the supplied callback functions as the XML markup is being input.
* @param {any} state — The initial `state`. This `state` will supposedly be modified by the callback functions as the XML is being parsed.
* @param {function} [onOpenTag]
* @param {function} [onCloseTag]
* @param {function} [onText]
* @returns {object} An object with properties: `promise`, `write(string)`, `end()`. The `promise` resolves with nothing.
*/
function parseXmlStream(state, onOpenTag, onCloseTag, onText) {
	var errored = false;
	var mustNotHaveErrored = function mustNotHaveErrored() {
		if (errored) throw new Error("Errored");
	};
	var resolvePromise;
	var parser = new Parser_();
	return {
		promise: new Promise(function(resolve, reject) {
			resolvePromise = resolve;
			var onerror = function onerror(error) {
				errored = true;
				throw error;
			};
			var ontext = function ontext(text, decodeEntities) {
				if (onText) onText(decodeEntities(text), state);
			};
			var onopentag = function onopentag(elementName, getAttributes, decodeEntities, selfClosing, getContext) {
				if (onOpenTag) {
					var attributes = getAttributes();
					for (var name in attributes) attributes[trimXmlnsPrefix(name, true)] = decodeEntities(attributes[name]);
					onOpenTag(trimXmlnsPrefix(elementName), attributes, state);
				}
			};
			var onclosetag = function onclosetag(elementName) {
				if (onCloseTag) onCloseTag(trimXmlnsPrefix(elementName), state);
			};
			parser.on("error", onerror);
			parser.on("text", ontext);
			parser.on("openTag", onopentag);
			parser.on("closeTag", onclosetag);
		}),
		write: function write(xml) {
			mustNotHaveErrored();
			parser.write(xml);
		},
		end: function end() {
			mustNotHaveErrored();
			parser.end();
			resolvePromise();
		}
	};
}
function trimXmlnsPrefix(string, isAttributeName) {
	var i = 0;
	while (i < string.length) {
		if (string[i] === ":") {
			if (isAttributeName && i === 5 && string.slice(0, 5) === "xmlns") {} else return string.slice(i + 1);
		}
		i++;
	}
	return string;
}
// node_modules/read-excel-file/modules/xlsx/InvalidSpreadsheetError.js
function _typeof$10(o) {
	"@babel/helpers - typeof";
	return _typeof$10 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$10(o);
}
function _defineProperties$5(target, props) {
	for (var i = 0; i < props.length; i++) {
		var descriptor = props[i];
		descriptor.enumerable = descriptor.enumerable || false;
		descriptor.configurable = true;
		if ("value" in descriptor) descriptor.writable = true;
		Object.defineProperty(target, _toPropertyKey$9(descriptor.key), descriptor);
	}
}
function _createClass$5(Constructor, protoProps, staticProps) {
	if (protoProps) _defineProperties$5(Constructor.prototype, protoProps);
	if (staticProps) _defineProperties$5(Constructor, staticProps);
	Object.defineProperty(Constructor, "prototype", { writable: false });
	return Constructor;
}
function _toPropertyKey$9(arg) {
	var key = _toPrimitive$9(arg, "string");
	return _typeof$10(key) === "symbol" ? key : String(key);
}
function _toPrimitive$9(input, hint) {
	if (_typeof$10(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$10(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _classCallCheck$5(instance, Constructor) {
	if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _inherits$5(subClass, superClass) {
	if (typeof superClass !== "function" && superClass !== null) throw new TypeError("Super expression must either be null or a function");
	subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: {
		value: subClass,
		writable: true,
		configurable: true
	} });
	Object.defineProperty(subClass, "prototype", { writable: false });
	if (superClass) _setPrototypeOf$5(subClass, superClass);
}
function _createSuper$5(Derived) {
	var hasNativeReflectConstruct = _isNativeReflectConstruct$5();
	return function _createSuperInternal() {
		var Super = _getPrototypeOf$5(Derived), result;
		if (hasNativeReflectConstruct) {
			var NewTarget = _getPrototypeOf$5(this).constructor;
			result = Reflect.construct(Super, arguments, NewTarget);
		} else result = Super.apply(this, arguments);
		return _possibleConstructorReturn$5(this, result);
	};
}
function _possibleConstructorReturn$5(self, call) {
	if (call && (_typeof$10(call) === "object" || typeof call === "function")) return call;
	else if (call !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
	return _assertThisInitialized$5(self);
}
function _assertThisInitialized$5(self) {
	if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return self;
}
function _wrapNativeSuper$4(Class) {
	var _cache = typeof Map === "function" ? /* @__PURE__ */ new Map() : void 0;
	_wrapNativeSuper$4 = function _wrapNativeSuper(Class) {
		if (Class === null || !_isNativeFunction$4(Class)) return Class;
		if (typeof Class !== "function") throw new TypeError("Super expression must either be null or a function");
		if (typeof _cache !== "undefined") {
			if (_cache.has(Class)) return _cache.get(Class);
			_cache.set(Class, Wrapper);
		}
		function Wrapper() {
			return _construct$4(Class, arguments, _getPrototypeOf$5(this).constructor);
		}
		Wrapper.prototype = Object.create(Class.prototype, { constructor: {
			value: Wrapper,
			enumerable: false,
			writable: true,
			configurable: true
		} });
		return _setPrototypeOf$5(Wrapper, Class);
	};
	return _wrapNativeSuper$4(Class);
}
function _construct$4(Parent, args, Class) {
	if (_isNativeReflectConstruct$5()) _construct$4 = Reflect.construct.bind();
	else _construct$4 = function _construct(Parent, args, Class) {
		var a = [null];
		a.push.apply(a, args);
		var instance = new (Function.bind.apply(Parent, a))();
		if (Class) _setPrototypeOf$5(instance, Class.prototype);
		return instance;
	};
	return _construct$4.apply(null, arguments);
}
function _isNativeReflectConstruct$5() {
	if (typeof Reflect === "undefined" || !Reflect.construct) return false;
	if (Reflect.construct.sham) return false;
	if (typeof Proxy === "function") return true;
	try {
		Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
		return true;
	} catch (e) {
		return false;
	}
}
function _isNativeFunction$4(fn) {
	return Function.toString.call(fn).indexOf("[native code]") !== -1;
}
function _setPrototypeOf$5(o, p) {
	_setPrototypeOf$5 = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf(o, p) {
		o.__proto__ = p;
		return o;
	};
	return _setPrototypeOf$5(o, p);
}
function _getPrototypeOf$5(o) {
	_getPrototypeOf$5 = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf(o) {
		return o.__proto__ || Object.getPrototypeOf(o);
	};
	return _getPrototypeOf$5(o);
}
var InvalidSpreadsheetError = /*#__PURE__*/ function(_Error) {
	_inherits$5(InvalidSpreadsheetError, _Error);
	var _super = _createSuper$5(InvalidSpreadsheetError);
	function InvalidSpreadsheetError(message) {
		var _this;
		_classCallCheck$5(this, InvalidSpreadsheetError);
		_this = _super.call(this, message);
		_this.name = "InvalidSpreadsheetError";
		return _this;
	}
	return _createClass$5(InvalidSpreadsheetError);
}(/*#__PURE__*/ _wrapNativeSuper$4(Error));
// node_modules/read-excel-file/modules/xml/parseXml.js
/**
* Parses XML markup by calling the supplied callback functions.
* @param {string} xml
* @param {any} state — The initial `state`. This `state` will supposedly be modified by the callback functions as the XML is being parsed.
* @param {function} [onOpenTag]
* @param {function} [onCloseTag]
* @param {function} [onText]
* @param {function} [onProgress] — If defined, will be called every time it finishes parsing yet another chunk of XML.
* @returns {Promise<void>} Returns a `Promise` that resolves to nothing. Inspect the passed `state` argument for changes.
*/
function parseXml(xml, state, onOpenTag, onCloseTag, onText, onProgress) {
	var parser = parseXmlStream(state, onOpenTag, onCloseTag, onText);
	if (onProgress) parseXmlInChunks(parser, xml, onProgress);
	else {
		parser.write(xml);
		parser.end();
	}
	return parser.promise.then(function(result) {
		return result;
	}, function(error) {
		var spreadsheetError = new InvalidSpreadsheetError(error.message);
		spreadsheetError.stack = error.stack;
		spreadsheetError.cause = error;
		throw spreadsheetError;
	});
	/**
	* Parses XML in chunks.
	* @param {object} parser — An object returned from `parseXmlStream()` function.
	* @param {string} xml
	* @param {function} [onProgress] — Will be called after yet another chunk of XML has been parsed.
	* @param {boolean} [nonBlocking] — If `true` is passed then it won't block the current thread while parsing. Otherwise, it will block the current thread until all the XML is parsed.
	*/
	function parseXmlInChunks(parser, xml, onProgress, nonBlocking) {
		var MAX_CHUNK_PROCESSING_TIME = 7;
		var INITIAL_CHUNK_SIZE = 65536;
		var chunksCount = 0;
		var chunkSize = INITIAL_CHUNK_SIZE;
		/**
		* Parses next chunk of XML.
		* @returns {boolean} Returns `true` if there're more chunks to write.
		*/
		var parseNextChunk = function parseNextChunk() {
			chunksCount++;
			var startedAt = Date.now();
			if (xml.length > chunkSize) {
				parser.write(xml.slice(0, chunkSize));
				if (onProgress) onProgress(false);
				xml = xml.slice(chunkSize);
				var chunkProcessingTime = Date.now() - startedAt;
				if (chunkProcessingTime < MAX_CHUNK_PROCESSING_TIME * .5) chunkSize *= 2;
				else if (chunkProcessingTime > MAX_CHUNK_PROCESSING_TIME) chunkSize /= 2;
				return true;
			} else {
				parser.write(xml);
				parser.end();
				if (onProgress) onProgress(true);
				return false;
			}
		};
		(function loop() {
			if (parseNextChunk()) {
				if (nonBlocking) {
					if (typeof setImmediate !== "undefined") setImmediate(loop);
					else setTimeout(loop, 0);
				} else loop();
			}
		})();
	}
}
// node_modules/unzipper-esm/lib/ZipFileError.js
var ZipFileError = class extends Error {
	constructor(code, message) {
		super(message || code);
		this.code = code;
	}
};
function createZipFileError(error) {
	const zipFileError = new ZipFileError(error.code, error.message);
	if (error.stack) zipFileError.stack = error.stack;
	Error.captureStackTrace(zipFileError, createZipFileError);
	zipFileError.cause = error;
	return zipFileError;
}
// node_modules/unzipper-esm/lib/PullStream.js
var FUNCTION_STRING = "function";
var PullStreamConstructor = function() {
	this.buffer = Buffer.from("");
	const self = this;
	self.on("finish", function() {
		self.finished = true;
		self.emit("chunk", false);
	});
};
var _write = function(chunk, e, cb) {
	this.buffer = Buffer.concat([this.buffer, chunk]);
	this.cb = cb;
	this.emit("chunk");
};
var stream = function(eof, includeEof) {
	const p = new PassThrough();
	let done;
	const self = this;
	function cb() {
		if (typeof self.cb === FUNCTION_STRING) {
			const callback = self.cb;
			self.cb = void 0;
			return callback();
		}
	}
	function pull() {
		let packet;
		if (self.buffer && self.buffer.length) {
			if (typeof eof === "number") {
				packet = self.buffer.slice(0, eof);
				self.buffer = self.buffer.slice(eof);
				eof -= packet.length;
				done = done || !eof;
			} else {
				let match = self.buffer.indexOf(eof);
				if (match !== -1) {
					self.match = match;
					if (includeEof) match = match + eof.length;
					packet = self.buffer.slice(0, match);
					self.buffer = self.buffer.slice(match);
					done = true;
				} else {
					const len = self.buffer.length - eof.length;
					if (len <= 0) cb();
					else {
						packet = self.buffer.slice(0, len);
						self.buffer = self.buffer.slice(len);
					}
				}
			}
			if (packet) p.write(packet, function() {
				if (self.buffer.length === 0 || eof.length && self.buffer.length <= eof.length) cb();
			});
		}
		if (!done) {
			if (self.finished) {
				self.removeListener("chunk", pull);
				self.emit("error", new ZipFileError("FILE_ENDED"));
				return;
			}
		} else {
			self.removeListener("chunk", pull);
			p.end();
		}
	}
	self.on("chunk", pull);
	pull();
	return p;
};
var pull = function(eof, includeEof) {
	if (eof === 0) return Promise.resolve("");
	if (!isNaN(eof) && this.buffer.length > eof) {
		const data = this.buffer.slice(0, eof);
		this.buffer = this.buffer.slice(eof);
		return Promise.resolve(data);
	}
	let buffer = Buffer.from("");
	const self = this;
	const concatStream = new Transform({ transform });
	function transform(d, e, cb) {
		buffer = Buffer.concat([buffer, d]);
		cb();
	}
	let rejectHandler;
	let pullStreamRejectHandler;
	return new Promise(function(resolve, reject) {
		rejectHandler = reject;
		pullStreamRejectHandler = function(e) {
			self.__emittedError = e;
			reject(e);
		};
		if (self.finished) return reject(new ZipFileError("FILE_ENDED"));
		self.once("error", pullStreamRejectHandler);
		self.stream(eof, includeEof).on("error", reject).pipe(concatStream).on("finish", function() {
			resolve(buffer);
		}).on("error", reject);
	}).finally(function() {
		self.removeListener("error", rejectHandler);
		self.removeListener("error", pullStreamRejectHandler);
	});
};
var PullStream = class extends Duplex {
	constructor() {
		super({
			decodeStrings: false,
			objectMode: true
		});
		PullStreamConstructor.call(this);
	}
	_write(chunk, e, cb) {
		return _write.call(this, chunk, e, cb);
	}
	stream(eof, includeEof) {
		return stream.call(this, eof, includeEof);
	}
	pull(eof, includeEof) {
		return pull.call(this, eof, includeEof);
	}
	_read() {}
};
// node_modules/unzipper-esm/lib/NoopStream.js
var NoopStream = class extends Transform {
	_transform(d, e, cb) {
		cb();
	}
};
// node_modules/unzipper-esm/lib/BufferStream.js
/**
* Reads an entry as a `Buffer`.
* @param {*} entry
* @returns {Promise<Buffer>}
*/
function readAsBuffer(entry) {
	return new Promise(function(resolve, reject) {
		const chunks = [];
		const bufferStream = new Transform({ transform }).on("finish", function() {
			resolve(Buffer.concat(chunks));
		}).on("error", reject);
		function transform(d, e, cb) {
			chunks.push(d);
			cb();
		}
		entry.on("error", reject).pipe(bufferStream);
	});
}
// node_modules/unzipper-esm/lib/parseBuffer.js
function parseUIntLE(buffer, offset, size) {
	let result;
	switch (size) {
		case 1:
			result = buffer.readUInt8(offset);
			break;
		case 2:
			result = buffer.readUInt16LE(offset);
			break;
		case 4:
			result = buffer.readUInt32LE(offset);
			break;
		case 8:
			result = Number(buffer.readBigUInt64LE(offset));
			break;
		default: throw new Error("Unsupported UInt LE size!");
	}
	return result;
}
/**
* Parses sequential unsigned little endian numbers from the head of the passed buffer according to
* the specified format passed.  If the buffer is not large enough to satisfy the full format,
* null values will be assigned to the remaining keys.
* @param {*} buffer The buffer to sequentially extract numbers from.
* @param {*} format Expected format to follow when extrcting values from the buffer.  A list of list entries
* with the following structure:
* [
*   [
*     <key>,  // Name of the key to assign the extracted number to.
*     <size>  // The size in bytes of the number to extract. possible values are 1, 2, 4, 8.
*   ],
*   ...
* ]
* @returns An object with keys set to their associated extracted values.
*/
function parse(buffer, format) {
	const result = {};
	let offset = 0;
	for (const [key, size] of format) {
		if (buffer.length >= offset + size) result[key] = parseUIntLE(buffer, offset, size);
		else result[key] = null;
		offset += size;
	}
	return result;
}
// node_modules/unzipper-esm/lib/parseExtraField.js
function parseExtraField(extraField, vars) {
	let extra;
	while (!extra && extraField && extraField.length) {
		const candidateExtra = parse(extraField, [["signature", 2], ["partSize", 2]]);
		if (candidateExtra.signature === 1) {
			const fieldsToExpect = [];
			if (vars.uncompressedSize === 4294967295) fieldsToExpect.push(["uncompressedSize", 8]);
			if (vars.compressedSize === 4294967295) fieldsToExpect.push(["compressedSize", 8]);
			if (vars.offsetToLocalFileHeader === 4294967295) fieldsToExpect.push(["offsetToLocalFileHeader", 8]);
			extra = parse(extraField.slice(4), fieldsToExpect);
		} else extraField = extraField.slice(candidateExtra.partSize + 4);
	}
	extra = extra || {};
	if (vars.compressedSize === 4294967295) vars.compressedSize = extra.compressedSize;
	if (vars.uncompressedSize === 4294967295) vars.uncompressedSize = extra.uncompressedSize;
	if (vars.offsetToLocalFileHeader === 4294967295) vars.offsetToLocalFileHeader = extra.offsetToLocalFileHeader;
	return extra;
}
// node_modules/unzipper-esm/lib/parseDateTime.js
function parseDateTime(date, time) {
	const day = date & 31;
	const month = date >> 5 & 15;
	const year = (date >> 9 & 127) + 1980;
	const seconds = time ? (time & 31) * 2 : 0;
	const minutes = time ? time >> 5 & 63 : 0;
	const hours = time ? time >> 11 : 0;
	return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}
// node_modules/unzipper-esm/lib/parse.js
var endDirectorySignature = Buffer.alloc(4);
endDirectorySignature.writeUInt32LE(101010256, 0);
function Parse(opts) {
	return new Parser(opts);
}
var ParserConstructor = function(opts) {
	this._opts = opts;
	const self = this;
	self.on("finish", function() {
		self.emit("end");
		self.emit("close");
	});
	self._readRecord().catch(function(e) {
		if (!self.__emittedError || self.__emittedError !== e) self.emit("error", e);
	});
};
var _readRecord = function() {
	const self = this;
	return self.pull(4).then(function(data) {
		if (data.length === 0) return;
		const signature = data.readUInt32LE(0);
		if (signature === 875721283) return self._readCrxHeader();
		if (signature === 67324752) return self._readFile();
		else if (signature === 33639248) {
			self.reachedCD = true;
			return self._readCentralDirectoryFileHeader();
		} else if (signature === 101010256) return self._readEndOfCentralDirectoryRecord();
		else if (self.reachedCD) return self.pull(endDirectorySignature, true).then(function() {
			return self._readEndOfCentralDirectoryRecord();
		});
		else self.emit("error", new ZipFileError("INVALID_SIGNATURE", "invalid signature: 0x" + signature.toString(16)));
	}).then((function(loop) {
		if (loop) return self._readRecord();
	}));
};
var _readCrxHeader = function() {
	const self = this;
	return self.pull(12).then(function(data) {
		self.crxHeader = parse(data, [
			["version", 4],
			["pubKeyLength", 4],
			["signatureLength", 4]
		]);
		return self.pull(self.crxHeader.pubKeyLength + self.crxHeader.signatureLength);
	}).then(function(data) {
		self.crxHeader.publicKey = data.slice(0, self.crxHeader.pubKeyLength);
		self.crxHeader.signature = data.slice(self.crxHeader.pubKeyLength);
		self.emit("crx-header", self.crxHeader);
		return true;
	});
};
var _readFile = function() {
	const self = this;
	return self.pull(26).then(function(data) {
		const vars = parse(data, [
			["versionsNeededToExtract", 2],
			["flags", 2],
			["compressionMethod", 2],
			["lastModifiedTime", 2],
			["lastModifiedDate", 2],
			["crc32", 4],
			["compressedSize", 4],
			["uncompressedSize", 4],
			["fileNameLength", 2],
			["extraFieldLength", 2]
		]);
		vars.lastModifiedDateTime = parseDateTime(vars.lastModifiedDate, vars.lastModifiedTime);
		if (self.crxHeader) vars.crxHeader = self.crxHeader;
		return self.pull(vars.fileNameLength).then(function(fileNameBuffer) {
			const fileName = fileNameBuffer.toString("utf8");
			const entry = new PassThrough();
			let __autodraining = false;
			entry.autodrain = function() {
				__autodraining = true;
				const draining = entry.pipe(new NoopStream());
				draining.promise = function() {
					return new Promise(function(resolve, reject) {
						draining.on("finish", resolve);
						draining.on("error", reject);
					});
				};
				return draining;
			};
			entry.buffer = function() {
				return readAsBuffer(entry);
			};
			entry.path = fileName;
			entry.props = {};
			entry.props.path = fileName;
			entry.props.pathBuffer = fileNameBuffer;
			entry.props.flags = { "isUnicode": (vars.flags & 2048) != 0 };
			entry.type = vars.uncompressedSize === 0 && /[/\\]$/.test(fileName) ? "Directory" : "File";
			if (self._opts.verbose) {
				if (entry.type === "Directory") console.log("   creating:", fileName);
				else if (entry.type === "File") {
					if (vars.compressionMethod === 0) console.log(" extracting:", fileName);
					else console.log("  inflating:", fileName);
				}
			}
			return self.pull(vars.extraFieldLength).then(function(extraField) {
				const extra = parseExtraField(extraField, vars);
				entry.vars = vars;
				entry.extra = extra;
				if (self._opts.forceStream) self.push(entry);
				else {
					self.emit("entry", entry);
					if (self._readableState.pipesCount || self._readableState.pipes && self._readableState.pipes.length) self.push(entry);
				}
				if (self._opts.verbose) console.log({
					filename: fileName,
					vars,
					extra
				});
				const fileSizeKnown = !(vars.flags & 8) || vars.compressedSize > 0;
				let eof;
				entry.__autodraining = __autodraining;
				const inflater = vars.compressionMethod && !__autodraining ? zlib.createInflateRaw() : PassThrough();
				if (fileSizeKnown) {
					entry.size = vars.uncompressedSize;
					eof = vars.compressedSize;
				} else {
					eof = Buffer.alloc(4);
					eof.writeUInt32LE(134695760, 0);
				}
				return new Promise(function(resolve, reject) {
					pipeline(self.stream(eof), inflater, entry, function(err) {
						if (err) {
							if (err.code === "Z_DATA_ERROR") err = createZipFileError(err);
							return reject(err);
						}
						return fileSizeKnown ? resolve(fileSizeKnown) : self._processDataDescriptor(entry).then(resolve).catch(reject);
					});
				});
			});
		});
	});
};
var _processDataDescriptor = function(entry) {
	return this.pull(16).then(function(data) {
		entry.size = parse(data, [
			["dataDescriptorSignature", 4],
			["crc32", 4],
			["compressedSize", 4],
			["uncompressedSize", 4]
		]).uncompressedSize;
		return true;
	});
};
var _readCentralDirectoryFileHeader = function() {
	const self = this;
	return self.pull(42).then(function(data) {
		const vars = parse(data, [
			["versionMadeBy", 2],
			["versionsNeededToExtract", 2],
			["flags", 2],
			["compressionMethod", 2],
			["lastModifiedTime", 2],
			["lastModifiedDate", 2],
			["crc32", 4],
			["compressedSize", 4],
			["uncompressedSize", 4],
			["fileNameLength", 2],
			["extraFieldLength", 2],
			["fileCommentLength", 2],
			["diskNumber", 2],
			["internalFileAttributes", 2],
			["externalFileAttributes", 4],
			["offsetToLocalFileHeader", 4]
		]);
		return self.pull(vars.fileNameLength).then(function(fileName) {
			vars.fileName = fileName.toString("utf8");
			return self.pull(vars.extraFieldLength);
		}).then(function() {
			return self.pull(vars.fileCommentLength);
		}).then(function() {
			return true;
		});
	});
};
var _readEndOfCentralDirectoryRecord = function() {
	const self = this;
	return self.pull(18).then(function(data) {
		const vars = parse(data, [
			["diskNumber", 2],
			["diskStart", 2],
			["numberOfRecordsOnDisk", 2],
			["numberOfRecords", 2],
			["sizeOfCentralDirectory", 4],
			["offsetToStartOfCentralDirectory", 4],
			["commentLength", 2]
		]);
		return self.pull(vars.commentLength).then(function() {
			self.end();
			self.push(null);
		});
	});
};
var promise = function() {
	const self = this;
	return new Promise(function(resolve, reject) {
		self.on("finish", resolve);
		self.on("error", reject);
	});
};
var Parser = class extends PullStream {
	constructor(opts = { verbose: false }) {
		super(opts);
		ParserConstructor.call(this, opts);
	}
	_readRecord() {
		return _readRecord.call(this);
	}
	_readCrxHeader() {
		return _readCrxHeader.call(this);
	}
	_readFile() {
		return _readFile.call(this);
	}
	_processDataDescriptor(entry) {
		return _processDataDescriptor.call(this, entry);
	}
	_readCentralDirectoryFileHeader() {
		return _readCentralDirectoryFileHeader.call(this);
	}
	_readEndOfCentralDirectoryRecord() {
		return _readEndOfCentralDirectoryRecord.call(this);
	}
	promise() {
		return promise.call(this);
	}
};
// node_modules/graceful-fs/polyfills.js
var require_polyfills = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var constants = __require("constants");
	var origCwd = process.cwd;
	var cwd = null;
	var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
	process.cwd = function() {
		if (!cwd) cwd = origCwd.call(process);
		return cwd;
	};
	try {
		process.cwd();
	} catch (er) {}
	if (typeof process.chdir === "function") {
		var chdir = process.chdir;
		process.chdir = function(d) {
			cwd = null;
			chdir.call(process, d);
		};
		if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
	}
	module.exports = patch;
	function patch(fs) {
		if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) patchLchmod(fs);
		if (!fs.lutimes) patchLutimes(fs);
		fs.chown = chownFix(fs.chown);
		fs.fchown = chownFix(fs.fchown);
		fs.lchown = chownFix(fs.lchown);
		fs.chmod = chmodFix(fs.chmod);
		fs.fchmod = chmodFix(fs.fchmod);
		fs.lchmod = chmodFix(fs.lchmod);
		fs.chownSync = chownFixSync(fs.chownSync);
		fs.fchownSync = chownFixSync(fs.fchownSync);
		fs.lchownSync = chownFixSync(fs.lchownSync);
		fs.chmodSync = chmodFixSync(fs.chmodSync);
		fs.fchmodSync = chmodFixSync(fs.fchmodSync);
		fs.lchmodSync = chmodFixSync(fs.lchmodSync);
		fs.stat = statFix(fs.stat);
		fs.fstat = statFix(fs.fstat);
		fs.lstat = statFix(fs.lstat);
		fs.statSync = statFixSync(fs.statSync);
		fs.fstatSync = statFixSync(fs.fstatSync);
		fs.lstatSync = statFixSync(fs.lstatSync);
		if (fs.chmod && !fs.lchmod) {
			fs.lchmod = function(path, mode, cb) {
				if (cb) process.nextTick(cb);
			};
			fs.lchmodSync = function() {};
		}
		if (fs.chown && !fs.lchown) {
			fs.lchown = function(path, uid, gid, cb) {
				if (cb) process.nextTick(cb);
			};
			fs.lchownSync = function() {};
		}
		if (platform === "win32") fs.rename = typeof fs.rename !== "function" ? fs.rename : (function(fs$rename) {
			function rename(from, to, cb) {
				var start = Date.now();
				var backoff = 0;
				fs$rename(from, to, function CB(er) {
					if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
						setTimeout(function() {
							fs.stat(to, function(stater, st) {
								if (stater && stater.code === "ENOENT") fs$rename(from, to, CB);
								else cb(er);
							});
						}, backoff);
						if (backoff < 100) backoff += 10;
						return;
					}
					if (cb) cb(er);
				});
			}
			if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
			return rename;
		})(fs.rename);
		fs.read = typeof fs.read !== "function" ? fs.read : (function(fs$read) {
			function read(fd, buffer, offset, length, position, callback_) {
				var callback;
				if (callback_ && typeof callback_ === "function") {
					var eagCounter = 0;
					callback = function(er, _, __) {
						if (er && er.code === "EAGAIN" && eagCounter < 10) {
							eagCounter++;
							return fs$read.call(fs, fd, buffer, offset, length, position, callback);
						}
						callback_.apply(this, arguments);
					};
				}
				return fs$read.call(fs, fd, buffer, offset, length, position, callback);
			}
			if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
			return read;
		})(fs.read);
		fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : (function(fs$readSync) {
			return function(fd, buffer, offset, length, position) {
				var eagCounter = 0;
				while (true) try {
					return fs$readSync.call(fs, fd, buffer, offset, length, position);
				} catch (er) {
					if (er.code === "EAGAIN" && eagCounter < 10) {
						eagCounter++;
						continue;
					}
					throw er;
				}
			};
		})(fs.readSync);
		function patchLchmod(fs) {
			fs.lchmod = function(path, mode, callback) {
				fs.open(path, constants.O_WRONLY | constants.O_SYMLINK, mode, function(err, fd) {
					if (err) {
						if (callback) callback(err);
						return;
					}
					fs.fchmod(fd, mode, function(err) {
						fs.close(fd, function(err2) {
							if (callback) callback(err || err2);
						});
					});
				});
			};
			fs.lchmodSync = function(path, mode) {
				var fd = fs.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
				var threw = true;
				var ret;
				try {
					ret = fs.fchmodSync(fd, mode);
					threw = false;
				} finally {
					if (threw) try {
						fs.closeSync(fd);
					} catch (er) {}
					else fs.closeSync(fd);
				}
				return ret;
			};
		}
		function patchLutimes(fs) {
			if (constants.hasOwnProperty("O_SYMLINK") && fs.futimes) {
				fs.lutimes = function(path, at, mt, cb) {
					fs.open(path, constants.O_SYMLINK, function(er, fd) {
						if (er) {
							if (cb) cb(er);
							return;
						}
						fs.futimes(fd, at, mt, function(er) {
							fs.close(fd, function(er2) {
								if (cb) cb(er || er2);
							});
						});
					});
				};
				fs.lutimesSync = function(path, at, mt) {
					var fd = fs.openSync(path, constants.O_SYMLINK);
					var ret;
					var threw = true;
					try {
						ret = fs.futimesSync(fd, at, mt);
						threw = false;
					} finally {
						if (threw) try {
							fs.closeSync(fd);
						} catch (er) {}
						else fs.closeSync(fd);
					}
					return ret;
				};
			} else if (fs.futimes) {
				fs.lutimes = function(_a, _b, _c, cb) {
					if (cb) process.nextTick(cb);
				};
				fs.lutimesSync = function() {};
			}
		}
		function chmodFix(orig) {
			if (!orig) return orig;
			return function(target, mode, cb) {
				return orig.call(fs, target, mode, function(er) {
					if (chownErOk(er)) er = null;
					if (cb) cb.apply(this, arguments);
				});
			};
		}
		function chmodFixSync(orig) {
			if (!orig) return orig;
			return function(target, mode) {
				try {
					return orig.call(fs, target, mode);
				} catch (er) {
					if (!chownErOk(er)) throw er;
				}
			};
		}
		function chownFix(orig) {
			if (!orig) return orig;
			return function(target, uid, gid, cb) {
				return orig.call(fs, target, uid, gid, function(er) {
					if (chownErOk(er)) er = null;
					if (cb) cb.apply(this, arguments);
				});
			};
		}
		function chownFixSync(orig) {
			if (!orig) return orig;
			return function(target, uid, gid) {
				try {
					return orig.call(fs, target, uid, gid);
				} catch (er) {
					if (!chownErOk(er)) throw er;
				}
			};
		}
		function statFix(orig) {
			if (!orig) return orig;
			return function(target, options, cb) {
				if (typeof options === "function") {
					cb = options;
					options = null;
				}
				function callback(er, stats) {
					if (stats) {
						if (stats.uid < 0) stats.uid += 4294967296;
						if (stats.gid < 0) stats.gid += 4294967296;
					}
					if (cb) cb.apply(this, arguments);
				}
				return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
			};
		}
		function statFixSync(orig) {
			if (!orig) return orig;
			return function(target, options) {
				var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
				if (stats) {
					if (stats.uid < 0) stats.uid += 4294967296;
					if (stats.gid < 0) stats.gid += 4294967296;
				}
				return stats;
			};
		}
		function chownErOk(er) {
			if (!er) return true;
			if (er.code === "ENOSYS") return true;
			if (!process.getuid || process.getuid() !== 0) {
				if (er.code === "EINVAL" || er.code === "EPERM") return true;
			}
			return false;
		}
	}
}));
// node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Stream = __require("stream").Stream;
	module.exports = legacy;
	function legacy(fs) {
		return {
			ReadStream,
			WriteStream
		};
		function ReadStream(path, options) {
			if (!(this instanceof ReadStream)) return new ReadStream(path, options);
			Stream.call(this);
			var self = this;
			this.path = path;
			this.fd = null;
			this.readable = true;
			this.paused = false;
			this.flags = "r";
			this.mode = 438;
			this.bufferSize = 65536;
			options = options || {};
			var keys = Object.keys(options);
			for (var index = 0, length = keys.length; index < length; index++) {
				var key = keys[index];
				this[key] = options[key];
			}
			if (this.encoding) this.setEncoding(this.encoding);
			if (this.start !== void 0) {
				if ("number" !== typeof this.start) throw TypeError("start must be a Number");
				if (this.end === void 0) this.end = Infinity;
				else if ("number" !== typeof this.end) throw TypeError("end must be a Number");
				if (this.start > this.end) throw new Error("start must be <= end");
				this.pos = this.start;
			}
			if (this.fd !== null) {
				process.nextTick(function() {
					self._read();
				});
				return;
			}
			fs.open(this.path, this.flags, this.mode, function(err, fd) {
				if (err) {
					self.emit("error", err);
					self.readable = false;
					return;
				}
				self.fd = fd;
				self.emit("open", fd);
				self._read();
			});
		}
		function WriteStream(path, options) {
			if (!(this instanceof WriteStream)) return new WriteStream(path, options);
			Stream.call(this);
			this.path = path;
			this.fd = null;
			this.writable = true;
			this.flags = "w";
			this.encoding = "binary";
			this.mode = 438;
			this.bytesWritten = 0;
			options = options || {};
			var keys = Object.keys(options);
			for (var index = 0, length = keys.length; index < length; index++) {
				var key = keys[index];
				this[key] = options[key];
			}
			if (this.start !== void 0) {
				if ("number" !== typeof this.start) throw TypeError("start must be a Number");
				if (this.start < 0) throw new Error("start must be >= zero");
				this.pos = this.start;
			}
			this.busy = false;
			this._queue = [];
			if (this.fd === null) {
				this._open = fs.open;
				this._queue.push([
					this._open,
					this.path,
					this.flags,
					this.mode,
					void 0
				]);
				this.flush();
			}
		}
	}
}));
// node_modules/graceful-fs/clone.js
var require_clone = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = clone;
	var getPrototypeOf = Object.getPrototypeOf || function(obj) {
		return obj.__proto__;
	};
	function clone(obj) {
		if (obj === null || typeof obj !== "object") return obj;
		if (obj instanceof Object) var copy = { __proto__: getPrototypeOf(obj) };
		else var copy = Object.create(null);
		Object.getOwnPropertyNames(obj).forEach(function(key) {
			Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
		});
		return copy;
	}
}));
// node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var fs = __require("fs");
	var polyfills = require_polyfills();
	var legacy = require_legacy_streams();
	var clone = require_clone();
	var util = __require("util");
	/* istanbul ignore next - node 0.x polyfill */
	var gracefulQueue;
	var previousSymbol;
	/* istanbul ignore else - node 0.x polyfill */
	if (typeof Symbol === "function" && typeof Symbol.for === "function") {
		gracefulQueue = Symbol.for("graceful-fs.queue");
		previousSymbol = Symbol.for("graceful-fs.previous");
	} else {
		gracefulQueue = "___graceful-fs.queue";
		previousSymbol = "___graceful-fs.previous";
	}
	function noop() {}
	function publishQueue(context, queue) {
		Object.defineProperty(context, gracefulQueue, { get: function() {
			return queue;
		} });
	}
	var debug = noop;
	if (util.debuglog) debug = util.debuglog("gfs4");
	else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) debug = function() {
		var m = util.format.apply(util, arguments);
		m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
		console.error(m);
	};
	if (!fs[gracefulQueue]) {
		publishQueue(fs, global[gracefulQueue] || []);
		fs.close = (function(fs$close) {
			function close(fd, cb) {
				return fs$close.call(fs, fd, function(err) {
					if (!err) resetQueue();
					if (typeof cb === "function") cb.apply(this, arguments);
				});
			}
			Object.defineProperty(close, previousSymbol, { value: fs$close });
			return close;
		})(fs.close);
		fs.closeSync = (function(fs$closeSync) {
			function closeSync(fd) {
				fs$closeSync.apply(fs, arguments);
				resetQueue();
			}
			Object.defineProperty(closeSync, previousSymbol, { value: fs$closeSync });
			return closeSync;
		})(fs.closeSync);
		if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) process.on("exit", function() {
			debug(fs[gracefulQueue]);
			__require("assert").equal(fs[gracefulQueue].length, 0);
		});
	}
	if (!global[gracefulQueue]) publishQueue(global, fs[gracefulQueue]);
	module.exports = patch(clone(fs));
	if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
		module.exports = patch(fs);
		fs.__patched = true;
	}
	function patch(fs) {
		polyfills(fs);
		fs.gracefulify = patch;
		fs.createReadStream = createReadStream;
		fs.createWriteStream = createWriteStream;
		var fs$readFile = fs.readFile;
		fs.readFile = readFile;
		function readFile(path, options, cb) {
			if (typeof options === "function") cb = options, options = null;
			return go$readFile(path, options, cb);
			function go$readFile(path, options, cb, startTime) {
				return fs$readFile(path, options, function(err) {
					if (err && (err.code === "EMFILE" || err.code === "ENFILE")) enqueue([
						go$readFile,
						[
							path,
							options,
							cb
						],
						err,
						startTime || Date.now(),
						Date.now()
					]);
					else if (typeof cb === "function") cb.apply(this, arguments);
				});
			}
		}
		var fs$writeFile = fs.writeFile;
		fs.writeFile = writeFile;
		function writeFile(path, data, options, cb) {
			if (typeof options === "function") cb = options, options = null;
			return go$writeFile(path, data, options, cb);
			function go$writeFile(path, data, options, cb, startTime) {
				return fs$writeFile(path, data, options, function(err) {
					if (err && (err.code === "EMFILE" || err.code === "ENFILE")) enqueue([
						go$writeFile,
						[
							path,
							data,
							options,
							cb
						],
						err,
						startTime || Date.now(),
						Date.now()
					]);
					else if (typeof cb === "function") cb.apply(this, arguments);
				});
			}
		}
		var fs$appendFile = fs.appendFile;
		if (fs$appendFile) fs.appendFile = appendFile;
		function appendFile(path, data, options, cb) {
			if (typeof options === "function") cb = options, options = null;
			return go$appendFile(path, data, options, cb);
			function go$appendFile(path, data, options, cb, startTime) {
				return fs$appendFile(path, data, options, function(err) {
					if (err && (err.code === "EMFILE" || err.code === "ENFILE")) enqueue([
						go$appendFile,
						[
							path,
							data,
							options,
							cb
						],
						err,
						startTime || Date.now(),
						Date.now()
					]);
					else if (typeof cb === "function") cb.apply(this, arguments);
				});
			}
		}
		var fs$copyFile = fs.copyFile;
		if (fs$copyFile) fs.copyFile = copyFile;
		function copyFile(src, dest, flags, cb) {
			if (typeof flags === "function") {
				cb = flags;
				flags = 0;
			}
			return go$copyFile(src, dest, flags, cb);
			function go$copyFile(src, dest, flags, cb, startTime) {
				return fs$copyFile(src, dest, flags, function(err) {
					if (err && (err.code === "EMFILE" || err.code === "ENFILE")) enqueue([
						go$copyFile,
						[
							src,
							dest,
							flags,
							cb
						],
						err,
						startTime || Date.now(),
						Date.now()
					]);
					else if (typeof cb === "function") cb.apply(this, arguments);
				});
			}
		}
		var fs$readdir = fs.readdir;
		fs.readdir = readdir;
		var noReaddirOptionVersions = /^v[0-5]\./;
		function readdir(path, options, cb) {
			if (typeof options === "function") cb = options, options = null;
			var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir(path, options, cb, startTime) {
				return fs$readdir(path, fs$readdirCallback(path, options, cb, startTime));
			} : function go$readdir(path, options, cb, startTime) {
				return fs$readdir(path, options, fs$readdirCallback(path, options, cb, startTime));
			};
			return go$readdir(path, options, cb);
			function fs$readdirCallback(path, options, cb, startTime) {
				return function(err, files) {
					if (err && (err.code === "EMFILE" || err.code === "ENFILE")) enqueue([
						go$readdir,
						[
							path,
							options,
							cb
						],
						err,
						startTime || Date.now(),
						Date.now()
					]);
					else {
						if (files && files.sort) files.sort();
						if (typeof cb === "function") cb.call(this, err, files);
					}
				};
			}
		}
		if (process.version.substr(0, 4) === "v0.8") {
			var legStreams = legacy(fs);
			ReadStream = legStreams.ReadStream;
			WriteStream = legStreams.WriteStream;
		}
		var fs$ReadStream = fs.ReadStream;
		if (fs$ReadStream) {
			ReadStream.prototype = Object.create(fs$ReadStream.prototype);
			ReadStream.prototype.open = ReadStream$open;
		}
		var fs$WriteStream = fs.WriteStream;
		if (fs$WriteStream) {
			WriteStream.prototype = Object.create(fs$WriteStream.prototype);
			WriteStream.prototype.open = WriteStream$open;
		}
		Object.defineProperty(fs, "ReadStream", {
			get: function() {
				return ReadStream;
			},
			set: function(val) {
				ReadStream = val;
			},
			enumerable: true,
			configurable: true
		});
		Object.defineProperty(fs, "WriteStream", {
			get: function() {
				return WriteStream;
			},
			set: function(val) {
				WriteStream = val;
			},
			enumerable: true,
			configurable: true
		});
		var FileReadStream = ReadStream;
		Object.defineProperty(fs, "FileReadStream", {
			get: function() {
				return FileReadStream;
			},
			set: function(val) {
				FileReadStream = val;
			},
			enumerable: true,
			configurable: true
		});
		var FileWriteStream = WriteStream;
		Object.defineProperty(fs, "FileWriteStream", {
			get: function() {
				return FileWriteStream;
			},
			set: function(val) {
				FileWriteStream = val;
			},
			enumerable: true,
			configurable: true
		});
		function ReadStream(path, options) {
			if (this instanceof ReadStream) return fs$ReadStream.apply(this, arguments), this;
			else return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
		}
		function ReadStream$open() {
			var that = this;
			open(that.path, that.flags, that.mode, function(err, fd) {
				if (err) {
					if (that.autoClose) that.destroy();
					that.emit("error", err);
				} else {
					that.fd = fd;
					that.emit("open", fd);
					that.read();
				}
			});
		}
		function WriteStream(path, options) {
			if (this instanceof WriteStream) return fs$WriteStream.apply(this, arguments), this;
			else return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
		}
		function WriteStream$open() {
			var that = this;
			open(that.path, that.flags, that.mode, function(err, fd) {
				if (err) {
					that.destroy();
					that.emit("error", err);
				} else {
					that.fd = fd;
					that.emit("open", fd);
				}
			});
		}
		function createReadStream(path, options) {
			return new fs.ReadStream(path, options);
		}
		function createWriteStream(path, options) {
			return new fs.WriteStream(path, options);
		}
		var fs$open = fs.open;
		fs.open = open;
		function open(path, flags, mode, cb) {
			if (typeof mode === "function") cb = mode, mode = null;
			return go$open(path, flags, mode, cb);
			function go$open(path, flags, mode, cb, startTime) {
				return fs$open(path, flags, mode, function(err, fd) {
					if (err && (err.code === "EMFILE" || err.code === "ENFILE")) enqueue([
						go$open,
						[
							path,
							flags,
							mode,
							cb
						],
						err,
						startTime || Date.now(),
						Date.now()
					]);
					else if (typeof cb === "function") cb.apply(this, arguments);
				});
			}
		}
		return fs;
	}
	function enqueue(elem) {
		debug("ENQUEUE", elem[0].name, elem[1]);
		fs[gracefulQueue].push(elem);
		retry();
	}
	var retryTimer;
	function resetQueue() {
		var now = Date.now();
		for (var i = 0; i < fs[gracefulQueue].length; ++i) if (fs[gracefulQueue][i].length > 2) {
			fs[gracefulQueue][i][3] = now;
			fs[gracefulQueue][i][4] = now;
		}
		retry();
	}
	function retry() {
		clearTimeout(retryTimer);
		retryTimer = void 0;
		if (fs[gracefulQueue].length === 0) return;
		var elem = fs[gracefulQueue].shift();
		var fn = elem[0];
		var args = elem[1];
		var err = elem[2];
		var startTime = elem[3];
		var lastTime = elem[4];
		if (startTime === void 0) {
			debug("RETRY", fn.name, args);
			fn.apply(null, args);
		} else if (Date.now() - startTime >= 6e4) {
			debug("TIMEOUT", fn.name, args);
			var cb = args.pop();
			if (typeof cb === "function") cb.call(null, err);
		} else {
			var sinceAttempt = Date.now() - lastTime;
			var sinceStart = Math.max(lastTime - startTime, 1);
			if (sinceAttempt >= Math.min(sinceStart * 1.2, 100)) {
				debug("RETRY", fn.name, args);
				fn.apply(null, args.concat([startTime]));
			} else fs[gracefulQueue].push(elem);
		}
		if (retryTimer === void 0) retryTimer = setTimeout(retry, 0);
	}
}));
(/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var VAL32 = 4294967296;
	var _HEX = [];
	for (var i = 0; i < 256; i++) _HEX[i] = (i > 15 ? "" : "0") + i.toString(16);
	/**
	* Constructor accepts any of the following argument types:
	*
	* new Int64(buffer[, offset=0]) - Existing Buffer with byte offset
	* new Int64(Uint8Array[, offset=0]) - Existing Uint8Array with a byte offset
	* new Int64(string)             - Hex string (throws if n is outside int64 range)
	* new Int64(number)             - Number (throws if n is outside int64 range)
	* new Int64(hi, lo)             - Raw bits as two 32-bit values
	*/
	var Int64 = module.exports = function(a1, a2) {
		if (a1 instanceof Buffer) {
			this.buffer = a1;
			this.offset = a2 || 0;
		} else if (Object.prototype.toString.call(a1) == "[object Uint8Array]") {
			this.buffer = new Buffer(a1);
			this.offset = a2 || 0;
		} else {
			this.buffer = this.buffer || new Buffer(8);
			this.offset = 0;
			this.setValue.apply(this, arguments);
		}
	};
	Int64.MAX_INT = Math.pow(2, 53);
	Int64.MIN_INT = -Math.pow(2, 53);
	Int64.prototype = {
		constructor: Int64,
		/**
		* Do in-place 2's compliment.  See
		* http://en.wikipedia.org/wiki/Two's_complement
		*/
		_2scomp: function() {
			var b = this.buffer, o = this.offset, carry = 1;
			for (var i = o + 7; i >= o; i--) {
				var v = (b[i] ^ 255) + carry;
				b[i] = v & 255;
				carry = v >> 8;
			}
		},
		/**
		* Set the value. Takes any of the following arguments:
		*
		* setValue(string) - A hexidecimal string
		* setValue(number) - Number (throws if n is outside int64 range)
		* setValue(hi, lo) - Raw bits as two 32-bit values
		*/
		setValue: function(hi, lo) {
			var negate = false;
			if (arguments.length == 1) {
				if (typeof hi == "number") {
					negate = hi < 0;
					hi = Math.abs(hi);
					lo = hi % VAL32;
					hi = hi / VAL32;
					if (hi > VAL32) throw new RangeError(hi + " is outside Int64 range");
					hi = hi | 0;
				} else if (typeof hi == "string") {
					hi = (hi + "").replace(/^0x/, "");
					lo = hi.substr(-8);
					hi = hi.length > 8 ? hi.substr(0, hi.length - 8) : "";
					hi = parseInt(hi, 16);
					lo = parseInt(lo, 16);
				} else throw new Error(hi + " must be a Number or String");
			}
			var b = this.buffer, o = this.offset;
			for (var i = 7; i >= 0; i--) {
				b[o + i] = lo & 255;
				lo = i == 4 ? hi : lo >>> 8;
			}
			if (negate) this._2scomp();
		},
		/**
		* Convert to a native JS number.
		*
		* WARNING: Do not expect this value to be accurate to integer precision for
		* large (positive or negative) numbers!
		*
		* @param allowImprecise If true, no check is performed to verify the
		* returned value is accurate to integer precision.  If false, imprecise
		* numbers (very large positive or negative numbers) will be forced to +/-
		* Infinity.
		*/
		toNumber: function(allowImprecise) {
			var b = this.buffer, o = this.offset;
			var negate = b[o] & 128, x = 0, carry = 1;
			for (var i = 7, m = 1; i >= 0; i--, m *= 256) {
				var v = b[o + i];
				if (negate) {
					v = (v ^ 255) + carry;
					carry = v >> 8;
					v = v & 255;
				}
				x += v * m;
			}
			if (!allowImprecise && x >= Int64.MAX_INT) return negate ? -Infinity : Infinity;
			return negate ? -x : x;
		},
		/**
		* Convert to a JS Number. Returns +/-Infinity for values that can't be
		* represented to integer precision.
		*/
		valueOf: function() {
			return this.toNumber(false);
		},
		/**
		* Return string value
		*
		* @param radix Just like Number#toString()'s radix
		*/
		toString: function(radix) {
			return this.valueOf().toString(radix || 10);
		},
		/**
		* Return a string showing the buffer octets, with MSB on the left.
		*
		* @param sep separator string. default is '' (empty string)
		*/
		toOctetString: function(sep) {
			var out = new Array(8);
			var b = this.buffer, o = this.offset;
			for (var i = 0; i < 8; i++) out[i] = _HEX[b[o + i]];
			return out.join(sep || "");
		},
		/**
		* Returns the int64's 8 bytes in a buffer.
		*
		* @param {bool} [rawBuffer=false]  If no offset and this is true, return the internal buffer.  Should only be used if
		*                                  you're discarding the Int64 afterwards, as it breaks encapsulation.
		*/
		toBuffer: function(rawBuffer) {
			if (rawBuffer && this.offset === 0) return this.buffer;
			var out = new Buffer(8);
			this.buffer.copy(out, 0, this.offset, this.offset + 8);
			return out;
		},
		/**
		* Copy 8 bytes of int64 into target buffer at target offset.
		*
		* @param {Buffer} targetBuffer       Buffer to copy into.
		* @param {number} [targetOffset=0]   Offset into target buffer.
		*/
		copy: function(targetBuffer, targetOffset) {
			this.buffer.copy(targetBuffer, targetOffset || 0, this.offset, this.offset + 8);
		},
		/**
		* Returns a number indicating whether this comes before or after or is the
		* same as the other in sort order.
		*
		* @param {Int64} other  Other Int64 to compare.
		*/
		compare: function(other) {
			if ((this.buffer[this.offset] & 128) != (other.buffer[other.offset] & 128)) return other.buffer[other.offset] - this.buffer[this.offset];
			for (var i = 0; i < 8; i++) if (this.buffer[this.offset + i] !== other.buffer[other.offset + i]) return this.buffer[this.offset + i] - other.buffer[other.offset + i];
			return 0;
		},
		/**
		* Returns a boolean indicating if this integer is equal to other.
		*
		* @param {Int64} other  Other Int64 to compare.
		*/
		equals: function(other) {
			return this.compare(other) === 0;
		},
		/**
		* Pretty output in console.log
		*/
		inspect: function() {
			return "[Int64 value:" + this + " octets:" + this.toOctetString(" ") + "]";
		}
	};
})))();
Buffer.alloc(4).writeUInt32LE(101010256, 0);
require_graceful_fs();
// node_modules/read-excel-file/modules/zip/UnzipError.js
function _typeof$9(o) {
	"@babel/helpers - typeof";
	return _typeof$9 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$9(o);
}
function _defineProperties$4(target, props) {
	for (var i = 0; i < props.length; i++) {
		var descriptor = props[i];
		descriptor.enumerable = descriptor.enumerable || false;
		descriptor.configurable = true;
		if ("value" in descriptor) descriptor.writable = true;
		Object.defineProperty(target, _toPropertyKey$8(descriptor.key), descriptor);
	}
}
function _createClass$4(Constructor, protoProps, staticProps) {
	if (protoProps) _defineProperties$4(Constructor.prototype, protoProps);
	if (staticProps) _defineProperties$4(Constructor, staticProps);
	Object.defineProperty(Constructor, "prototype", { writable: false });
	return Constructor;
}
function _toPropertyKey$8(arg) {
	var key = _toPrimitive$8(arg, "string");
	return _typeof$9(key) === "symbol" ? key : String(key);
}
function _toPrimitive$8(input, hint) {
	if (_typeof$9(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$9(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _classCallCheck$4(instance, Constructor) {
	if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _inherits$4(subClass, superClass) {
	if (typeof superClass !== "function" && superClass !== null) throw new TypeError("Super expression must either be null or a function");
	subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: {
		value: subClass,
		writable: true,
		configurable: true
	} });
	Object.defineProperty(subClass, "prototype", { writable: false });
	if (superClass) _setPrototypeOf$4(subClass, superClass);
}
function _createSuper$4(Derived) {
	var hasNativeReflectConstruct = _isNativeReflectConstruct$4();
	return function _createSuperInternal() {
		var Super = _getPrototypeOf$4(Derived), result;
		if (hasNativeReflectConstruct) {
			var NewTarget = _getPrototypeOf$4(this).constructor;
			result = Reflect.construct(Super, arguments, NewTarget);
		} else result = Super.apply(this, arguments);
		return _possibleConstructorReturn$4(this, result);
	};
}
function _possibleConstructorReturn$4(self, call) {
	if (call && (_typeof$9(call) === "object" || typeof call === "function")) return call;
	else if (call !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
	return _assertThisInitialized$4(self);
}
function _assertThisInitialized$4(self) {
	if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return self;
}
function _wrapNativeSuper$3(Class) {
	var _cache = typeof Map === "function" ? /* @__PURE__ */ new Map() : void 0;
	_wrapNativeSuper$3 = function _wrapNativeSuper(Class) {
		if (Class === null || !_isNativeFunction$3(Class)) return Class;
		if (typeof Class !== "function") throw new TypeError("Super expression must either be null or a function");
		if (typeof _cache !== "undefined") {
			if (_cache.has(Class)) return _cache.get(Class);
			_cache.set(Class, Wrapper);
		}
		function Wrapper() {
			return _construct$3(Class, arguments, _getPrototypeOf$4(this).constructor);
		}
		Wrapper.prototype = Object.create(Class.prototype, { constructor: {
			value: Wrapper,
			enumerable: false,
			writable: true,
			configurable: true
		} });
		return _setPrototypeOf$4(Wrapper, Class);
	};
	return _wrapNativeSuper$3(Class);
}
function _construct$3(Parent, args, Class) {
	if (_isNativeReflectConstruct$4()) _construct$3 = Reflect.construct.bind();
	else _construct$3 = function _construct(Parent, args, Class) {
		var a = [null];
		a.push.apply(a, args);
		var instance = new (Function.bind.apply(Parent, a))();
		if (Class) _setPrototypeOf$4(instance, Class.prototype);
		return instance;
	};
	return _construct$3.apply(null, arguments);
}
function _isNativeReflectConstruct$4() {
	if (typeof Reflect === "undefined" || !Reflect.construct) return false;
	if (Reflect.construct.sham) return false;
	if (typeof Proxy === "function") return true;
	try {
		Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
		return true;
	} catch (e) {
		return false;
	}
}
function _isNativeFunction$3(fn) {
	return Function.toString.call(fn).indexOf("[native code]") !== -1;
}
function _setPrototypeOf$4(o, p) {
	_setPrototypeOf$4 = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf(o, p) {
		o.__proto__ = p;
		return o;
	};
	return _setPrototypeOf$4(o, p);
}
function _getPrototypeOf$4(o) {
	_getPrototypeOf$4 = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf(o) {
		return o.__proto__ || Object.getPrototypeOf(o);
	};
	return _getPrototypeOf$4(o);
}
var UnzipError = /*#__PURE__*/ function(_Error) {
	_inherits$4(UnzipError, _Error);
	var _super = _createSuper$4(UnzipError);
	function UnzipError() {
		_classCallCheck$4(this, UnzipError);
		return _super.apply(this, arguments);
	}
	return _createClass$4(UnzipError);
}(/*#__PURE__*/ _wrapNativeSuper$3(Error));
function createUnzipError(error) {
	var unzipError = new UnzipError(error.message);
	if (error.stack) unzipError.stack = error.stack;
	if (Error.captureStackTrace) Error.captureStackTrace(unzipError, createUnzipError);
	unzipError.cause = error;
	return unzipError;
}
// node_modules/read-excel-file/modules/zip/unzipFromStream.unzipper.js
var PROMISE_RESOLVE_VALUE = void 0;
/**
* Reads `*.zip` file contents.
* @param  {Stream} stream
* @param  {function} onFile
* @param  {function} onFileData
* @param  {function} onFileDataEnd
* @return {Promise<void>}
*/
function unzipFromStream_(stream, onFile, onFileData, onFileDataEnd) {
	return new Promise(function(resolve, reject) {
		var promises = [];
		var errored = false;
		var onError = function onError(error) {
			if (error instanceof ZipFileError) error = createUnzipError(error);
			if (!errored) {
				errored = true;
				reject(error);
			}
		};
		stream.on("error", onError).pipe(Parse()).on("error", onError).on("finish", function() {
			if (!errored) Promise.all(promises).then(function() {
				resolve(PROMISE_RESOLVE_VALUE);
			}, onError);
		}).on("entry", function(entry) {
			var ignore = false;
			if (entry.type === "Directory") ignore = true;
			if (errored) ignore = true;
			var uncompressedFileSize = !(entry.vars.flags & 8) || entry.vars.compressedSize > 0 ? entry.vars.uncompressedSize : void 0;
			if (onFile(entry.path, uncompressedFileSize) === false) ignore = true;
			if (ignore) {
				entry.autodrain().on("error", onError);
				return;
			}
			promises.push(new Promise(function(resolve) {
				entry.on("data", function(data) {
					onFileData(entry.path, data);
				}).on("error", function(error) {
					onError(error);
				}).on("finish", function() {
					onFileDataEnd(entry.path);
					resolve();
				});
			}));
		});
	});
}
// node_modules/read-excel-file/modules/zip/unzipFromStream.js
function _createForOfIteratorHelperLoose$4(o, allowArrayLike) {
	var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
	if (it) return (it = it.call(o)).next.bind(it);
	if (Array.isArray(o) || (it = _unsupportedIterableToArray$5(o)) || allowArrayLike && o && typeof o.length === "number") {
		if (it) o = it;
		var i = 0;
		return function() {
			if (i >= o.length) return { done: true };
			return {
				done: false,
				value: o[i++]
			};
		};
	}
	throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _unsupportedIterableToArray$5(o, minLen) {
	if (!o) return;
	if (typeof o === "string") return _arrayLikeToArray$5(o, minLen);
	var n = Object.prototype.toString.call(o).slice(8, -1);
	if (n === "Object" && o.constructor) n = o.constructor.name;
	if (n === "Map" || n === "Set") return Array.from(o);
	if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$5(o, minLen);
}
function _arrayLikeToArray$5(arr, len) {
	if (len == null || len > arr.length) len = arr.length;
	for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
	return arr2;
}
/**
* Reads `*.zip` file contents.
* @param  {Stream} stream
* @return {Promise<Record<string,Buffer>>} Resolves to an object holding `*.zip` file entries. P.S. `Buffer` is a `Uint8Array`.
*/
function unzipFromStream(stream) {
	var filter = (arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}).filter;
	var files = {};
	var filesData = {};
	return unzipFromStream_(stream, function onFile(filePath, fileSize) {
		if (filter && !filter({ path: filePath })) return false;
		filesData[filePath] = {
			size: fileSize,
			chunks: [],
			buffer: fileSize === void 0 ? void 0 : Buffer.alloc(fileSize),
			position: 0
		};
	}, function onFileData(filePath, chunk) {
		if (filesData[filePath].size === void 0) filesData[filePath].chunks.push(chunk);
		else filesData[filePath].position += chunk.copy(filesData[filePath].buffer, filesData[filePath].position);
	}, function onFileDataEnd(filePath) {
		if (filesData[filePath].size === void 0) files[filePath] = concatChunksToNonPooledBuffer(filesData[filePath].chunks);
		else files[filePath] = filesData[filePath].buffer;
		delete filesData[filePath];
	}).then(function() {
		return files;
	});
}
function concatChunksToNonPooledBuffer(chunks) {
	var totalLength = chunks.reduce(function(sum, chunk) {
		return sum + chunk.length;
	}, 0);
	var buffer = Buffer.allocUnsafeSlow(totalLength);
	var offset = 0;
	for (var _iterator = _createForOfIteratorHelperLoose$4(chunks), _step; !(_step = _iterator()).done;) {
		var chunk = _step.value;
		chunk.copy(buffer, offset);
		offset += chunk.length;
	}
	return buffer;
}
// node_modules/read-excel-file/modules/xlsx/file/InvalidInputError.js
function _typeof$8(o) {
	"@babel/helpers - typeof";
	return _typeof$8 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$8(o);
}
function _defineProperties$3(target, props) {
	for (var i = 0; i < props.length; i++) {
		var descriptor = props[i];
		descriptor.enumerable = descriptor.enumerable || false;
		descriptor.configurable = true;
		if ("value" in descriptor) descriptor.writable = true;
		Object.defineProperty(target, _toPropertyKey$7(descriptor.key), descriptor);
	}
}
function _createClass$3(Constructor, protoProps, staticProps) {
	if (protoProps) _defineProperties$3(Constructor.prototype, protoProps);
	if (staticProps) _defineProperties$3(Constructor, staticProps);
	Object.defineProperty(Constructor, "prototype", { writable: false });
	return Constructor;
}
function _toPropertyKey$7(arg) {
	var key = _toPrimitive$7(arg, "string");
	return _typeof$8(key) === "symbol" ? key : String(key);
}
function _toPrimitive$7(input, hint) {
	if (_typeof$8(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$8(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _classCallCheck$3(instance, Constructor) {
	if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _inherits$3(subClass, superClass) {
	if (typeof superClass !== "function" && superClass !== null) throw new TypeError("Super expression must either be null or a function");
	subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: {
		value: subClass,
		writable: true,
		configurable: true
	} });
	Object.defineProperty(subClass, "prototype", { writable: false });
	if (superClass) _setPrototypeOf$3(subClass, superClass);
}
function _createSuper$3(Derived) {
	var hasNativeReflectConstruct = _isNativeReflectConstruct$3();
	return function _createSuperInternal() {
		var Super = _getPrototypeOf$3(Derived), result;
		if (hasNativeReflectConstruct) {
			var NewTarget = _getPrototypeOf$3(this).constructor;
			result = Reflect.construct(Super, arguments, NewTarget);
		} else result = Super.apply(this, arguments);
		return _possibleConstructorReturn$3(this, result);
	};
}
function _possibleConstructorReturn$3(self, call) {
	if (call && (_typeof$8(call) === "object" || typeof call === "function")) return call;
	else if (call !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
	return _assertThisInitialized$3(self);
}
function _assertThisInitialized$3(self) {
	if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return self;
}
function _wrapNativeSuper$2(Class) {
	var _cache = typeof Map === "function" ? /* @__PURE__ */ new Map() : void 0;
	_wrapNativeSuper$2 = function _wrapNativeSuper(Class) {
		if (Class === null || !_isNativeFunction$2(Class)) return Class;
		if (typeof Class !== "function") throw new TypeError("Super expression must either be null or a function");
		if (typeof _cache !== "undefined") {
			if (_cache.has(Class)) return _cache.get(Class);
			_cache.set(Class, Wrapper);
		}
		function Wrapper() {
			return _construct$2(Class, arguments, _getPrototypeOf$3(this).constructor);
		}
		Wrapper.prototype = Object.create(Class.prototype, { constructor: {
			value: Wrapper,
			enumerable: false,
			writable: true,
			configurable: true
		} });
		return _setPrototypeOf$3(Wrapper, Class);
	};
	return _wrapNativeSuper$2(Class);
}
function _construct$2(Parent, args, Class) {
	if (_isNativeReflectConstruct$3()) _construct$2 = Reflect.construct.bind();
	else _construct$2 = function _construct(Parent, args, Class) {
		var a = [null];
		a.push.apply(a, args);
		var instance = new (Function.bind.apply(Parent, a))();
		if (Class) _setPrototypeOf$3(instance, Class.prototype);
		return instance;
	};
	return _construct$2.apply(null, arguments);
}
function _isNativeReflectConstruct$3() {
	if (typeof Reflect === "undefined" || !Reflect.construct) return false;
	if (Reflect.construct.sham) return false;
	if (typeof Proxy === "function") return true;
	try {
		Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
		return true;
	} catch (e) {
		return false;
	}
}
function _isNativeFunction$2(fn) {
	return Function.toString.call(fn).indexOf("[native code]") !== -1;
}
function _setPrototypeOf$3(o, p) {
	_setPrototypeOf$3 = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf(o, p) {
		o.__proto__ = p;
		return o;
	};
	return _setPrototypeOf$3(o, p);
}
function _getPrototypeOf$3(o) {
	_getPrototypeOf$3 = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf(o) {
		return o.__proto__ || Object.getPrototypeOf(o);
	};
	return _getPrototypeOf$3(o);
}
var MESSAGES = {
	XLS_FILE_NOT_SUPPORTED: "You passed a legacy `.xls` file. Only `.xlsx` files are supported",
	FILE_NOT_SUPPORTED: "Doesn't look like an `.xlsx` file",
	INVALID_ZIP: "Couldn't unzip `.xlsx` file contents",
	NO_DATA: "No data"
};
var InvalidInputError = /*#__PURE__*/ function(_Error) {
	_inherits$3(InvalidInputError, _Error);
	var _super = _createSuper$3(InvalidInputError);
	/**
	* Creates an `InvalidInputError` instance.
	* @param {string} code
	* @param {any} [cause]
	*/
	function InvalidInputError(code, cause) {
		var _this;
		_classCallCheck$3(this, InvalidInputError);
		_this = _super.call(this, MESSAGES[code] || code);
		_this.code = code;
		_this.name = "InvalidInputError";
		_this.cause = cause;
		return _this;
	}
	return _createClass$3(InvalidInputError);
}(/*#__PURE__*/ _wrapNativeSuper$2(Error));
// node_modules/read-excel-file/modules/export/convertInputToNodeStream.js
/**
* Converts Node.js input argument to a stream.
* @param  {(string|Stream|Buffer|Blob)} input - A Node.js readable stream or a `Buffer` or a `Blob` or a path to a file.
* @returns {Stream}
*/
function convertInputToNodeStream(input) {
	return input instanceof Stream ? input : types.isArrayBuffer(input) ? Readable.from(Buffer(input)) : ArrayBuffer.isView(input) ? Readable.from([input]) : input instanceof Buffer ? Readable.from(input) : input instanceof Blob ? Readable.fromWeb(input.stream()) : typeof input === "string" ? fs.createReadStream(input) : function() {
		throw new InvalidInputError("INPUT_TYPE_NOT_SUPPORTED");
	}();
}
// node_modules/read-excel-file/modules/export/filterZipArchiveEntry.js
function filterZipArchiveEntry(_ref) {
	var path = _ref.path;
	return path.endsWith(".xml") || path.endsWith(".xml.rels");
}
// node_modules/read-excel-file/modules/xlsx/file/createFileTypeDetector.js
var ZIP_FILE_SIGNATURE = [80, 75];
var XLS_FILE_SIGNATURE = [
	208,
	207,
	17,
	224
];
var FILE_TYPE_SIGNATURES = [ZIP_FILE_SIGNATURE, XLS_FILE_SIGNATURE];
FILE_TYPE_SIGNATURES.indexOf(ZIP_FILE_SIGNATURE);
var XLS_FILE_TYPE = FILE_TYPE_SIGNATURES.indexOf(XLS_FILE_SIGNATURE);
/**
* Creates a function get determines a file type based on the leading bytes.
* @return {function} A function that receives a `byte` (an element of a `Uint8Array`) and returns a `type: number?` — an index in the file types "enum", or `-1` if it doesn't match any file type, or `undefined` if it's still deciding on the file type.
* @throws {InvalidInputError}
*/
function createFileTypeDetector() {
	var type;
	var possibleTypes = indexesOf(FILE_TYPE_SIGNATURES);
	var i = 0;
	return function(_byte) {
		if (isNaN(type)) {
			var t;
			possibleTypes = possibleTypes.filter(function(typeIndex) {
				if (_byte === FILE_TYPE_SIGNATURES[typeIndex][i]) {
					if (FILE_TYPE_SIGNATURES[typeIndex].length === i + 1) t = typeIndex;
					return true;
				}
			});
			if (possibleTypes.length === 1) type = t;
			else if (possibleTypes.length === 0) type = -1;
		}
		i++;
		return type;
	};
}
function indexesOf(array) {
	var indexes = [];
	var i = 0;
	while (i < array.length) {
		indexes.push(i);
		i++;
	}
	return indexes;
}
// node_modules/read-excel-file/modules/xlsx/file/validateLeadingBytes.js
function validateByte(_byte2, fileTypeDetector) {
	var fileType = fileTypeDetector(_byte2);
	if (fileType !== void 0) {
		if (fileType === XLS_FILE_TYPE) throw new InvalidInputError("XLS_FILE_NOT_SUPPORTED");
		if (fileType < 0) throw new InvalidInputError("FILE_NOT_SUPPORTED");
		return true;
	}
}
function noFileTypeCouldBeDetermined(byteCount) {
	throw new InvalidInputError(byteCount === 0 ? "NO_DATA" : "FILE_NOT_SUPPORTED");
}
// node_modules/read-excel-file/modules/xlsx/file/InputValidationStream.js
function _typeof$7(o) {
	"@babel/helpers - typeof";
	return _typeof$7 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$7(o);
}
function _createForOfIteratorHelperLoose$3(o, allowArrayLike) {
	var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
	if (it) return (it = it.call(o)).next.bind(it);
	if (Array.isArray(o) || (it = _unsupportedIterableToArray$4(o)) || allowArrayLike && o && typeof o.length === "number") {
		if (it) o = it;
		var i = 0;
		return function() {
			if (i >= o.length) return { done: true };
			return {
				done: false,
				value: o[i++]
			};
		};
	}
	throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _unsupportedIterableToArray$4(o, minLen) {
	if (!o) return;
	if (typeof o === "string") return _arrayLikeToArray$4(o, minLen);
	var n = Object.prototype.toString.call(o).slice(8, -1);
	if (n === "Object" && o.constructor) n = o.constructor.name;
	if (n === "Map" || n === "Set") return Array.from(o);
	if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$4(o, minLen);
}
function _arrayLikeToArray$4(arr, len) {
	if (len == null || len > arr.length) len = arr.length;
	for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
	return arr2;
}
function _classCallCheck$2(instance, Constructor) {
	if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _defineProperties$2(target, props) {
	for (var i = 0; i < props.length; i++) {
		var descriptor = props[i];
		descriptor.enumerable = descriptor.enumerable || false;
		descriptor.configurable = true;
		if ("value" in descriptor) descriptor.writable = true;
		Object.defineProperty(target, _toPropertyKey$6(descriptor.key), descriptor);
	}
}
function _createClass$2(Constructor, protoProps, staticProps) {
	if (protoProps) _defineProperties$2(Constructor.prototype, protoProps);
	if (staticProps) _defineProperties$2(Constructor, staticProps);
	Object.defineProperty(Constructor, "prototype", { writable: false });
	return Constructor;
}
function _toPropertyKey$6(arg) {
	var key = _toPrimitive$6(arg, "string");
	return _typeof$7(key) === "symbol" ? key : String(key);
}
function _toPrimitive$6(input, hint) {
	if (_typeof$7(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$7(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _inherits$2(subClass, superClass) {
	if (typeof superClass !== "function" && superClass !== null) throw new TypeError("Super expression must either be null or a function");
	subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: {
		value: subClass,
		writable: true,
		configurable: true
	} });
	Object.defineProperty(subClass, "prototype", { writable: false });
	if (superClass) _setPrototypeOf$2(subClass, superClass);
}
function _setPrototypeOf$2(o, p) {
	_setPrototypeOf$2 = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf(o, p) {
		o.__proto__ = p;
		return o;
	};
	return _setPrototypeOf$2(o, p);
}
function _createSuper$2(Derived) {
	var hasNativeReflectConstruct = _isNativeReflectConstruct$2();
	return function _createSuperInternal() {
		var Super = _getPrototypeOf$2(Derived), result;
		if (hasNativeReflectConstruct) {
			var NewTarget = _getPrototypeOf$2(this).constructor;
			result = Reflect.construct(Super, arguments, NewTarget);
		} else result = Super.apply(this, arguments);
		return _possibleConstructorReturn$2(this, result);
	};
}
function _possibleConstructorReturn$2(self, call) {
	if (call && (_typeof$7(call) === "object" || typeof call === "function")) return call;
	else if (call !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
	return _assertThisInitialized$2(self);
}
function _assertThisInitialized$2(self) {
	if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return self;
}
function _isNativeReflectConstruct$2() {
	if (typeof Reflect === "undefined" || !Reflect.construct) return false;
	if (Reflect.construct.sham) return false;
	if (typeof Proxy === "function") return true;
	try {
		Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
		return true;
	} catch (e) {
		return false;
	}
}
function _getPrototypeOf$2(o) {
	_getPrototypeOf$2 = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf(o) {
		return o.__proto__ || Object.getPrototypeOf(o);
	};
	return _getPrototypeOf$2(o);
}
/**
* Verifies that an input stream represents a valid `.xlsx` file.
*
* Throws an `InvalidInputError` when the input isn't an `.xlsx` file.
*/
var InputValidationStream = /*#__PURE__*/ function(_Transform) {
	_inherits$2(InputValidationStream, _Transform);
	var _super = _createSuper$2(InputValidationStream);
	function InputValidationStream() {
		var _this;
		_classCallCheck$2(this, InputValidationStream);
		_this = _super.call(this);
		_this.d = createFileTypeDetector();
		_this.i = 0;
		_this.chunks = [];
		return _this;
	}
	_createClass$2(InputValidationStream, [{
		key: "_transform",
		value: function _transform(chunk, encoding, callback) {
			if (this.d) {
				this.chunks.push(chunk);
				for (var _iterator = _createForOfIteratorHelperLoose$3(chunk), _step; !(_step = _iterator()).done;) {
					var _byte = _step.value;
					try {
						if (validateByte(_byte, this.d)) {
							this.d = void 0;
							chunk = Buffer.concat(this.chunks);
							this.chunks = void 0;
							break;
						}
					} catch (error) {
						return callback(error);
					}
					this.i++;
				}
				if (this.d) return callback();
			}
			this.push(chunk);
			callback();
		}
	}, {
		key: "_flush",
		value: function _flush(callback) {
			if (this.d) try {
				noFileTypeCouldBeDetermined(this.i);
			} catch (error) {
				return callback(error);
			}
			callback();
		}
	}]);
	return InputValidationStream;
}(Transform$1);
// node_modules/read-excel-file/modules/utility/checkpoint.js
var latestCheckpointTimestamp;
function checkpoint(name) {
	var now = Date.now();
	if (typeof global !== "undefined" ? Boolean(global.READ_EXCEL_FILE_CHECKPOINTS) : typeof window !== "undefined" ? Boolean(window.READ_EXCEL_FILE_CHECKPOINTS) : false) {
		if (latestCheckpointTimestamp) console.log("  -", now - latestCheckpointTimestamp, "ms");
		console.log("*", name);
	}
	latestCheckpointTimestamp = now;
}
function resetCheckpoint() {
	latestCheckpointTimestamp = void 0;
}
// node_modules/read-excel-file/modules/export/unpackXlsxFileNode.js
/**
* Unpacks `*.xlsx` file contents.
* An `.xlsx` file is really just a `.zip` archive with `.xml` files inside.
* @param  {(string|Stream|Buffer|Blob)} input
* @return {Promise<Record<string,Uint8Array>} Resolves to an object holding `*.xlsx` file entries.
*/
function unpackXlsxFile(input) {
	resetCheckpoint();
	checkpoint("unpack files");
	var stream = convertInputToNodeStream(input);
	return new Promise(function(resolve, reject) {
		unzipFromStream(stream.on("error", reject).pipe(new InputValidationStream()), { filter: filterZipArchiveEntry }).then(resolve, function(error) {
			if (error instanceof UnzipError) reject(new InvalidInputError("INVALID_ZIP", error.cause));
			else reject(error);
		});
	});
}
// node_modules/read-excel-file/modules/xlsx/unescapeXlsxString.js
/**
* Decodes the `_xHHHH_` escape sequences of the `ST_Xstring` ("Escaped String") type
* (ECMA-376 Part 1, §22.9.2.19), which is used in `.xlsx` files to encode characters
* that're considered illegal in the XML 1.0 specification.
*
* One might ask: "For those characters, why not simply use XML's own escaping mechanism?".
* I.e. why not simply encode illegal characters as "&#xHHHH;"? The answer is: the XML 1.0 specification
* doesn't allow using the entire range `0000`...`HHHH` when escaping characters via "&#xHHHH;".
* Specifically, it doesn't allow "control characters" such as "carriage return" or "backspace"
* be encoded that way. For example, "&#x0008;" character sequence (backspace) is illegal in XML 1.0.
* Later, XML 1.1 fixed this by allowing any character sequence except for "&#x0000;". But despite
* the specification change, XML 1.1 is rarely supported by modern parsers, browsers, and web services.
* Relying on it usually breaks interoperability, and the XLSX specification is based on XML 1.0 anyway.
*
* So in XLSX specification, illegal XML characters are written as `_x` + 4 hexadecimal digits + `_`.
* And when there's a legitimate subtring "_xHHHH_" that shouldn't be confused with an escaped character,
* it is written as `_x005F_xHHHH_`, i.e. with its leading "_" character escaped, and the rest characters
* left untouched.
*
* When decoding an "_xHHHH_" substrings in a string, matches are replaced left to right and don't overlap,
* so `_x005F_x0041_` is decoded as "_x0041_" and not as "_A".
*
* @param {string} string
* @returns {string}
*/
function unescapeXlsxString(string) {
	if (string.indexOf("_x") < 0) return string;
	return string.replace(/_x([0-9A-Fa-f]{4})_/g, function(_, hex) {
		return String.fromCharCode(parseInt(hex, 16));
	});
}
// node_modules/read-excel-file/modules/xlsx/parseSpreadsheetInfo.js
/**
* Parses spreadsheet info.
* @param {string} content
* @param  {function} parseXml — SAX XML parser.
* @returns {object} An object of shape `{ epoch1904: boolean, sheets: Sheet[] }`.
*/
function parseSpreadsheetInfo(content, parseXml) {
	var state = createInitialState();
	return parseXml(content, state, onOpenTag, null, null).then(function() {
		return getResultFromState(state);
	});
	function createInitialState() {
		return {
			workbookPr: void 0,
			sheets: []
		};
	}
	function getResultFromState(state) {
		return {
			epoch1904: state.workbookPr ? state.workbookPr.epoch1904 : false,
			sheets: state.sheets
		};
	}
	function onOpenTag(tagName, attributes, state) {
		if (tagName === "workbookPr") {
			if (!state.workbookPr) state.workbookPr = { epoch1904: attributes.date1904 === "1" };
		} else if (tagName === "sheet") {
			if (attributes.name) state.sheets.push({
				id: Number(attributes.sheetId),
				name: unescapeXlsxString(attributes.name),
				relationId: attributes.id
			});
		}
	}
}
// node_modules/read-excel-file/modules/xlsx/parseFilePaths.js
/**
* Returns sheet file paths.
* Seems that the correct place to look for the `sheetId` -> `filename` mapping
* is `xl/_rels/workbook.xml.rels` file.
* https://github.com/tidyverse/readxl/issues/104
* @param  {string} content — `xl/_rels/workbook.xml.rels` file contents.
* @param  {function} parseXml — SAX XML parser.
* @return {object} — An object of shape `{ sheets: Record<string, string>, sharedStrings: string?, styles: string? }`
*/
function parseFilePaths(content, parseXml) {
	var RELATIONSHIPS_BASE_URL_TRANSITIONAL_STANDARD = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
	var RELATIONSHIPS_BASE_URL_STRICT_STANDARD = "http://purl.oclc.org/ooxml/officeDocument/relationships/";
	var state = createInitialState();
	return parseXml(content, state, onOpenTag, null, null).then(function() {
		return getResultFromState(state);
	});
	function createInitialState() {
		return {
			sheets: {},
			sharedStrings: void 0,
			styles: void 0
		};
	}
	function getResultFromState(state) {
		return state;
	}
	function onOpenTag(tagName, attributes, state) {
		if (tagName === "Relationship") addFilePathForRelation(state, attributes.Id, attributes.Type, attributes.Target);
	}
	function addFilePathForRelation(state, id, type, target) {
		switch (type) {
			case RELATIONSHIPS_BASE_URL_TRANSITIONAL_STANDARD + "styles":
			case RELATIONSHIPS_BASE_URL_STRICT_STANDARD + "styles":
				state.styles = getFilePathFromRelationTarget(target);
				break;
			case RELATIONSHIPS_BASE_URL_TRANSITIONAL_STANDARD + "sharedStrings":
			case RELATIONSHIPS_BASE_URL_STRICT_STANDARD + "sharedStrings":
				state.sharedStrings = getFilePathFromRelationTarget(target);
				break;
			case RELATIONSHIPS_BASE_URL_TRANSITIONAL_STANDARD + "worksheet":
			case RELATIONSHIPS_BASE_URL_STRICT_STANDARD + "worksheet": state.sheets[id] = getFilePathFromRelationTarget(target);
		}
	}
	function getFilePathFromRelationTarget(path) {
		if (path[0] === "/") return path.slice(1);
		return "xl/" + path;
	}
}
// node_modules/read-excel-file/modules/xlsx/parseStyles.js
function _typeof$6(o) {
	"@babel/helpers - typeof";
	return _typeof$6 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$6(o);
}
var _excluded$1 = ["xfId"];
function ownKeys$3(e, r) {
	var t = Object.keys(e);
	if (Object.getOwnPropertySymbols) {
		var o = Object.getOwnPropertySymbols(e);
		r && (o = o.filter(function(r) {
			return Object.getOwnPropertyDescriptor(e, r).enumerable;
		})), t.push.apply(t, o);
	}
	return t;
}
function _objectSpread$3(e) {
	for (var r = 1; r < arguments.length; r++) {
		var t = null != arguments[r] ? arguments[r] : {};
		r % 2 ? ownKeys$3(Object(t), !0).forEach(function(r) {
			_defineProperty$3(e, r, t[r]);
		}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys$3(Object(t)).forEach(function(r) {
			Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
		});
	}
	return e;
}
function _defineProperty$3(obj, key, value) {
	key = _toPropertyKey$5(key);
	if (key in obj) Object.defineProperty(obj, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true
	});
	else obj[key] = value;
	return obj;
}
function _toPropertyKey$5(arg) {
	var key = _toPrimitive$5(arg, "string");
	return _typeof$6(key) === "symbol" ? key : String(key);
}
function _toPrimitive$5(input, hint) {
	if (_typeof$6(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$6(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _objectWithoutProperties$1(source, excluded) {
	if (source == null) return {};
	var target = _objectWithoutPropertiesLoose$1(source, excluded);
	var key, i;
	if (Object.getOwnPropertySymbols) {
		var sourceSymbolKeys = Object.getOwnPropertySymbols(source);
		for (i = 0; i < sourceSymbolKeys.length; i++) {
			key = sourceSymbolKeys[i];
			if (excluded.indexOf(key) >= 0) continue;
			if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
			target[key] = source[key];
		}
	}
	return target;
}
function _objectWithoutPropertiesLoose$1(source, excluded) {
	if (source == null) return {};
	var target = {};
	var sourceKeys = Object.keys(source);
	var key, i = 0;
	for (; i < sourceKeys.length; i++) {
		key = sourceKeys[i];
		if (excluded.indexOf(key) >= 0) continue;
		target[key] = source[key];
	}
	return target;
}
/**
* Parses `.xlsx` file styles.
* http://officeopenxml.com/SSstyles.php
* Returns an array of cell styles.
* A cell style index is the cell style ID.
* @param {string} content
* @param  {function} parseXml — SAX XML parser.
* @returns {object} styles
*/
function parseStyles(content, parseXml) {
	var state = createInitialState();
	return parseXml(content, state, onOpenTag, onCloseTag, null).then(function() {
		return getResultFromState(state);
	});
	function createInitialState() {
		return {
			numberFormats: [],
			baseStyles: [],
			styles: [],
			cellStyleXfs: false,
			cellXfs: false
		};
	}
	function getResultFromState(state) {
		return state.styles.map(function(style) {
			if (style.xfId) {
				var xfId = style.xfId, styleProperties = _objectWithoutProperties$1(style, _excluded$1);
				return _objectSpread$3(_objectSpread$3({}, state.baseStyles[xfId]), styleProperties);
			} else return style;
		});
	}
	function onOpenTag(tagName, attributes, state) {
		if (tagName === "numFmt") {
			var numFmtId = Number(attributes.numFmtId);
			var numberFormat = { id: numFmtId };
			if (numFmtId >= 100) numberFormat.template = unescapeXlsxString(attributes.formatCode);
			state.numberFormats[numFmtId] = numberFormat;
		} else if (tagName === "cellStyleXfs") state.cellStyleXfs = true;
		else if (tagName === "cellXfs") state.cellXfs = true;
		else if (tagName === "xf") {
			if (state.cellStyleXfs) state.baseStyles.push(parseCellStyle(attributes));
			else if (state.cellXfs) {
				var style = parseCellStyle(attributes, state.numberFormats);
				if (attributes.xfId) style.xfId = Number(attributes.xfId);
				state.styles.push(style);
			}
		}
	}
	function onCloseTag(tagName, state) {
		if (tagName === "cellStyleXfs") state.cellStyleXfs = false;
		else if (tagName === "cellXfs") state.cellXfs = false;
	}
	function parseCellStyle(attributes, numberFormats) {
		var style = {};
		if (attributes.numFmtId) {
			var numFmtId = Number(attributes.numFmtId);
			if (numberFormats && numberFormats[numFmtId]) style.numberFormat = numberFormats[numFmtId];
			else style.numberFormat = { id: numFmtId };
		}
		return style;
	}
}
// node_modules/read-excel-file/modules/xlsx/parseSharedStrings.js
/**
* Parses `sharedStrings.xml` file.
* @param {string} content
* @param {function} parseXml — SAX XML parser.
* @returns {Promise<string[]>}
*/
function parseSharedStrings(content, parseXml) {
	var state = createInitialState();
	return parseXml(content, state, onOpenTag, onCloseTag, onText).then(function() {
		return getResultFromState(state);
	});
	function createInitialState() {
		return {
			si: void 0,
			strings: []
		};
	}
	function getResultFromState(state) {
		return state.strings;
	}
	function onOpenTag(tagName, attributes, state) {
		if (tagName === "si") state.si = createInitialStateInSharedString();
		else if (state.si) onOpenTagInSharedString(tagName, attributes, state.si);
	}
	function onCloseTag(tagName, state) {
		if (tagName === "si") {
			state.strings.push(unescapeXlsxString(state.si.string));
			state.si = void 0;
		} else if (state.si) onCloseTagInSharedString(tagName, state.si);
	}
	function onText(text, state) {
		if (state.si) onTextInSharedString(text, state.si);
	}
	function createInitialStateInSharedString() {
		return {
			t: false,
			r: false,
			rPh: false,
			string: ""
		};
	}
	function onOpenTagInSharedString(tagName, attributes, state) {
		if (tagName === "t") state.t = true;
		else if (tagName === "r") state.r = true;
		else if (tagName === "rPh") state.rPh = true;
	}
	function onCloseTagInSharedString(tagName, state) {
		if (tagName === "t") state.t = false;
		else if (tagName === "r") state.r = false;
		else if (tagName === "rPh") state.rPh = false;
	}
	function onTextInSharedString(text, state) {
		if (state.rPh) {} else if (state.t) {
			if (state.r) state.string += text;
			else state.string = text;
		}
	}
}
// node_modules/read-excel-file/modules/xlsx/parseExcelTimestamp.js
function parseExcelTimestamp(excelSerialDate, epoch1904) {
	var NUMBER_OF_LEAP_YEARS_BETWEEN_1900_AND_1970 = 17;
	var JANUARY_0TH_1900_DAY = 1;
	var ERRONEOUS_FEBRUARY_29_1990_DAY = 1;
	var DAY = 864e5;
	var DAYS_IN_YEAR = 365;
	if (epoch1904) excelSerialDate += 4 * DAYS_IN_YEAR + JANUARY_0TH_1900_DAY + ERRONEOUS_FEBRUARY_29_1990_DAY;
	var daysBeforeUnixEpoch = JANUARY_0TH_1900_DAY + ERRONEOUS_FEBRUARY_29_1990_DAY + 70 * DAYS_IN_YEAR + NUMBER_OF_LEAP_YEARS_BETWEEN_1900_AND_1970;
	return Math.floor((excelSerialDate - daysBeforeUnixEpoch) * DAY);
}
// node_modules/read-excel-file/modules/xlsx/isDateFormat.js
var DATE_FORMAT_POSTFIX_THAT_ALLOWS_ANY_ARBITRARY_TEXT_INPUT = /;@$/;
var DATE_FORMAT_TOKEN_SPLITTER_REG_EXP = /[^a-z0#\?%]+/;
/**
* XLSX standard does have "d" type for dates, but it's not commonly used.
* Instead, `.xlsx` files use "n" type for storing both numbers and dates (as timestamps).
* So how does one tell if a cell value should be interpreted as a number or as a date?
* The answer is in the "format" that is used to "format" the cell value: if it's
* date-specific then it's a date, otherwise it's a number.
* This function tells if a given number format template represents a date rather than a number.
* @param {number} formatId
* @param {string} template
* @param {boolean?[]} dateFormatDetectionCache
* @returns {boolean}
*/
function isDateFormat(formatId, template, dateFormatDetectionCache) {
	var cachedResult = dateFormatDetectionCache[formatId];
	if (cachedResult === void 0) return dateFormatDetectionCache[formatId] = isDateFormatTemplate(template);
	return cachedResult;
}
/**
* XLSX standard does have "d" type for dates, but it's not commonly used.
* Instead, `.xlsx` files use "n" type for storing both numbers and dates (as timestamps).
* So how does one tell if a cell value should be interpreted as a number or as a date?
* The answer is in the "format" that is used to "format" the cell value: if it's
* date-specific then it's a date, otherwise it's a number.
* This function tells if a given number format template represents a date rather than a number.
* @param {string} numberFormat
* @returns {boolean}
*/
function isDateFormatTemplate(template) {
	template = template.toLowerCase();
	template = template.replace(DATE_FORMAT_POSTFIX_THAT_ALLOWS_ANY_ARBITRARY_TEXT_INPUT, "");
	template = template.replace(/\\./g, " ");
	return template.split(";").some(isDateFormatSubTemplate);
	/**
	* Tells if a given format template formats a date.
	* @param {string} template
	* @returns {boolean}
	*/
	function isDateFormatSubTemplate(template) {
		template = template.replace(/"[^"]*"/g, " ");
		template = template.replace(/(\[?[smhd]{1,2}\]?)[\.\,]00?0?/g, "$1");
		template = template.replace(/\[([smhd]{1,2})\]/g, "$1");
		template = template.replace(/\[[^\]]*\]/g, "");
		var tokens = template.split(DATE_FORMAT_TOKEN_SPLITTER_REG_EXP).filter(function(_) {
			return _;
		});
		return tokens.length === 0 ? false : tokens.every(function(token) {
			return DATE_FORMAT_TEMPLATE_TOKENS.indexOf(token) >= 0;
		});
	}
}
var DATE_FORMAT_TEMPLATE_TOKENS = [
	"s",
	"ss",
	"m",
	"mm",
	"h",
	"hh",
	"am",
	"pm",
	"a",
	"p",
	"d",
	"dd",
	"ddd",
	"dddd",
	"aaa",
	"aaaa",
	"aaaaa",
	"m",
	"mm",
	"mmm",
	"mmmm",
	"mmmmm",
	"y",
	"yy",
	"yyyy",
	"e",
	"ee",
	"eeee"
];
// node_modules/read-excel-file/modules/xlsx/isDateFormatStyle.js
function isDateFormatStyle(style, defaultDateFormat, shouldGuessDateFormatFromNumberFormatTemplate, dateFormatDetectionCache) {
	if (!style.numberFormat) return false;
	if (BUILT_IN_DATE_FORMAT_IDS.indexOf(style.numberFormat.id) >= 0 || defaultDateFormat && style.numberFormat.template === defaultDateFormat || shouldGuessDateFormatFromNumberFormatTemplate && style.numberFormat.template && isDateFormat(style.numberFormat.id, style.numberFormat.template, dateFormatDetectionCache)) return true;
	return false;
}
var LOCALE_INDEPENDENT_BUILT_IN_DATE_FORMAT_IDS = [
	14,
	15,
	16,
	17,
	18,
	19,
	20,
	21,
	22,
	45,
	46,
	47
];
var MAINLAND_CHINESE_OR_TAIWANESE_LOCALE_BUILT_IN_DATE_FORMAT_IDS = [
	27,
	28,
	29,
	30,
	31,
	32,
	33,
	34,
	35,
	36,
	50,
	51,
	52,
	53,
	54,
	55,
	56,
	57,
	58
];
var JAPANESE_OR_KOREAN_LOCALE_BUILT_IN_DATE_FORMAT_IDS = [
	27,
	28,
	29,
	30,
	31,
	32,
	33,
	34,
	35,
	36,
	50,
	51,
	52,
	53,
	54,
	55,
	56,
	57,
	58
];
var BUILT_IN_DATE_FORMAT_IDS = LOCALE_INDEPENDENT_BUILT_IN_DATE_FORMAT_IDS.concat(MAINLAND_CHINESE_OR_TAIWANESE_LOCALE_BUILT_IN_DATE_FORMAT_IDS).concat(JAPANESE_OR_KOREAN_LOCALE_BUILT_IN_DATE_FORMAT_IDS.filter(function(numberFormatId) {
	return MAINLAND_CHINESE_OR_TAIWANESE_LOCALE_BUILT_IN_DATE_FORMAT_IDS.indexOf(numberFormatId) < 0;
})).concat([
	71,
	72,
	73,
	74,
	75,
	76,
	77,
	78,
	79,
	80,
	81
].filter(function(numberFormatId) {
	return MAINLAND_CHINESE_OR_TAIWANESE_LOCALE_BUILT_IN_DATE_FORMAT_IDS.indexOf(numberFormatId) < 0;
}).filter(function(numberFormatId) {
	return JAPANESE_OR_KOREAN_LOCALE_BUILT_IN_DATE_FORMAT_IDS.indexOf(numberFormatId) < 0;
}));
// node_modules/read-excel-file/modules/xlsx/parseCell.js
function _slicedToArray$2(arr, i) {
	return _arrayWithHoles$2(arr) || _iterableToArrayLimit$2(arr, i) || _unsupportedIterableToArray$3(arr, i) || _nonIterableRest$2();
}
function _nonIterableRest$2() {
	throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _unsupportedIterableToArray$3(o, minLen) {
	if (!o) return;
	if (typeof o === "string") return _arrayLikeToArray$3(o, minLen);
	var n = Object.prototype.toString.call(o).slice(8, -1);
	if (n === "Object" && o.constructor) n = o.constructor.name;
	if (n === "Map" || n === "Set") return Array.from(o);
	if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$3(o, minLen);
}
function _arrayLikeToArray$3(arr, len) {
	if (len == null || len > arr.length) len = arr.length;
	for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
	return arr2;
}
function _iterableToArrayLimit$2(r, l) {
	var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
	if (null != t) {
		var e, n, i, u, a = [], f = !0, o = !1;
		try {
			if (i = (t = t.call(r)).next, 0 === l) {
				if (Object(t) !== t) return;
				f = !1;
			} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
		} catch (r) {
			o = !0, n = r;
		} finally {
			try {
				if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
			} finally {
				if (o) throw n;
			}
		}
		return a;
	}
}
function _arrayWithHoles$2(arr) {
	if (Array.isArray(arr)) return arr;
}
var EMPTY_CELL = [null, null];
/**
* Parses a cell from the info extracted from XML.
* @param {string} [t] — `<c t/>` attribute value (cell type). One of: b (Boolean), e (Error), n (Number), d (Date), s (String).
* @param {string} [s] — `<c s/>` attribute value (formatting style ID). When present, should be a stringified zero-based index of the formatting style for a numberic cell.
* @param {string} [v] — `<v/>` element text content (value). Will be `undefined` if the `<v/>` element absent. Will be an empty string `""` if the `<v/>` element is present but is empty.
* @param {string} [inlineString] — Inline string value.
* @param {any[]} parameters
* @returns {[string|null,string|number|boolean|null] | string} Either `[type, value]` or `error`, where `value` is the cell value, `type` depends on the type of `value` and could be one of: 's' (string), 'b' (boolean), 'n' (number string), 'd' (date timestamp), 'e' (formula cell error), `null` (null); `error` is an error message: `VALUE_MISSING`, `VALUE_INVALID`, `FORMAT_INVALID`, `TYPE_INVALID`.
*/
function parseCell(t, s, v, inlineString, _ref) {
	var _ref2 = _slicedToArray$2(_ref, 7), sharedStrings = _ref2[0], styles = _ref2[1], epoch1904 = _ref2[2], dateFormatDetectionCache = _ref2[3], defaultDateFormat = _ref2[4], dateTemplateParser = _ref2[5], parseNumberCustom = _ref2[6];
	switch (t || "n") {
		case "str":
			if (v === void 0) return "VALUE_MISSING";
			if (!v) return EMPTY_CELL;
			return ["s", v];
		case "inlineStr":
			if (inlineString === void 0) return "VALUE_MISSING";
			return ["s", inlineString];
		case "s":
			if (!v) return "VALUE_MISSING";
			var sharedStringIndex = Number(v);
			if (isNaN(sharedStringIndex) || sharedStrings[sharedStringIndex] === void 0) return "VALUE_INVALID";
			return ["s", sharedStrings[sharedStringIndex]];
		case "b":
			if (!v) return "VALUE_MISSING";
			if (v === "1") return ["b", true];
			if (v === "0") return ["b", false];
			return "VALUE_INVALID";
		case "e":
			if (!v) return "VALUE_MISSING";
			return ["e", v];
		case "d":
			if (!v) return EMPTY_CELL;
			var parsedDate = new Date(v);
			if (isNaN(parsedDate.valueOf())) return "VALUE_INVALID";
			return ["d", parsedDate.getTime()];
		case "n":
			if (!v) return EMPTY_CELL;
			if (s) {
				var styleId = Number(s);
				if (isNaN(styleId) || styles[styleId] === void 0) return "FORMAT_INVALID";
				if (isDateFormatStyle(styles[styleId], defaultDateFormat, dateTemplateParser, dateFormatDetectionCache)) {
					var timestamp = Number(v);
					if (isNaN(timestamp)) return "VALUE_INVALID";
					return ["d", parseExcelTimestamp(timestamp, epoch1904)];
				}
			}
			if (parseNumberCustom) return ["n", v];
			var number = Number(v);
			if (isNaN(number)) return "VALUE_INVALID";
			return ["n", number];
		default: return "TYPE_INVALID";
	}
}
// node_modules/read-excel-file/modules/xlsx/parseCellAddress.js
/**
* Parses cell address into a row number and a column number.
* Examples: "A1" → [1,1], "B2" → [2,2], "AA2091" → [2091, 27], "R988" → [988, 18].
* @param {string} cellAddress
* @returns {number[]} Returns `[rowNumber, columnNumber]`
*/
function parseCellAddress(cellAddress) {
	var columnNumber = 0;
	var i = 0;
	while (i < cellAddress.length) {
		var charCode = cellAddress.charCodeAt(i);
		if (charCode >= 48 && charCode <= 57) {
			var rowNumber = Number(cellAddress.slice(i));
			if (isNaN(rowNumber)) invalidCellAddress(cellAddress);
			return [rowNumber, columnNumber];
		}
		columnNumber *= 26;
		columnNumber += cellAddress.charCodeAt(i) - 64;
		i++;
	}
	invalidCellAddress(cellAddress);
}
function invalidCellAddress(cellAddress) {
	throw new Error("<c r=\"".concat(cellAddress, "\">"));
}
// node_modules/read-excel-file/modules/xlsx/parseSheet.js
function _slicedToArray$1(arr, i) {
	return _arrayWithHoles$1(arr) || _iterableToArrayLimit$1(arr, i) || _unsupportedIterableToArray$2(arr, i) || _nonIterableRest$1();
}
function _nonIterableRest$1() {
	throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _iterableToArrayLimit$1(r, l) {
	var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
	if (null != t) {
		var e, n, i, u, a = [], f = !0, o = !1;
		try {
			if (i = (t = t.call(r)).next, 0 === l) {
				if (Object(t) !== t) return;
				f = !1;
			} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
		} catch (r) {
			o = !0, n = r;
		} finally {
			try {
				if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
			} finally {
				if (o) throw n;
			}
		}
		return a;
	}
}
function _arrayWithHoles$1(arr) {
	if (Array.isArray(arr)) return arr;
}
function _createForOfIteratorHelperLoose$2(o, allowArrayLike) {
	var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
	if (it) return (it = it.call(o)).next.bind(it);
	if (Array.isArray(o) || (it = _unsupportedIterableToArray$2(o)) || allowArrayLike && o && typeof o.length === "number") {
		if (it) o = it;
		var i = 0;
		return function() {
			if (i >= o.length) return { done: true };
			return {
				done: false,
				value: o[i++]
			};
		};
	}
	throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _unsupportedIterableToArray$2(o, minLen) {
	if (!o) return;
	if (typeof o === "string") return _arrayLikeToArray$2(o, minLen);
	var n = Object.prototype.toString.call(o).slice(8, -1);
	if (n === "Object" && o.constructor) n = o.constructor.name;
	if (n === "Map" || n === "Set") return Array.from(o);
	if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$2(o, minLen);
}
function _arrayLikeToArray$2(arr, len) {
	if (len == null || len > arr.length) len = arr.length;
	for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
	return arr2;
}
var EMPTY_CELL_VALUE$1 = null;
/**
* Parses a `sheet.xml` file.
* @param {string} content
* @param {function} parseXml — SAX XML parser.
* @param {object} options
* @returns {Promise<SheetData>}
*/
function parseSheet$1(content, parseXml, _ref) {
	var sharedStrings = _ref.sharedStrings, styles = _ref.styles, epoch1904 = _ref.epoch1904, dateFormatDetectionCache = _ref.dateFormatDetectionCache, options = _ref.options;
	var parseCellParameters = [
		sharedStrings,
		styles,
		epoch1904,
		dateFormatDetectionCache,
		options.dateFormat,
		options.smartDateParser !== false,
		options.parseNumber
	];
	var rows = [];
	var errors = [];
	var state = createInitialState();
	return parseXml(content, state, onOpenTag, onCloseTag, onText, onProgress).then(function() {
		var _state$sheetData = state.sheetData, rowCount = _state$sheetData.rowCount, columnCount = _state$sheetData.columnCount, dataRowCount = _state$sheetData.dataRowCount, dataColumnCount = _state$sheetData.dataColumnCount;
		if (dataRowCount < rowCount) rows = rows.slice(0, dataRowCount);
		if (dataColumnCount < columnCount) {
			var i = 0;
			while (i < rows.length) {
				if (rows[i].length > dataColumnCount) rows[i] = rows[i].slice(0, dataColumnCount);
				i++;
			}
		}
		for (var _iterator = _createForOfIteratorHelperLoose$2(rows), _step; !(_step = _iterator()).done;) {
			var row = _step.value;
			while (row.length < dataColumnCount) row.push(EMPTY_CELL_VALUE$1);
		}
		return rows;
	});
	function createInitialState() {
		return {
			dimension: void 0,
			sheetData: void 0
		};
	}
	function getRowsFromState(state) {
		return state.sheetData.rows;
	}
	function setRowsInState(state, rows) {
		state.sheetData.rowIndexShift += state.sheetData.rows.length - rows.length;
		state.sheetData.rows = rows;
	}
	function getErrorsFromState(state) {
		return state.sheetData.errors;
	}
	function setErrorsInState(state, errors) {
		state.sheetData.errors = errors;
	}
	function throwInvalidCellError(_ref2) {
		var row = _ref2.row, column = _ref2.column, error = _ref2.error;
		throw new InvalidSpreadsheetError("<c/> at row ".concat(row, ", col ").concat(column, ": ").concat(error));
	}
	function onProgress(end) {
		if (!state.sheetData) return;
		var rowsRead = getRowsFromState(state);
		var errorsEncountered = getErrorsFromState(state);
		if (end) {
			rows = rows.concat(rowsRead);
			errors = errors.concat(errorsEncountered);
			if (errors.length > 0) throwInvalidCellError(errors[0]);
		} else if (rowsRead.length > 1) {
			var finalizedRows = rowsRead.slice(0, -1);
			rows = rows.concat(finalizedRows);
			errors = errors.concat(errorsEncountered);
			setRowsInState(state, rowsRead.slice(-1));
			setErrorsInState(state, []);
		}
	}
	function onOpenTag(tagName, attributes, state) {
		if (tagName === "dimension") state.dimension = parseSheetDimensionRef(attributes.ref);
		else if (tagName === "sheetData") state.sheetData = createInitialStateInSheetData();
		else if (state.sheetData) onOpenTagInSheetData(tagName, attributes, state.sheetData);
	}
	function onCloseTag(tagName, state) {
		if (state.sheetData) onCloseTagInSheetData(tagName, state.sheetData);
	}
	function onText(text, state) {
		if (state.sheetData) onTextInSheetData(text, state.sheetData);
	}
	/**
	* Sheet "dimension" defines the spreadsheet area containing all non-empty cells.
	* Any cells outside the "dimension" are considered empty and should be ignored.
	* https://docs.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.sheetdimension?view=openxml-2.8.1
	* @param {string} `ref` — The value of `<dimension ref/>` attribute.
	* @returns {[[number,number],[number,number]]} `undefined` or `[{ row, column }, { row, column }]` — "From row number and column number to row number and column number".
	*/
	function parseSheetDimensionRef(ref) {
		var dimensions = ref.split(":").map(parseCellAddress);
		if (dimensions.length === 1) dimensions = [dimensions[0], dimensions[0]];
		return dimensions;
	}
	function createInitialStateInSheetData() {
		return {
			c: void 0,
			rows: [],
			row: void 0,
			rowNumber: void 0,
			rowIndexShift: 0,
			cursor: [0, 0],
			rowCount: 0,
			columnCount: 0,
			dataRowCount: 0,
			dataColumnCount: 0,
			errors: []
		};
	}
	function onOpenTagInSheetData(tagName, attributes, state) {
		if (tagName === "row") {
			if (attributes.r) state.rowNumber = Number(attributes.r);
			state.row = [];
		} else if (tagName === "c") {
			state.c = createInitialStateInCell();
			state.c.attributes = attributes;
		} else if (state.c) onOpenTagInCell(tagName, attributes, state.c);
	}
	function onCloseTagInSheetData(tagName, state) {
		if (tagName === "row") {
			if (state.rowNumber) {
				var previousRowNumber = state.rowIndexShift + state.rows.length;
				if (state.rowNumber <= previousRowNumber) throw new InvalidSpreadsheetError("Out-of-place <row/> number ".concat(state.rowNumber, " follows <row/> number ").concat(previousRowNumber));
				while (state.rowNumber > state.rowIndexShift + state.rows.length + 1) state.rows.push([]);
			}
			state.rows.push(state.row);
			if (state.row.length > 0) state.dataRowCount = state.rowNumber;
			if (state.rowNumber > state.rowCount) state.rowCount = state.rowNumber;
			state.row = void 0;
			state.rowNumber = void 0;
		} else if (tagName === "c") {
			var cell = parseCellFromXmlData(state.c);
			if (cell.row < state.cursor[0] || cell.row === state.cursor[0] && cell.column <= state.cursor[1]) throw new InvalidSpreadsheetError("Out-of-place <c/> at row ".concat(cell.row, " col ").concat(cell.column, " follows <c/> at row ").concat(state.cursor[0], " col ").concat(state.cursor[1]));
			state.cursor[0] = cell.row;
			state.cursor[1] = cell.column;
			if (!state.rowNumber) state.rowNumber = cell.row;
			if (cell.error) {
				if (THROW_ON_FIRST_CELL_ERROR) throwInvalidCellError(cell);
				state.errors.push(cell);
			} else if (cell.value !== EMPTY_CELL_VALUE$1) {
				while (cell.column > state.row.length + 1) state.row.push(EMPTY_CELL_VALUE$1);
				state.row.push(cell.value);
				if (cell.column > state.dataColumnCount) state.dataColumnCount = cell.column;
			}
			if (cell.column > state.columnCount) state.columnCount = cell.column;
			state.c = void 0;
		} else if (state.c) onCloseTagInCell(tagName, state.c);
	}
	function onTextInSheetData(text, state) {
		if (state.c) onTextInCell(text, state.c);
	}
	/**
	* Parses the XML values of a `<c/>` element into an object representing a cell value.
	* @param {object} — `{ attributes: Record<string,string>, inlineString?: string, vText?: string }`. If `<v/>` element is present but is empty, `vText` will be an empty string. If `<v/>` element is absent, `vText` will be `undefined`.
	* @returns {object} Either `{ row: number, column: number, error: string }` or `{ row: number, column: number, value: string|number|boolean|null }`
	*/
	function parseCellFromXmlData(_ref3) {
		var attributes = _ref3.attributes, inlineString = _ref3.inlineString, vText = _ref3.vText;
		var _parseCellAddress2 = _slicedToArray$1(parseCellAddress(attributes.r), 2), row = _parseCellAddress2[0], column = _parseCellAddress2[1];
		var errorOrTypeAndValue = parseCellAndTrimValue(attributes.t, attributes.s, vText, inlineString, parseCellParameters, options.trim !== false);
		if (typeof errorOrTypeAndValue === "string") return {
			row,
			column,
			error: errorOrTypeAndValue
		};
		return {
			row,
			column,
			value: parseCellValue(errorOrTypeAndValue[1], errorOrTypeAndValue[0])
		};
	}
	/**
	* Parses a cell from the info extracted from the cell XML.
	* If the cell is of type string, it trims the value (by default).
	*
	* Receives same arguments as `parseCell()` function, with an additional argument
	* `trimStrings: boolean` which tells if it should trim any string values.
	*
	* Produces same result as `parseCell()` function, except for cells of type "e".
	*/
	function parseCellAndTrimValue(t, s, v, inlineString, parameters, trimStrings) {
		var errorOrTypeAndValue = parseCellWithRepairAbility(t, s, v, inlineString, parameters);
		if (Array.isArray(errorOrTypeAndValue) && errorOrTypeAndValue[0] === "s") {
			if (trimStrings) errorOrTypeAndValue[1] = errorOrTypeAndValue[1].trim();
			if (errorOrTypeAndValue[1] === "") return EMPTY_CELL;
		}
		return errorOrTypeAndValue;
	}
	/**
	* Parses cell value and optionally repairs any repairable errors.
	* Receives same arguments as `parseCell()` function.
	* Produces same result as `parseCell()` function, except for cells of type "e".
	*/
	function parseCellWithRepairAbility(t, s, v, inlineString, parameters) {
		var errorOrTypeAndValue = parseCell(t, s, v, inlineString, parameters);
		if (errorOrTypeAndValue === "VALUE_MISSING") switch (t || "n") {
			case "str":
			case "inlineStr":
			case "s":
			case "b": return EMPTY_CELL;
		}
		if (t === "e") return EMPTY_CELL;
		return errorOrTypeAndValue;
	}
	/**
	* For certain types of cell, it transforms the value.
	* Specifically, for cells of type "n" or "d", it transforms the value to `Number` or `Date` respectively.
	*
	* The reason it is done separately is because before this function is called,
	* the cells are easily "serializable". And after this function is called,
	* some of the cells' `value` properties become instances of `Date` class or any other class,
	* such as `BigInt`, serializing which would require additional manual steps to be performed.
	* Serializing cells could be utilized in case of "transferring" data between workers
	* with a `transferList`, argument which could hypothetically result in better performance
	* and less time being blocked by the "synchronous" JSON serialization.
	*
	* @param {string|number|boolean|null} value
	* @param {string} type — One of: "s", "n", "d", "b", "-"
	* @return {string|ParsedNumber|Date|boolean|null}
	*/
	function parseCellValue(value, type) {
		if (type === "n") {
			if (options.parseNumber) return options.parseNumber(value);
			return value;
		} else if (type === "d") return new Date(value);
		else return value;
	}
	function createInitialStateInCell() {
		return {
			v: false,
			is: false,
			t: false,
			r: false,
			rPh: false,
			vText: void 0,
			inlineString: void 0,
			attributes: void 0
		};
	}
	function onOpenTagInCell(tagName, attributes, state) {
		if (tagName === "v") state.v = true;
		else if (tagName === "is") {
			state.is = true;
			state.inlineString = "";
		} else if (tagName === "t") state.t = true;
		else if (tagName === "r") state.r = true;
		else if (tagName === "rPh") state.rPh = true;
	}
	function onCloseTagInCell(tagName, state) {
		if (tagName === "v") {
			state.v = false;
			state.vText || (state.vText = "");
			if (state.attributes.t === "str") state.vText = unescapeXlsxString(state.vText);
		} else if (tagName === "is") {
			state.is = false;
			state.inlineString = unescapeXlsxString(state.inlineString);
		} else if (tagName === "t") state.t = false;
		else if (tagName === "r") state.r = false;
		else if (tagName === "rPh") state.rPh = false;
	}
	function onTextInCell(text, state) {
		if (state.v) state.vText = text;
		else if (state.is) {
			if (state.rPh) {} else if (state.t) {
				if (state.r) state.inlineString += text;
				else state.inlineString = text;
			}
		}
	}
	var THROW_ON_FIRST_CELL_ERROR;
}
// node_modules/fflate/esm/index.mjs
var require$1 = createRequire$1("/");
var _a;
try {
	_a = require$1("worker_threads"), _a.Worker, _a.isMarkedAsUntransferable;
} catch (e) {}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	1,
	1,
	1,
	1,
	2,
	2,
	2,
	2,
	3,
	3,
	3,
	3,
	4,
	4,
	4,
	4,
	5,
	5,
	5,
	5,
	0,
	0,
	0,
	0
]);
var fdeb = new u8([
	0,
	0,
	0,
	0,
	1,
	1,
	2,
	2,
	3,
	3,
	4,
	4,
	5,
	5,
	6,
	6,
	7,
	7,
	8,
	8,
	9,
	9,
	10,
	10,
	11,
	11,
	12,
	12,
	13,
	13,
	0,
	0
]);
new u8([
	16,
	17,
	18,
	0,
	8,
	7,
	9,
	6,
	10,
	5,
	11,
	4,
	12,
	3,
	13,
	2,
	14,
	1,
	15
]);
var freb = function(eb, start) {
	var b = new u16(31);
	for (var i = 0; i < 31; ++i) b[i] = start += 1 << eb[i - 1];
	var r = new i32(b[30]);
	for (var i = 1; i < 30; ++i) for (var j = b[i]; j < b[i + 1]; ++j) r[j] = j - b[i] << 5 | i;
	return {
		b,
		r
	};
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
_b.b;
_b.r;
var rev = new u16(32768);
for (var i = 0; i < 32768; ++i) {
	var x = (i & 43690) >> 1 | (i & 21845) << 1;
	x = (x & 52428) >> 2 | (x & 13107) << 2;
	x = (x & 61680) >> 4 | (x & 3855) << 4;
	rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var flt = new u8(288);
for (var i = 0; i < 144; ++i) flt[i] = 8;
for (var i = 144; i < 256; ++i) flt[i] = 9;
for (var i = 256; i < 280; ++i) flt[i] = 7;
for (var i = 280; i < 288; ++i) flt[i] = 8;
var fdt = new u8(32);
for (var i = 0; i < 32; ++i) fdt[i] = 5;
var slc = function(v, s, e) {
	if (s == null || s < 0) s = 0;
	if (e == null || e > v.length) e = v.length;
	return new u8(v.subarray(s, e));
};
var ec = [
	"unexpected EOF",
	"invalid block type",
	"invalid length/literal",
	"invalid distance",
	"stream finished",
	"no stream handler",
	,
	"no callback",
	"invalid UTF-8 data",
	"extra field too long",
	"date not in range 1980-2099",
	"filename too long",
	"stream finishing",
	"invalid zip data"
];
var err = function(ind, msg, nt) {
	var e = new Error(msg || ec[ind]);
	e.code = ind;
	if (Error.captureStackTrace) Error.captureStackTrace(e, err);
	if (!nt) throw e;
	return e;
};
var et = /*#__PURE__*/ new u8(0);
var td = typeof TextDecoder != "undefined" && /*#__PURE__*/ new TextDecoder();
try {
	td.decode(et, { stream: true });
} catch (e) {}
var dutf8 = function(d) {
	for (var r = "", i = 0;;) {
		var c = d[i++];
		var eb = (c > 127) + (c > 223) + (c > 239);
		if (i + eb > d.length) return {
			s: r,
			r: slc(d, i - 1)
		};
		if (!eb) r += String.fromCharCode(c);
		else if (eb == 3) c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
		else if (eb & 1) r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
		else r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
	}
};
/**
* Converts a Uint8Array to a string
* @param dat The data to decode to string
* @param latin1 Whether or not to interpret the data as Latin-1. This should
*               not need to be true unless encoding to binary string.
* @returns The original UTF-8/Latin-1 string
*/
function strFromU8$1(dat, latin1) {
	if (latin1) {
		var r = "";
		for (var i = 0; i < dat.length; i += 16384) r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
		return r;
	} else if (td) return td.decode(dat);
	else {
		var _a = dutf8(dat), s = _a.s, r = _a.r;
		if (r.length) err(8);
		return s;
	}
}
// node_modules/read-excel-file/modules/utility/convertValuesFromUint8ArraysToStrings.js
/**
* @param {Record<string,Uint8Array} entries
* @returns {Record<string,string>}
*/
function convertValuesFromUint8ArraysToStrings(entries) {
	checkpoint("convert files to strings");
	var convertedEntries = {};
	for (var _i = 0, _Object$keys = Object.keys(entries); _i < _Object$keys.length; _i++) {
		var key = _Object$keys[_i];
		convertedEntries[key] = strFromU8(entries[key]);
	}
	return convertedEntries;
}
/**
* Converts a Uint8Array to a string
* @param data The data to decode to string
* @param latin1 Whether or not to interpret the data as Latin-1. This should
*               not need to be true unless encoding to binary string.
* @returns The original UTF-8/Latin-1 string
*/
function strFromU8(data) {
	if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(data);
	else return strFromU8$1(data);
}
// node_modules/read-excel-file/modules/utility/isPromise.js
function _typeof$5(o) {
	"@babel/helpers - typeof";
	return _typeof$5 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$5(o);
}
function isPromise(anything) {
	return _typeof$5(anything) === "object" && typeof anything.then === "function";
}
// node_modules/read-excel-file/modules/xlsx/SheetNotFoundError.js
function _typeof$4(o) {
	"@babel/helpers - typeof";
	return _typeof$4 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$4(o);
}
function _defineProperties$1(target, props) {
	for (var i = 0; i < props.length; i++) {
		var descriptor = props[i];
		descriptor.enumerable = descriptor.enumerable || false;
		descriptor.configurable = true;
		if ("value" in descriptor) descriptor.writable = true;
		Object.defineProperty(target, _toPropertyKey$4(descriptor.key), descriptor);
	}
}
function _createClass$1(Constructor, protoProps, staticProps) {
	if (protoProps) _defineProperties$1(Constructor.prototype, protoProps);
	if (staticProps) _defineProperties$1(Constructor, staticProps);
	Object.defineProperty(Constructor, "prototype", { writable: false });
	return Constructor;
}
function _toPropertyKey$4(arg) {
	var key = _toPrimitive$4(arg, "string");
	return _typeof$4(key) === "symbol" ? key : String(key);
}
function _toPrimitive$4(input, hint) {
	if (_typeof$4(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$4(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _classCallCheck$1(instance, Constructor) {
	if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _inherits$1(subClass, superClass) {
	if (typeof superClass !== "function" && superClass !== null) throw new TypeError("Super expression must either be null or a function");
	subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: {
		value: subClass,
		writable: true,
		configurable: true
	} });
	Object.defineProperty(subClass, "prototype", { writable: false });
	if (superClass) _setPrototypeOf$1(subClass, superClass);
}
function _createSuper$1(Derived) {
	var hasNativeReflectConstruct = _isNativeReflectConstruct$1();
	return function _createSuperInternal() {
		var Super = _getPrototypeOf$1(Derived), result;
		if (hasNativeReflectConstruct) {
			var NewTarget = _getPrototypeOf$1(this).constructor;
			result = Reflect.construct(Super, arguments, NewTarget);
		} else result = Super.apply(this, arguments);
		return _possibleConstructorReturn$1(this, result);
	};
}
function _possibleConstructorReturn$1(self, call) {
	if (call && (_typeof$4(call) === "object" || typeof call === "function")) return call;
	else if (call !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
	return _assertThisInitialized$1(self);
}
function _assertThisInitialized$1(self) {
	if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return self;
}
function _wrapNativeSuper$1(Class) {
	var _cache = typeof Map === "function" ? /* @__PURE__ */ new Map() : void 0;
	_wrapNativeSuper$1 = function _wrapNativeSuper(Class) {
		if (Class === null || !_isNativeFunction$1(Class)) return Class;
		if (typeof Class !== "function") throw new TypeError("Super expression must either be null or a function");
		if (typeof _cache !== "undefined") {
			if (_cache.has(Class)) return _cache.get(Class);
			_cache.set(Class, Wrapper);
		}
		function Wrapper() {
			return _construct$1(Class, arguments, _getPrototypeOf$1(this).constructor);
		}
		Wrapper.prototype = Object.create(Class.prototype, { constructor: {
			value: Wrapper,
			enumerable: false,
			writable: true,
			configurable: true
		} });
		return _setPrototypeOf$1(Wrapper, Class);
	};
	return _wrapNativeSuper$1(Class);
}
function _construct$1(Parent, args, Class) {
	if (_isNativeReflectConstruct$1()) _construct$1 = Reflect.construct.bind();
	else _construct$1 = function _construct(Parent, args, Class) {
		var a = [null];
		a.push.apply(a, args);
		var instance = new (Function.bind.apply(Parent, a))();
		if (Class) _setPrototypeOf$1(instance, Class.prototype);
		return instance;
	};
	return _construct$1.apply(null, arguments);
}
function _isNativeReflectConstruct$1() {
	if (typeof Reflect === "undefined" || !Reflect.construct) return false;
	if (Reflect.construct.sham) return false;
	if (typeof Proxy === "function") return true;
	try {
		Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
		return true;
	} catch (e) {
		return false;
	}
}
function _isNativeFunction$1(fn) {
	return Function.toString.call(fn).indexOf("[native code]") !== -1;
}
function _setPrototypeOf$1(o, p) {
	_setPrototypeOf$1 = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf(o, p) {
		o.__proto__ = p;
		return o;
	};
	return _setPrototypeOf$1(o, p);
}
function _getPrototypeOf$1(o) {
	_getPrototypeOf$1 = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf(o) {
		return o.__proto__ || Object.getPrototypeOf(o);
	};
	return _getPrototypeOf$1(o);
}
var SheetNotFoundError = /*#__PURE__*/ function(_Error) {
	_inherits$1(SheetNotFoundError, _Error);
	var _super = _createSuper$1(SheetNotFoundError);
	function SheetNotFoundError(sheet, sheets) {
		var _this;
		_classCallCheck$1(this, SheetNotFoundError);
		_this = _super.call(this, "Sheet not found: ".concat(typeof sheet === "number" ? sheet + ". Sheet count: " + sheets.length : sheet + ". Available sheets: " + sheets.join(", ")));
		_this.name = "SheetNotFoundError";
		_this.sheet = sheet;
		_this.sheets = sheets;
		return _this;
	}
	return _createClass$1(SheetNotFoundError);
}(/*#__PURE__*/ _wrapNativeSuper$1(Error));
// node_modules/read-excel-file/modules/xlsx/parseSpreadsheetContents.js
function _typeof$3(o) {
	"@babel/helpers - typeof";
	return _typeof$3 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$3(o);
}
function _createForOfIteratorHelperLoose$1(o, allowArrayLike) {
	var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
	if (it) return (it = it.call(o)).next.bind(it);
	if (Array.isArray(o) || (it = _unsupportedIterableToArray$1(o)) || allowArrayLike && o && typeof o.length === "number") {
		if (it) o = it;
		var i = 0;
		return function() {
			if (i >= o.length) return { done: true };
			return {
				done: false,
				value: o[i++]
			};
		};
	}
	throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _unsupportedIterableToArray$1(o, minLen) {
	if (!o) return;
	if (typeof o === "string") return _arrayLikeToArray$1(o, minLen);
	var n = Object.prototype.toString.call(o).slice(8, -1);
	if (n === "Object" && o.constructor) n = o.constructor.name;
	if (n === "Map" || n === "Set") return Array.from(o);
	if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$1(o, minLen);
}
function _arrayLikeToArray$1(arr, len) {
	if (len == null || len > arr.length) len = arr.length;
	for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
	return arr2;
}
function ownKeys$2(e, r) {
	var t = Object.keys(e);
	if (Object.getOwnPropertySymbols) {
		var o = Object.getOwnPropertySymbols(e);
		r && (o = o.filter(function(r) {
			return Object.getOwnPropertyDescriptor(e, r).enumerable;
		})), t.push.apply(t, o);
	}
	return t;
}
function _objectSpread$2(e) {
	for (var r = 1; r < arguments.length; r++) {
		var t = null != arguments[r] ? arguments[r] : {};
		r % 2 ? ownKeys$2(Object(t), !0).forEach(function(r) {
			_defineProperty$2(e, r, t[r]);
		}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys$2(Object(t)).forEach(function(r) {
			Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
		});
	}
	return e;
}
function _defineProperty$2(obj, key, value) {
	key = _toPropertyKey$3(key);
	if (key in obj) Object.defineProperty(obj, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true
	});
	else obj[key] = value;
	return obj;
}
function _toPropertyKey$3(arg) {
	var key = _toPrimitive$3(arg, "string");
	return _typeof$3(key) === "symbol" ? key : String(key);
}
function _toPrimitive$3(input, hint) {
	if (_typeof$3(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$3(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
/**
* Reads data from an `.xlsx` file.
* @param  {function} parseXml — SAX XML parser.
* @param  {Record<string,Uint8Array>} contents - A map of `.xml` files inside the `.xlsx` file (which itself is just a zipped directory).
* @param  {object} [options]
* @return {Promise<Sheet[]>}
*/
function parseSpreadsheetContents(parseXml, contents_) {
	var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
	var contents = convertValuesFromUint8ArraysToStrings(contents_);
	checkpoint("parse spreadsheet info and file paths");
	return readFiles(getXmlFilesAtFixedPaths(), contents, parseXml).then(function(_ref) {
		var spreadsheetInfo = _ref.spreadsheetInfo, filePaths = _ref.filePaths;
		checkpoint("parse \"shared strings\" and \"styles\"");
		return readFiles(getXmlFilesAtNonFixedPaths(filePaths), contents, parseXml).then(function(_ref2) {
			var sharedStrings = _ref2.sharedStrings, styles = _ref2.styles;
			var sheetRelationIdsToRead = options.sheets ? options.sheets.map(function(sheet) {
				return getSheetRelationId(sheet, spreadsheetInfo.sheets);
			}) : spreadsheetInfo.sheets.map(function(_) {
				return _.relationId;
			});
			checkpoint("parse sheet".concat(sheetRelationIdsToRead.length === 1 ? "" : "s", " data"));
			return readFiles(getSheetDataXmlFiles(filePaths, sheetRelationIdsToRead, {
				sharedStrings,
				styles,
				epoch1904: spreadsheetInfo.epoch1904,
				dateFormatDetectionCache: [],
				options
			}), contents, parseXml).then(function(sheetsData) {
				checkpoint("end");
				return sheetRelationIdsToRead.map(function(sheetRelationId) {
					return {
						sheet: getSheetNameByRelationId(sheetRelationId, spreadsheetInfo.sheets),
						data: sheetsData[sheetRelationId]
					};
				});
			});
		});
	});
}
/**
* Reads data from an `.xlsx` file in a worker.
* @param  {function} [createWorkerFunction] — Creates a worker function. Not used.
* @param  {function} parseXml — SAX XML parser.
* @param  {Record<string,Uint8Array>} contents - A map of `.xml` files inside the `.xlsx` file (which itself is just a zipped directory).
* @param  {object} [options]
* @return {Promise<Sheet[]>}
*/
function parseSpreadsheetContentsInWorker(createWorkerFunction, parseXml, contents, options) {
	if (!(options && options.parseNumber)) options = _objectSpread$2(_objectSpread$2({}, options), {}, { parseNumber: null });
	return parseSpreadsheetContents(parseXml, contents, options);
}
function getSheetRelationId(sheet, sheets) {
	if (typeof sheet === "string") for (var _iterator = _createForOfIteratorHelperLoose$1(sheets), _step; !(_step = _iterator()).done;) {
		var _sheet = _step.value;
		if (_sheet.name === sheet) return _sheet.relationId;
	}
	else if (sheet <= sheets.length) return sheets[sheet - 1].relationId;
	throw new SheetNotFoundError(sheet, sheets.map(function(_) {
		return _.name;
	}));
}
function getSheetNameByRelationId(sheetRelationId, sheets) {
	for (var _iterator2 = _createForOfIteratorHelperLoose$1(sheets), _step2; !(_step2 = _iterator2()).done;) {
		var sheet = _step2.value;
		if (sheet.relationId === sheetRelationId) return sheet.name;
	}
	throw new Error("Sheet relation ID not found: ".concat(sheetRelationId));
}
function getXmlFilesAtFixedPaths() {
	return {
		"xl/_rels/workbook.xml.rels": {
			name: "filePaths",
			parse: parseFilePaths
		},
		"xl/workbook.xml": {
			name: "spreadsheetInfo",
			parse: parseSpreadsheetInfo
		}
	};
}
function getXmlFilesAtNonFixedPaths(filePaths) {
	var _ref3 = {};
	return _defineProperty$2(_ref3, filePaths.sharedStrings || "xl/sharedStrings.xml", {
		name: "sharedStrings",
		parse: parseSharedStrings,
		fallback: Promise.resolve([])
	}), _defineProperty$2(_ref3, filePaths.styles || "xl/styles.xml", {
		name: "styles",
		parse: parseStyles,
		fallback: {}
	}), _ref3;
}
function getSheetDataXmlFiles(filePaths, sheetRelationIdsToRead, sheetDataParserParameters) {
	return Object.keys(filePaths.sheets).filter(function(sheetRelationId) {
		return sheetRelationIdsToRead.includes(sheetRelationId);
	}).reduce(function(filesInfo, sheetRelationId) {
		return _objectSpread$2(_objectSpread$2({}, filesInfo), {}, _defineProperty$2({}, filePaths.sheets[sheetRelationId], {
			name: sheetRelationId,
			parse: function parse(content, parseXml) {
				return parseSheet$1(content, parseXml, sheetDataParserParameters);
			}
		}));
	}, {});
}
function readFiles(filesInfo, contents, parseXml) {
	var results = {};
	var _loop = function _loop() {
		var filePath = _Object$keys[_i];
		var fileInfo = filesInfo[filePath];
		results[fileInfo.name] = contents[filePath] === void 0 ? fileInfo.fallback === void 0 ? function() {
			throw new InvalidSpreadsheetError("\"".concat(filePath, "\" file not found inside the `.xlsx` file"));
		}() : fileInfo.fallback : fileInfo.parse(contents[filePath], parseXml);
	};
	for (var _i = 0, _Object$keys = Object.keys(filesInfo); _i < _Object$keys.length; _i++) _loop();
	var promises = [];
	var _loop2 = function _loop2() {
		var name = _Object$keys2[_i2];
		if (isPromise(results[name])) promises.push(results[name].then(function(result) {
			results[name] = result;
		}));
	};
	for (var _i2 = 0, _Object$keys2 = Object.keys(results); _i2 < _Object$keys2.length; _i2++) _loop2();
	if (promises.length > 0) return Promise.all(promises).then(function() {
		return results;
	});
	return results;
}
// node_modules/read-excel-file/modules/utility/isObject.js
var objectConstructor = {}.constructor;
function isObject(object) {
	return object !== void 0 && object !== null && object.constructor === objectConstructor;
}
// node_modules/read-excel-file/modules/parseSheetData/normalizeSchemaEntry.js
/**
* Normalizes a schema entry: determines if it's a schema of a property or a schema of a nested object.
* @param {object} schemaEntry — Non-normalized schema entry
* @returns {object} Normalized schema entry
*/
function normalizeSchemaEntry(schemaEntry) {
	if (typeof schemaEntry === "string") return { column: schemaEntry };
	if (typeof schemaEntry.column === "string") return schemaEntry;
	if (isObject(schemaEntry.schema)) return schemaEntry;
	return { schema: schemaEntry };
}
// node_modules/read-excel-file/modules/parseSheetData/InvalidError.js
function _typeof$2(o) {
	"@babel/helpers - typeof";
	return _typeof$2 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$2(o);
}
function _defineProperties(target, props) {
	for (var i = 0; i < props.length; i++) {
		var descriptor = props[i];
		descriptor.enumerable = descriptor.enumerable || false;
		descriptor.configurable = true;
		if ("value" in descriptor) descriptor.writable = true;
		Object.defineProperty(target, _toPropertyKey$2(descriptor.key), descriptor);
	}
}
function _createClass(Constructor, protoProps, staticProps) {
	if (protoProps) _defineProperties(Constructor.prototype, protoProps);
	if (staticProps) _defineProperties(Constructor, staticProps);
	Object.defineProperty(Constructor, "prototype", { writable: false });
	return Constructor;
}
function _toPropertyKey$2(arg) {
	var key = _toPrimitive$2(arg, "string");
	return _typeof$2(key) === "symbol" ? key : String(key);
}
function _toPrimitive$2(input, hint) {
	if (_typeof$2(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$2(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _classCallCheck(instance, Constructor) {
	if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _inherits(subClass, superClass) {
	if (typeof superClass !== "function" && superClass !== null) throw new TypeError("Super expression must either be null or a function");
	subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: {
		value: subClass,
		writable: true,
		configurable: true
	} });
	Object.defineProperty(subClass, "prototype", { writable: false });
	if (superClass) _setPrototypeOf(subClass, superClass);
}
function _createSuper(Derived) {
	var hasNativeReflectConstruct = _isNativeReflectConstruct();
	return function _createSuperInternal() {
		var Super = _getPrototypeOf(Derived), result;
		if (hasNativeReflectConstruct) {
			var NewTarget = _getPrototypeOf(this).constructor;
			result = Reflect.construct(Super, arguments, NewTarget);
		} else result = Super.apply(this, arguments);
		return _possibleConstructorReturn(this, result);
	};
}
function _possibleConstructorReturn(self, call) {
	if (call && (_typeof$2(call) === "object" || typeof call === "function")) return call;
	else if (call !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
	return _assertThisInitialized(self);
}
function _assertThisInitialized(self) {
	if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	return self;
}
function _wrapNativeSuper(Class) {
	var _cache = typeof Map === "function" ? /* @__PURE__ */ new Map() : void 0;
	_wrapNativeSuper = function _wrapNativeSuper(Class) {
		if (Class === null || !_isNativeFunction(Class)) return Class;
		if (typeof Class !== "function") throw new TypeError("Super expression must either be null or a function");
		if (typeof _cache !== "undefined") {
			if (_cache.has(Class)) return _cache.get(Class);
			_cache.set(Class, Wrapper);
		}
		function Wrapper() {
			return _construct(Class, arguments, _getPrototypeOf(this).constructor);
		}
		Wrapper.prototype = Object.create(Class.prototype, { constructor: {
			value: Wrapper,
			enumerable: false,
			writable: true,
			configurable: true
		} });
		return _setPrototypeOf(Wrapper, Class);
	};
	return _wrapNativeSuper(Class);
}
function _construct(Parent, args, Class) {
	if (_isNativeReflectConstruct()) _construct = Reflect.construct.bind();
	else _construct = function _construct(Parent, args, Class) {
		var a = [null];
		a.push.apply(a, args);
		var instance = new (Function.bind.apply(Parent, a))();
		if (Class) _setPrototypeOf(instance, Class.prototype);
		return instance;
	};
	return _construct.apply(null, arguments);
}
function _isNativeReflectConstruct() {
	if (typeof Reflect === "undefined" || !Reflect.construct) return false;
	if (Reflect.construct.sham) return false;
	if (typeof Proxy === "function") return true;
	try {
		Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
		return true;
	} catch (e) {
		return false;
	}
}
function _isNativeFunction(fn) {
	return Function.toString.call(fn).indexOf("[native code]") !== -1;
}
function _setPrototypeOf(o, p) {
	_setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf(o, p) {
		o.__proto__ = p;
		return o;
	};
	return _setPrototypeOf(o, p);
}
function _getPrototypeOf(o) {
	_getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf(o) {
		return o.__proto__ || Object.getPrototypeOf(o);
	};
	return _getPrototypeOf(o);
}
var InvalidError = /*#__PURE__*/ function(_Error) {
	_inherits(InvalidError, _Error);
	var _super = _createSuper(InvalidError);
	function InvalidError(reason) {
		var _this;
		_classCallCheck(this, InvalidError);
		_this = _super.call(this, "invalid");
		_this.reason = reason;
		return _this;
	}
	return _createClass(InvalidError);
}(/*#__PURE__*/ _wrapNativeSuper(Error));
// node_modules/read-excel-file/modules/parseSheetData/types/Number.js
function NumberType(value) {
	if (typeof value === "string") {
		var stringifiedValue = value;
		value = Number(value);
		if (String(value) !== stringifiedValue) throw new InvalidError("not_a_number");
	}
	if (typeof value !== "number") throw new InvalidError("not_a_number");
	if (isNaN(value)) throw new InvalidError("invalid_number");
	if (!isFinite(value)) throw new InvalidError("out_of_bounds");
	return value;
}
// node_modules/read-excel-file/modules/parseSheetData/types/String.js
function StringType(value) {
	if (typeof value === "string") return value;
	if (typeof value === "number") {
		if (isNaN(value)) throw new InvalidError("invalid_number");
		if (!isFinite(value)) throw new InvalidError("out_of_bounds");
		return String(value);
	}
	throw new InvalidError("not_a_string");
}
// node_modules/read-excel-file/modules/parseSheetData/types/Boolean.js
function BooleanType(value) {
	if (typeof value === "boolean") return value;
	throw new InvalidError("not_a_boolean");
}
// node_modules/read-excel-file/modules/parseSheetData/types/Date.js
function DateType(value) {
	if (value instanceof Date) {
		if (isNaN(value.valueOf())) throw new InvalidError("out_of_bounds");
		return value;
	}
	throw new InvalidError("not_a_date");
}
// node_modules/read-excel-file/modules/parseSheetData/parseSheetData.js
function _typeof$1(o) {
	"@babel/helpers - typeof";
	return _typeof$1 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof$1(o);
}
function _slicedToArray(arr, i) {
	return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
}
function _iterableToArrayLimit(r, l) {
	var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
	if (null != t) {
		var e, n, i, u, a = [], f = !0, o = !1;
		try {
			if (i = (t = t.call(r)).next, 0 === l) {
				if (Object(t) !== t) return;
				f = !1;
			} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
		} catch (r) {
			o = !0, n = r;
		} finally {
			try {
				if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
			} finally {
				if (o) throw n;
			}
		}
		return a;
	}
}
function _toArray(arr) {
	return _arrayWithHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableRest();
}
function _nonIterableRest() {
	throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _iterableToArray(iter) {
	if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
}
function _arrayWithHoles(arr) {
	if (Array.isArray(arr)) return arr;
}
function ownKeys$1(e, r) {
	var t = Object.keys(e);
	if (Object.getOwnPropertySymbols) {
		var o = Object.getOwnPropertySymbols(e);
		r && (o = o.filter(function(r) {
			return Object.getOwnPropertyDescriptor(e, r).enumerable;
		})), t.push.apply(t, o);
	}
	return t;
}
function _objectSpread$1(e) {
	for (var r = 1; r < arguments.length; r++) {
		var t = null != arguments[r] ? arguments[r] : {};
		r % 2 ? ownKeys$1(Object(t), !0).forEach(function(r) {
			_defineProperty$1(e, r, t[r]);
		}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys$1(Object(t)).forEach(function(r) {
			Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
		});
	}
	return e;
}
function _defineProperty$1(obj, key, value) {
	key = _toPropertyKey$1(key);
	if (key in obj) Object.defineProperty(obj, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true
	});
	else obj[key] = value;
	return obj;
}
function _toPropertyKey$1(arg) {
	var key = _toPrimitive$1(arg, "string");
	return _typeof$1(key) === "symbol" ? key : String(key);
}
function _toPrimitive$1(input, hint) {
	if (_typeof$1(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof$1(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _createForOfIteratorHelperLoose(o, allowArrayLike) {
	var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
	if (it) return (it = it.call(o)).next.bind(it);
	if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") {
		if (it) o = it;
		var i = 0;
		return function() {
			if (i >= o.length) return { done: true };
			return {
				done: false,
				value: o[i++]
			};
		};
	}
	throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _unsupportedIterableToArray(o, minLen) {
	if (!o) return;
	if (typeof o === "string") return _arrayLikeToArray(o, minLen);
	var n = Object.prototype.toString.call(o).slice(8, -1);
	if (n === "Object" && o.constructor) n = o.constructor.name;
	if (n === "Map" || n === "Set") return Array.from(o);
	if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
}
function _arrayLikeToArray(arr, len) {
	if (len == null || len > arr.length) len = arr.length;
	for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
	return arr2;
}
var EMPTY_CELL_VALUE = null;
/**
* Converts spreadsheet-alike data structure into an array of JSON objects.
*
* Parameters:
*
* * `data` — An array of rows, each row being an array of cells. The first row should be the list of column headers and the rest of the rows should be the data.
* * `schema` — A "to JSON" convertion schema (see above).
* * `options` — (optional) Schema conversion parameters of `read-excel-file`:
*   * `propertyValueWhenColumnIsMissing` — By default, when some of the `schema` columns are missing in the input `data`, those properties are set to `undefined` in the output objects. Pass `propertyValueWhenColumnIsMissing: null` to set such "missing column" properties to `null` in the output objects.
*   * `propertyValueWhenCellIsEmpty` — By default, when it encounters a `null` value in a cell in input `data`, it sets it to `undefined` in the output object. Pass `propertyValueWhenCellIsEmpty: null` to make it set such values as `null`s in output objects.
*   // * `shouldSkipRequiredValidationWhenColumnIsMissing: (column: string, { object }) => boolean` — By default, it does apply `required` validation to `schema` properties for which columns are missing in the input `data`. One could pass a custom `shouldSkipRequiredValidationWhenColumnIsMissing(column, { object })` to disable `required` validation for missing columns in some or all cases.
*   * `transformEmptyObject(object, { path? })` — By default, it returns `null` for "empty" objects. One could override that value using `transformEmptyObject(object, { path })` parameter. The value applies to both top-level object and any nested sub-objects in case of a nested schema, hence the additional (optional) `path?: string` parameter.
*   * `transformEmptyArray(array, { path })` — By default, it returns `null` for an "empty" array value. One could override that value using `transformEmptyArray(array, { path })` parameter.
*   * `separatorCharacter` — By default, it splits array-type cell values by a comma character.
*
* When parsing a property value, in case of an error, the value of that property is gonna be `undefined`.
*
* @param {SheetData} data - An array of rows, each row being an array of cells.
* @param {object} schema
* @param {object} [options]
* @param {any} [options.propertyValueWhenColumnIsMissing] — By default, when some of the `schema` columns are missing in the input `data`, those properties are set to `undefined` in the output objects. Pass `propertyValueWhenColumnIsMissing: null` to set such "missing column" properties to `null` in the output objects.
* @param {any} [options.propertyValueWhenCellIsEmpty] — By default, when it encounters a `null` value in a cell in input `data`, it leaves the value as is. Pass a custom `propertyValueWhenCellIsEmpty` to make it set such values to that value.
* // @param {boolean} [options.shouldSkipRequiredValidationWhenColumnIsMissing(column: string, { object })] — By default, it does apply `required` validation to `schema` properties for which columns are missing in the input `data`. One could pass a custom `shouldSkipRequiredValidationWhenColumnIsMissing(column, { object })` to disable `required` validation for missing columns in some or all cases.
* @param {function} [options.transformEmptyObject(object, { path })] — By default, it returns `null` for an "empty" resulting object. One could override that value using `transformEmptyObject(object, { path })` parameter. The value applies to both top-level object and any nested sub-objects in case of a nested schema, hence the additional `path?: string` parameter.
* @param {function} [options.transformEmptyArray(array, { path })] — By default, it returns `null` for an "empty" array value. One could override that value using `transformEmptyArray(array, { path })` parameter.
* @param {string} [options.separatorCharacter] — When specified, string values will be split by this separator to get the array.
* @return {object} — An object of shape `{ objects, errors }`. Either `objects` or `errors` is going to be `undefined`.
*/
function parseSheetData(data, schema, optionsCustom) {
	checkpoint("parse sheet data using schema");
	var objects = [];
	var errors = [];
	var parsedRows = parseSheetDataWithPerRowErrors(data, schema, optionsCustom);
	var parsedRowIndex = 0;
	for (var _iterator = _createForOfIteratorHelperLoose(parsedRows), _step; !(_step = _iterator()).done;) {
		var _step$value = _step.value, object = _step$value.object, rowErrors = _step$value.errors;
		if (rowErrors) errors = errors.concat(rowErrors.map(function(rowError) {
			return _objectSpread$1(_objectSpread$1({}, rowError), {}, { row: parsedRowIndex + 1 });
		}));
		else objects.push(object);
		parsedRowIndex++;
	}
	checkpoint("end");
	if (errors.length > 0) return {
		errors,
		columns: data[0]
	};
	return {
		objects,
		columns: data[0] || []
	};
}
function parseSheetDataWithPerRowErrors(data, schema, optionsCustom) {
	validateSchema(schema);
	var options = applyDefaultOptions(optionsCustom);
	var _data = _toArray(data), columns = _data[0];
	return _data.slice(1).map(function(row) {
		return parseDataRow(row, schema, columns, options);
	});
}
function parseDataRow(dataRow, schema, columns, options) {
	var schemaEntry = { schema };
	var _parseProperty = parseProperty(dataRow, schemaEntry, void 0, columns, options), value = _parseProperty.value, isEmptyValue = _parseProperty.isEmptyValue, errors = _parseProperty.errors, children = _parseProperty.children;
	var dummyParentObject = {
		value: PARSED_OBJECT_TREE_START,
		isEmptyValue,
		errors,
		isRequired: void 0
	};
	var requiredErrors = runPendingRequiredValidations(schemaEntry, value, isEmptyValue, errors, children, dummyParentObject.isRequired, dummyParentObject.value, dummyParentObject.isEmptyValue, dummyParentObject.errors, columns);
	if (errors || requiredErrors) return { errors: (errors || []).concat(requiredErrors || []) };
	return { object: transformValue(value, isEmptyValue, false, void 0, options) };
}
function parseObject(row, schema, path, columns, options) {
	var object = {};
	var isEmptyObject = true;
	var errors = [];
	var children = [];
	for (var _i = 0, _Object$keys = Object.keys(schema); _i < _Object$keys.length; _i++) {
		var key = _Object$keys[_i];
		var schemaEntry = normalizeSchemaEntry(schema[key]);
		var child = parseProperty(row, schemaEntry, getPropertyPath(key, path), columns, options);
		if (child.errors) errors = errors.concat(child.errors);
		else {
			object[key] = transformValue(child.value, child.isEmptyValue, Array.isArray(schemaEntry.type), getPropertyPath(key, path), options);
			if (isEmptyObject && !child.isEmptyValue) isEmptyObject = false;
		}
		children.push(_objectSpread$1(_objectSpread$1({}, child), {}, { schemaEntry }));
	}
	if (errors.length > 0) return {
		errors,
		children
	};
	return {
		value: object,
		isEmptyValue: isEmptyObject,
		children
	};
}
function parseProperty(row, schemaEntry, path, columns, options) {
	var columnIndex = schemaEntry.column ? columns.indexOf(schemaEntry.column) : void 0;
	var isMissingColumn = schemaEntry.column ? columnIndex < 0 : void 0;
	var _ref = schemaEntry.column ? isMissingColumn ? {
		value: options.propertyValueWhenColumnIsMissing,
		isEmptyValue: true
	} : parseCellValueWithPossibleErrors(row[columnIndex], schemaEntry, columnIndex, options) : parseObject(row, schemaEntry.schema, path, columns, options), value = _ref.value, isEmptyValue = _ref.isEmptyValue, errors = _ref.errors, children = _ref.children;
	if (errors) return {
		errors,
		children
	};
	return {
		value,
		isEmptyValue,
		children
	};
}
function parseCellValueWithPossibleErrors(cellValue, schemaEntry, columnIndex, options) {
	var _parseCellValue = parseCellValue(cellValue, schemaEntry, options), value = _parseCellValue.value, isEmptyValue = _parseCellValue.isEmptyValue, errorMessage = _parseCellValue.error, errorReason = _parseCellValue.reason;
	if (errorMessage) return { errors: [createError({
		error: errorMessage,
		reason: errorReason,
		column: schemaEntry.column,
		columnIndex,
		valueType: schemaEntry.type,
		value: cellValue
	})] };
	return {
		value,
		isEmptyValue
	};
}
/**
* Converts a cell value value to a javascript typed value.
* @param  {any} cellValue
* @param  {object} schemaEntry
* @param  {string} propertyPath
* @param  {object} options
* @return {{ value?: any, isEmptyValue: boolean } | { error: string, reason?: string }}
*/
function parseCellValue(cellValue, schemaEntry, options) {
	if (cellValue === void 0) return {
		value: options.propertyValueWhenColumnIsMissing,
		isEmptyValue: true
	};
	if (cellValue === EMPTY_CELL_VALUE) return {
		value: options.propertyValueWhenCellIsEmpty,
		isEmptyValue: true
	};
	if (Array.isArray(schemaEntry.type)) return parseArrayValue(cellValue, schemaEntry, options);
	return parseValue(cellValue, schemaEntry, options);
}
/**
* Converts textual value to a javascript typed array value.
* @param  {any} value
* @param  {object} schemaEntry
* @param  {object} options
* @return {{ value?: any, isEmptyValue: boolean } | { error: string, reason?: string }}
*/
function parseArrayValue(value, schemaEntry, options) {
	if (typeof value !== "string") return { error: "not_a_string" };
	var isEmptyArray = true;
	var errors = [];
	var reasons = [];
	var values = parseSeparatedSubstrings(value, options.separatorCharacter).map(function(substring) {
		if (errors.length > 0) return;
		if (!substring) {
			errors.push("invalid");
			reasons.push("syntax");
			return;
		}
		var _parseValue = parseValue(substring, schemaEntry, options), value = _parseValue.value, isEmptyValue = _parseValue.isEmptyValue, error = _parseValue.error, reason = _parseValue.reason;
		if (error) {
			errors.push(error);
			reasons.push(reason);
			return;
		}
		if (isEmptyArray && !isEmptyValue) isEmptyArray = false;
		return value;
	});
	if (errors.length > 0) return {
		error: errors[0],
		reason: reasons[0]
	};
	return {
		value: values,
		isEmptyValue: isEmptyArray
	};
}
/**
* Converts textual value to a javascript typed value.
* @param  {any} value
* @param  {object} schemaEntry
* @param  {object} options
* @return {{ value?: any, isEmptyValue: boolean } | { error: string }}
*/
function parseValue(value, schemaEntry, options) {
	if (value === EMPTY_CELL_VALUE) return {
		value,
		isEmptyValue: true
	};
	var result;
	if (schemaEntry.type) result = parseValueOfType(value, Array.isArray(schemaEntry.type) ? schemaEntry.type[0] : schemaEntry.type, options);
	else result = { value };
	if (result.error) return result;
	if (value === EMPTY_CELL_VALUE) return {
		value,
		isEmptyValue: true
	};
	if (schemaEntry.oneOf) {
		var errorAndReason = validateOneOf(result.value, schemaEntry.oneOf);
		if (errorAndReason) return errorAndReason;
	}
	if (schemaEntry.validate) try {
		schemaEntry.validate(result.value);
	} catch (error) {
		return { error: error.message };
	}
	return {
		value: result.value,
		isEmptyValue: isEmptyValue(result.value)
	};
}
function validateOneOf(value, oneOf) {
	if (oneOf.indexOf(value) < 0) return {
		error: "invalid",
		reason: "unknown"
	};
}
/**
* Converts cell value to a javascript typed value.
* @param  {(string|number|boolean|Date)} value
* @param  {function} type
* @return {object} Either `{ value: (string|number|Date|boolean) }` or `{ error: string, reason?: string }`
*/
function parseValueOfType(value, type) {
	switch (type) {
		case String: return parseValueUsingTypeParser(value, StringType);
		case Number: return parseValueUsingTypeParser(value, NumberType);
		case Date: return parseValueUsingTypeParser(value, DateType);
		case Boolean: return parseValueUsingTypeParser(value, BooleanType);
		default:
			if (typeof type !== "function") throw new Error("Unsupported schema `type`: ".concat(type && type.name || type));
			return parseValueUsingTypeParser(value, type);
	}
}
/**
* Converts textual value to a custom value using supplied `type`.
* @param  {any} value
* @param  {function} type
* @return {{ value: any, error: string }}
*/
function parseValueUsingTypeParser(value, type) {
	try {
		var parsedValue = type(value);
		if (parsedValue === void 0) return { value: EMPTY_CELL_VALUE };
		return { value: parsedValue };
	} catch (error) {
		var result = { error: error.message };
		if (error.reason) result.reason = error.reason;
		return result;
	}
}
function getNextSubstring(string, separatorCharacter, startIndex) {
	var i = 0;
	var substring = "";
	while (startIndex + i < string.length) {
		var character = string[startIndex + i];
		if (character === separatorCharacter) return [substring, i];
		else {
			substring += character;
			i++;
		}
	}
	return [substring, i];
}
/**
* Parses a string of comma-separated substrings into an array of substrings.
* (the `export` is just for tests)
* @param  {string} string — A string of comma-separated substrings.
* @return {string[]} An array of substrings.
*/
function parseSeparatedSubstrings(string, separatorCharacter) {
	var elements = [];
	var index = 0;
	while (index < string.length) {
		var _getNextSubstring2 = _slicedToArray(getNextSubstring(string, separatorCharacter, index), 2), substring = _getNextSubstring2[0], length = _getNextSubstring2[1];
		index += length + separatorCharacter.length;
		elements.push(substring.trim());
	}
	return elements;
}
function transformValue(value, isEmptyValue, isArrayType, path, options) {
	if (isEmptyValue) {
		if (isObject(value)) return options.transformEmptyObject(value, { path });
		else if (isArrayType) return options.transformEmptyArray(value, { path });
	}
	return value;
}
function getPropertyPath(propertyName, parentObjectPath) {
	return "".concat(parentObjectPath ? parentObjectPath + "." : "").concat(propertyName);
}
function runPendingRequiredValidations(schemaEntry, value, isEmptyValue, errors, children, parentObjectIsRequired, parentObjectValue, parentObjectValueIsEmpty, parentObjectErrors, columns) {
	var requiredErrors = [];
	var isRequired = isPropertyRequired(schemaEntry, parentObjectIsRequired, parentObjectValue, parentObjectValueIsEmpty, parentObjectErrors);
	if (isRequired && isEmptyValue) requiredErrors.push(createError({
		error: "required",
		column: schemaEntry.column,
		columnIndex: columns.indexOf(schemaEntry.column),
		valueType: schemaEntry.type,
		value
	}));
	if (children) for (var _iterator2 = _createForOfIteratorHelperLoose(children), _step2; !(_step2 = _iterator2()).done;) {
		var child = _step2.value;
		var requiredErrorsOfChild = runPendingRequiredValidations(child.schemaEntry, child.value, child.isEmptyValue, child.errors, child.children, isRequired, value, isEmptyValue, errors, columns);
		if (requiredErrorsOfChild) requiredErrors = requiredErrors.concat(requiredErrorsOfChild);
	}
	if (requiredErrors.length > 0) return requiredErrors;
}
function isPropertyRequired(schemaEntry, parentObjectIsRequired, parentObjectValue, parentObjectValueIsEmpty, parentObjectErrors) {
	if (parentObjectIsRequired === false && (parentObjectValueIsEmpty || parentObjectErrors)) return false;
	return schemaEntry.required && (typeof schemaEntry.required === "boolean" ? schemaEntry.required : parentObjectErrors ? false : schemaEntry.required(parentObjectValue));
}
function createError(_ref2) {
	var column = _ref2.column, columnIndex = _ref2.columnIndex, valueType = _ref2.valueType, value = _ref2.value, errorMessage = _ref2.error, reason = _ref2.reason;
	var error = {
		error: errorMessage,
		column,
		columnIndex,
		value
	};
	if (reason) error.reason = reason;
	if (valueType) error.type = valueType;
	return error;
}
function validateSchema(schema) {
	for (var _i2 = 0, _Object$keys2 = Object.keys(schema); _i2 < _Object$keys2.length; _i2++) {
		var key = _Object$keys2[_i2];
		var schemaEntry = normalizeSchemaEntry(schema[key]);
		if (_typeof$1(schemaEntry.type) === "object" && !Array.isArray(schemaEntry.type)) throw new Error("When defining a nested schema, use a `schema` property instead of a `type` property");
		if (!schemaEntry.schema) {
			if (!schemaEntry.column) throw new Error("\"column\" not defined for schema entry \"".concat(key, "\"."));
		}
	}
	validateObjectSchemaRequiredProperty(schema, void 0);
}
function validateObjectSchemaRequiredProperty(schema, required) {
	if (required !== void 0 && required !== false) throw new Error("In a schema, a nested object can have a `required` property but the only allowed value is `undefined` or `false`. Otherwise, a \"required\" error for a nested object would have to include a specific `column` title and a nested object doesn't have one. You've specified the following `required`: ".concat(required));
	for (var _i3 = 0, _Object$keys3 = Object.keys(schema); _i3 < _Object$keys3.length; _i3++) {
		var key = _Object$keys3[_i3];
		if (isObject(schema[key].schema)) {
			if (schema[key].column) throw new Error("In a schema, `column` property is only allowed when describing a property value rather than a nested object. Key: ".concat(key, ". Schema:\n").concat(JSON.stringify(schema[key], null, 2)));
			validateObjectSchemaRequiredProperty(schema[key].schema, schema[key].required);
		}
	}
}
function isEmptyValue(value) {
	return value === void 0 || value === null;
}
var DEFAULT_OPTIONS = {
	propertyValueWhenColumnIsMissing: void 0,
	propertyValueWhenCellIsEmpty: null,
	transformEmptyObject: function transformEmptyObject() {
		return null;
	},
	transformEmptyArray: function transformEmptyArray() {
		return null;
	},
	separatorCharacter: ","
};
function applyDefaultOptions(options) {
	if (options) return _objectSpread$1(_objectSpread$1({}, DEFAULT_OPTIONS), options);
	else return DEFAULT_OPTIONS;
}
var PARSED_OBJECT_TREE_START = {};
// node_modules/read-excel-file/modules/export/parseSheet.js
function _typeof(o) {
	"@babel/helpers - typeof";
	return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof(o);
}
var _excluded = ["schema"];
function ownKeys(e, r) {
	var t = Object.keys(e);
	if (Object.getOwnPropertySymbols) {
		var o = Object.getOwnPropertySymbols(e);
		r && (o = o.filter(function(r) {
			return Object.getOwnPropertyDescriptor(e, r).enumerable;
		})), t.push.apply(t, o);
	}
	return t;
}
function _objectSpread(e) {
	for (var r = 1; r < arguments.length; r++) {
		var t = null != arguments[r] ? arguments[r] : {};
		r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
			_defineProperty(e, r, t[r]);
		}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
			Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
		});
	}
	return e;
}
function _defineProperty(obj, key, value) {
	key = _toPropertyKey(key);
	if (key in obj) Object.defineProperty(obj, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true
	});
	else obj[key] = value;
	return obj;
}
function _toPropertyKey(arg) {
	var key = _toPrimitive(arg, "string");
	return _typeof(key) === "symbol" ? key : String(key);
}
function _toPrimitive(input, hint) {
	if (_typeof(input) !== "object" || input === null) return input;
	var prim = input[Symbol.toPrimitive];
	if (prim !== void 0) {
		var res = prim.call(input, hint || "default");
		if (_typeof(res) !== "object") return res;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return (hint === "string" ? String : Number)(input);
}
function _objectWithoutProperties(source, excluded) {
	if (source == null) return {};
	var target = _objectWithoutPropertiesLoose(source, excluded);
	var key, i;
	if (Object.getOwnPropertySymbols) {
		var sourceSymbolKeys = Object.getOwnPropertySymbols(source);
		for (i = 0; i < sourceSymbolKeys.length; i++) {
			key = sourceSymbolKeys[i];
			if (excluded.indexOf(key) >= 0) continue;
			if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
			target[key] = source[key];
		}
	}
	return target;
}
function _objectWithoutPropertiesLoose(source, excluded) {
	if (source == null) return {};
	var target = {};
	var sourceKeys = Object.keys(source);
	var key, i = 0;
	for (; i < sourceKeys.length; i++) {
		key = sourceKeys[i];
		if (excluded.indexOf(key) >= 0) continue;
		target[key] = source[key];
	}
	return target;
}
/**
* Reads data from a single sheet of an `.xlsx` file as an array of rows (which are arrays of cells) or as an array of objects (if `options.schema` was passed).
* @param  {function} [createWorkerFunction] — Creates a worker function.
* @param  {function} parseXml — SAX XML parser.
* @param  {Record<string,Uint8Array>} contents - A map of `.xml` files inside the `.xlsx` file (which itself is just a zipped directory).
* @param  {string|number} [sheet] — Sheet name or number.
* @param  {object} [options]
* @return {Promise<SheetData>}
*/
function parseSheet(createWorkerFunction, parseXml, contents, sheet, optionsWithSchema) {
	var _ref = optionsWithSchema || {}, schema = _ref.schema, options = _objectWithoutProperties(_ref, _excluded);
	return parseSpreadsheetContentsInWorker(createWorkerFunction, parseXml, contents, _objectSpread(_objectSpread({}, options), {}, { sheets: [sheet === void 0 ? 1 : sheet] })).then(function(sheets) {
		var sheetData = sheets[0].data;
		if (schema) return parseSheetData(sheetData, schema, options);
		return sheetData;
	});
}
// node_modules/read-excel-file/modules/export/readSheetNode.js
/**
* Reads a single sheet from an `.xlsx` file.
* @param  {(string|Stream|Buffer|Blob)} input
* @param  {(number|string)} [sheet] — Sheet number or sheet name
* @param  {object} [options]
* @return {Promise<SheetData>}
*/
function readSheet(input, sheet, options) {
	if (!options && sheet && typeof sheet !== "number" && typeof sheet !== "string") {
		options = sheet;
		sheet = void 0;
	}
	return unpackXlsxFile(input).then(function(contents) {
		return parseSheet(createWorkerFunctionInNode, parseXml, contents, sheet, options);
	});
}
// src/cli/table.ts
/** 글자 파일 디코딩: UTF-16 LE(BOM) → UTF-8 → 안 맞으면 한글 Excel이 저장하는 CP949 */
function decode(bytes) {
	if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder("utf-16le").decode(bytes);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder("euc-kr").decode(bytes);
	}
}
/** 할당표 파일(.xlsx 첫 시트, 그 밖에는 CSV·탭 구분 글) → 행 배열. 빈칸은 빈 문자열 */
async function readTableFile(path) {
	if (/\.xlsx$/i.test(path)) return (await readSheet(path)).map((row) => row.map((value) => value === null || value === void 0 ? "" : String(value)));
	return parseDelimited(decode(await readFile(path)));
}
// src/cli/cli.ts
var usage = `사용법:
  autoladder check <프로젝트.json>                검사만 한다 (파일을 쓰지 않음)
  autoladder generate <프로젝트.json> [--out 폴더]  검사하고 MAIN.csv, COMMENT.csv를 쓴다
  autoladder diagram <프로젝트.json> [--out 파일]   공정 흐름도를 HTML로 쓴다 (브라우저로 연다)
  autoladder report <프로젝트.json> [--out 파일]    검증 결과서를 HTML로 쓴다 (검사 항목별 합격·불합격)
  autoladder tags <할당표.xlsx|.csv>              할당표 파일을 읽어 태그 목록(JSON)으로 보여 준다

종료 코드: 0 = 오류 없음, 1 = 오류 있음`;
var print = (line = "") => void process.stdout.write(line + "\n");
var hasError = (issues) => issues.some((n) => n.level === "error");
function printIssues(issues) {
	for (const level of ["error", "warning"]) for (const issue of issues.filter((n) => n.level === level)) {
		const where = issue.row !== void 0 ? ` [할당표 ${issue.row}행]` : issue.rung !== void 0 ? ` [렁 ${issue.rung + 1}]` : "";
		print(`${level === "error" ? "오류" : "경고"}${where}: ${issue.message}`);
	}
}
/** 프로젝트 파일을 읽고 갈 수 있는 데까지 검사한다. 앞 단계에 오류가 있으면 거기서 멈춘다 */
async function load(file) {
	const parsed = parseProject(JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, "")));
	if (!parsed.project) return { issues: parsed.issues };
	const project = parsed.project;
	const read = project.tagsFile ? readTags(await readTableFile(resolve(dirname(file), project.tagsFile)), project.tagColumns) : inlineTags(project);
	if (hasError(read.issues)) return {
		issues: read.issues,
		project
	};
	const result = build(project, read.tags);
	return {
		issues: [...read.issues, ...result.issues],
		project,
		tags: read.tags,
		result
	};
}
async function run(command, file, outPath) {
	if (command === "tags") {
		const { tags, issues } = readTags(await readTableFile(file));
		printIssues(issues);
		if (!hasError(issues)) print(JSON.stringify(tags, null, 2));
		return !hasError(issues);
	}
	const stem = basename(file, extname(file));
	const { issues, project, tags, result } = await load(file);
	const name = project?.name ?? stem;
	const program = result?.program;
	printIssues(issues);
	if (command === "report") {
		const path = resolve(outPath ?? join(dirname(file), `${stem}_검증결과서.html`));
		const date = (/* @__PURE__ */ new Date()).toLocaleString("ko-KR", {
			dateStyle: "long",
			timeStyle: "short"
		});
		await writeFile(path, reportPage({
			name,
			file: basename(file),
			date,
			issues,
			program,
			tags: tags?.length,
			steps: project?.table.steps.length,
			transitions: project?.table.transitions.length
		}));
		print(`종합 판정: ${hasError(issues) ? "불합격" : "합격"}`);
		print(`결과: ${path}`);
		return !hasError(issues);
	}
	if (command === "diagram") {
		if (!project || !tags) {
			print("결과: 프로젝트 파일이나 할당표에 오류가 있어 흐름도를 그리지 못했습니다");
			return false;
		}
		const path = resolve(outPath ?? join(dirname(file), `${stem}.html`));
		await writeFile(path, diagramPage(name, project.table, project.op, tags, issues));
		print(`결과: ${path}`);
		return true;
	}
	if (program) {
		const devices = program.comments.map((c) => `${c.device}=${c.lines.join(" ")}`);
		print(`렁 ${program.rungs.length}개, 내부 디바이스 ${devices.length}개`);
		print(`내부 디바이스: ${devices.join(", ")}`);
	}
	if (hasError(issues) || !result?.files) {
		print("결과: 오류가 있어 CSV를 만들지 않았습니다");
		return false;
	}
	if (command === "check") {
		print("결과: 오류 없음 (check는 파일을 쓰지 않습니다)");
		return true;
	}
	const dir = resolve(outPath ?? join(dirname(file), stem));
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "MAIN.csv"), result.files.main);
	await writeFile(join(dir, "COMMENT.csv"), result.files.comment);
	print(`결과: ${join(dir, "MAIN.csv")}`);
	print(`결과: ${join(dir, "COMMENT.csv")}`);
	return true;
}
var [command, file, ...rest] = process.argv.slice(2);
if (![
	"check",
	"generate",
	"diagram",
	"report",
	"tags"
].includes(command ?? "") || !file) {
	print(usage);
	process.exitCode = 1;
} else run(command, file, rest[0] === "--out" ? rest[1] : void 0).then((ok) => void (process.exitCode = ok ? 0 : 1), (error) => {
	print(`오류: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
});
export {};
