import type {
  WorkflowJsonValue,
  WorkflowTopologyNodeV1,
  WorkflowValueReference,
} from "@kanvas/contracts/workflow";

export const maximumWorkflowValueDepth = 64;
export const maximumWorkflowValueNodes = 20_000;
export const maximumWorkflowValueTextUnits = 1_000_000;

export type WorkflowValueProtocolErrorCode =
  | "bounds_exceeded"
  | "invalid_json"
  | "invalid_pointer"
  | "invalid_reference"
  | "invalid_template"
  | "map_item_unavailable"
  | "node_not_completed"
  | "node_not_terminal"
  | "pointer_not_found"
  | "scope_unavailable"
  | "source_unavailable";

export class WorkflowValueProtocolError extends Error {
  public readonly code: WorkflowValueProtocolErrorCode;
  public readonly path: string;

  public constructor(
    code: WorkflowValueProtocolErrorCode,
    path: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowValueProtocolError";
    this.code = code;
    this.path = path;
  }
}

export interface InspectedWorkflowValueReference {
  readonly path: string;
  readonly reference: WorkflowValueReference;
}

export interface WorkflowValueTemplateInspection {
  readonly references: readonly InspectedWorkflowValueReference[];
  readonly nodeCount: number;
  readonly maximumDepth: number;
  readonly textUnits: number;
}

export type WorkflowTerminalNodeStatus =
  "completed" | "failed" | "cancelled" | "skipped";

export interface WorkflowTerminalNodeValue {
  readonly status: WorkflowTerminalNodeStatus;
  readonly output?: unknown;
  readonly error?: unknown;
}

export interface ResolveWorkflowValueContext {
  readonly workflowInput: unknown;
  readonly currentScopeKey: string;
  readonly mapItem?: unknown;
  getNodeResult(
    nodeKey: string,
    scopeKey: string,
  ): WorkflowTerminalNodeValue | undefined;
}

export type WorkflowValueProbe =
  | {
      readonly found: false;
    }
  | {
      readonly found: true;
      readonly value: WorkflowJsonValue;
    };

interface TraversalTotals {
  nodeCount: number;
  maximumDepth: number;
  textUnits: number;
}

interface TraversalBudget {
  readonly totals: TraversalTotals;
  readonly seen: WeakSet<object>;
}

const workflowNodeKey = /^[a-z][a-z0-9_]{0,99}$/u;
const canonicalArrayIndex = /^(?:0|[1-9][0-9]*)$/u;
const terminalNodeStatuses = new Set<WorkflowTerminalNodeStatus>([
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

function fail(
  code: WorkflowValueProtocolErrorCode,
  path: string,
  message: string,
): never {
  throw new WorkflowValueProtocolError(code, path, message);
}

function escapePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, segment: string): string {
  return `${path}/${escapePointerSegment(segment)}`;
}

function addNode(
  budget: TraversalBudget,
  depth: number,
  textUnits: number,
  path: string,
): void {
  budget.totals.nodeCount += 1;
  budget.totals.maximumDepth = Math.max(budget.totals.maximumDepth, depth);
  budget.totals.textUnits += textUnits;
  if (
    budget.totals.nodeCount > maximumWorkflowValueNodes ||
    budget.totals.maximumDepth > maximumWorkflowValueDepth ||
    budget.totals.textUnits > maximumWorkflowValueTextUnits
  ) {
    fail(
      "bounds_exceeded",
      path,
      "Workflow value exceeds the platform depth, node-count or text budget.",
    );
  }
}

function addTextUnits(
  budget: TraversalBudget,
  textUnits: number,
  path: string,
): void {
  budget.totals.textUnits += textUnits;
  if (budget.totals.textUnits > maximumWorkflowValueTextUnits) {
    fail(
      "bounds_exceeded",
      path,
      "Workflow value exceeds the platform depth, node-count or text budget.",
    );
  }
}

function assertPlainRecord(
  value: object,
  path: string,
  seen: WeakSet<object>,
): asserts value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      "invalid_json",
      path,
      "Workflow JSON objects must have a plain or null prototype.",
    );
  }
  if (seen.has(value)) {
    fail(
      "invalid_json",
      path,
      "Workflow JSON must be a tree without cycles or shared object identity.",
    );
  }
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(
      "invalid_json",
      path,
      "Workflow JSON cannot contain symbol properties.",
    );
  }
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail(
        "invalid_json",
        childPath(path, key),
        "Workflow JSON cannot contain accessors or non-enumerable properties.",
      );
    }
  }
}

function assertPlainArray(
  value: readonly unknown[],
  path: string,
  seen: WeakSet<object>,
): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail(
      "invalid_json",
      path,
      "Workflow JSON arrays must use the standard Array prototype.",
    );
  }
  if (seen.has(value)) {
    fail(
      "invalid_json",
      path,
      "Workflow JSON must be a tree without cycles or shared object identity.",
    );
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail(
        "invalid_json",
        childPath(path, String(index)),
        "Workflow JSON arrays cannot be sparse or contain accessors.",
      );
    }
  }
  const allowedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      fail(
        "invalid_json",
        path,
        "Workflow JSON arrays cannot contain custom properties.",
      );
    }
  }
}

function parsePointer(pointer: unknown, path: string): readonly string[] {
  if (
    typeof pointer !== "string" ||
    pointer.length > 2048 ||
    (pointer !== "" && !pointer.startsWith("/"))
  ) {
    return fail(
      "invalid_pointer",
      path,
      "A JSON Pointer must be empty or start with '/', and be at most 2048 characters.",
    );
  }
  if (pointer === "") {
    return Object.freeze([]);
  }
  const segments = pointer.slice(1).split("/");
  if (segments.length > maximumWorkflowValueDepth) {
    return fail(
      "invalid_pointer",
      path,
      "A JSON Pointer cannot contain more than 64 segments.",
    );
  }
  return Object.freeze(
    segments.map((segment) => {
      if (/~(?:[^01]|$)/u.test(segment)) {
        return fail(
          "invalid_pointer",
          path,
          "A JSON Pointer may only use ~0 and ~1 escape sequences.",
        );
      }
      return segment.replaceAll("~1", "/").replaceAll("~0", "~");
    }),
  );
}

function parseReference(value: unknown, path: string): WorkflowValueReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      "invalid_reference",
      path,
      "A workflow value reference must be a JSON object.",
    );
  }
  assertPlainRecord(value, path, new WeakSet<object>());
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  const source = record.source;

  if (source === "workflow_input" || source === "map_item") {
    if (keys.length !== 2 || keys[0] !== "pointer" || keys[1] !== "source") {
      return fail(
        "invalid_reference",
        path,
        `${source} references only accept source and pointer.`,
      );
    }
    parsePointer(record.pointer, childPath(path, "pointer"));
    return Object.freeze({
      source,
      pointer: record.pointer as string,
    });
  }

  if (source === "node_output" || source === "node_result") {
    if (
      keys.length !== 4 ||
      keys[0] !== "nodeKey" ||
      keys[1] !== "pointer" ||
      keys[2] !== "scope" ||
      keys[3] !== "source" ||
      typeof record.nodeKey !== "string" ||
      !workflowNodeKey.test(record.nodeKey) ||
      (record.scope !== "root" && record.scope !== "current")
    ) {
      return fail(
        "invalid_reference",
        path,
        "A node reference requires a valid nodeKey, root/current scope and pointer.",
      );
    }
    parsePointer(record.pointer, childPath(path, "pointer"));
    return Object.freeze({
      source,
      nodeKey: record.nodeKey,
      scope: record.scope,
      pointer: record.pointer as string,
    });
  }

  return fail(
    "invalid_reference",
    path,
    "Unsupported workflow value reference source.",
  );
}

function inspectTemplateValue(
  value: unknown,
  path: string,
  depth: number,
  budget: TraversalBudget,
  references: InspectedWorkflowValueReference[],
): void {
  if (value === null || typeof value === "boolean") {
    addNode(budget, depth, 0, path);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("invalid_json", path, "Workflow JSON numbers must be finite.");
    }
    addNode(budget, depth, 0, path);
    return;
  }
  if (typeof value === "string") {
    addNode(budget, depth, value.length, path);
    return;
  }
  if (!value || typeof value !== "object") {
    fail("invalid_json", path, "Workflow values must contain only JSON data.");
  }

  addNode(budget, depth, 0, path);
  if (Array.isArray(value)) {
    assertPlainArray(value, path, budget.seen);
    value.forEach((item, index) => {
      inspectTemplateValue(
        item,
        childPath(path, String(index)),
        depth + 1,
        budget,
        references,
      );
    });
    return;
  }

  assertPlainRecord(value, path, budget.seen);
  const keys = Object.keys(value);
  keys.forEach((key) => {
    addTextUnits(budget, key.length, childPath(path, key));
  });

  if (keys.length === 1 && keys[0] === "$value") {
    const reference = parseReference(value.$value, childPath(path, "$value"));
    references.push(
      Object.freeze({
        path,
        reference,
      }),
    );
    return;
  }
  if (keys.length === 1 && keys[0] === "$literal") {
    cloneJsonValue(
      value.$literal,
      childPath(path, "$literal"),
      depth + 1,
      budget,
    );
    return;
  }
  if (keys.length === 1 && keys[0] === "$string") {
    if (!Array.isArray(value.$string) || value.$string.length < 1) {
      fail(
        "invalid_template",
        path,
        "A $string template requires at least one text or variable segment.",
      );
    }
    const stringSegments = value.$string as readonly unknown[];
    stringSegments.forEach((segment, index) => {
      if (
        typeof segment !== "string" &&
        !(
          segment &&
          typeof segment === "object" &&
          !Array.isArray(segment) &&
          Object.keys(segment).length === 1 &&
          Object.hasOwn(segment, "$value")
        )
      ) {
        fail(
          "invalid_template",
          childPath(childPath(path, "$string"), String(index)),
          "A $string segment must be text or a direct workflow value reference.",
        );
      }
      inspectTemplateValue(
        segment,
        childPath(childPath(path, "$string"), String(index)),
        depth + 1,
        budget,
        references,
      );
    });
    return;
  }
  if (keys.length === 1 && keys[0] === "$coalesce") {
    if (
      !Array.isArray(value.$coalesce) ||
      value.$coalesce.length < 2 ||
      value.$coalesce.length > 32
    ) {
      fail(
        "invalid_template",
        path,
        "A $coalesce template requires between 2 and 32 references.",
      );
    }
    (value.$coalesce as readonly unknown[]).forEach((candidate, index) => {
      if (!isDirectReferenceTag(candidate)) {
        fail(
          "invalid_template",
          childPath(childPath(path, "$coalesce"), String(index)),
          "A $coalesce candidate must be a direct workflow value reference.",
        );
      }
      inspectTemplateValue(
        candidate,
        childPath(childPath(path, "$coalesce"), String(index)),
        depth + 1,
        budget,
        references,
      );
    });
    return;
  }
  if (
    keys.includes("$value") ||
    keys.includes("$literal") ||
    keys.includes("$string") ||
    keys.includes("$coalesce")
  ) {
    fail(
      "invalid_template",
      path,
      "Reserved $value, $literal and $string keys must be the sole key in a tag.",
    );
  }
  for (const key of keys.sort()) {
    inspectTemplateValue(
      value[key],
      childPath(path, key),
      depth + 1,
      budget,
      references,
    );
  }
}

function cloneJsonValue(
  value: unknown,
  path: string,
  depth: number,
  budget: TraversalBudget,
): WorkflowJsonValue {
  if (value === null || typeof value === "boolean") {
    addNode(budget, depth, 0, path);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail(
        "invalid_json",
        path,
        "Workflow JSON numbers must be finite.",
      );
    }
    addNode(budget, depth, 0, path);
    return value;
  }
  if (typeof value === "string") {
    addNode(budget, depth, value.length, path);
    return value;
  }
  if (!value || typeof value !== "object") {
    return fail(
      "invalid_json",
      path,
      "Workflow values must contain only JSON data.",
    );
  }

  addNode(budget, depth, 0, path);
  if (Array.isArray(value)) {
    assertPlainArray(value, path, budget.seen);
    return Object.freeze(
      value.map((item, index) =>
        cloneJsonValue(item, childPath(path, String(index)), depth + 1, budget),
      ),
    ) as unknown as WorkflowJsonValue;
  }

  assertPlainRecord(value, path, budget.seen);
  const clone = Object.create(null) as Record<string, WorkflowJsonValue>;
  for (const key of Object.keys(value).sort()) {
    addTextUnits(budget, key.length, childPath(path, key));
    clone[key] = cloneJsonValue(
      value[key],
      childPath(path, key),
      depth + 1,
      budget,
    );
  }
  return Object.freeze(clone);
}

function newTotals(): TraversalTotals {
  return {
    nodeCount: 0,
    maximumDepth: 0,
    textUnits: 0,
  };
}

function newBudget(totals = newTotals()): TraversalBudget {
  return {
    totals,
    seen: new WeakSet<object>(),
  };
}

export function inspectWorkflowValueTemplate(
  value: unknown,
  path = "",
): WorkflowValueTemplateInspection {
  const budget = newBudget();
  const references: InspectedWorkflowValueReference[] = [];
  inspectTemplateValue(value, path, 0, budget, references);
  return Object.freeze({
    references: Object.freeze(references),
    nodeCount: budget.totals.nodeCount,
    maximumDepth: budget.totals.maximumDepth,
    textUnits: budget.totals.textUnits,
  });
}

function pointerValue(
  source: unknown,
  pointer: string,
  path: string,
): {
  readonly found: boolean;
  readonly value?: unknown;
} {
  let value = source;
  for (const segment of parsePointer(pointer, path)) {
    if (Array.isArray(value)) {
      if (
        !canonicalArrayIndex.test(segment) ||
        Number(segment) > Number.MAX_SAFE_INTEGER
      ) {
        return { found: false };
      }
      const index = Number(segment);
      if (index >= value.length || !Object.hasOwn(value, index)) {
        return { found: false };
      }
      value = value[index];
      continue;
    }
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      return { found: false };
    }
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  return {
    found: true,
    value,
  };
}

function cloneResolvedValue(
  value: unknown,
  path: string,
  depth: number,
  aggregateBudget: TraversalBudget,
): WorkflowJsonValue {
  return cloneJsonValue(value, path, depth, newBudget(aggregateBudget.totals));
}

function resolveReference(
  reference: WorkflowValueReference,
  context: ResolveWorkflowValueContext,
  path: string,
  depth: number,
  budget: TraversalBudget,
): WorkflowValueProbe {
  let source: unknown;
  if (reference.source === "workflow_input") {
    source = cloneResolvedValue(
      context.workflowInput,
      "/workflowInput",
      depth,
      budget,
    );
  } else if (reference.source === "map_item") {
    if (!Object.hasOwn(context, "mapItem")) {
      return fail(
        "map_item_unavailable",
        path,
        "map_item is only available while resolving a bounded map item.",
      );
    }
    source = cloneResolvedValue(context.mapItem, "/mapItem", depth, budget);
  } else {
    const scopeKey =
      reference.scope === "root" ? "root" : context.currentScopeKey;
    if (reference.scope === "current" && (!scopeKey || scopeKey === "root")) {
      return fail(
        "scope_unavailable",
        path,
        "The current scoped node value is unavailable in root scope.",
      );
    }
    const result = context.getNodeResult(reference.nodeKey, scopeKey);
    if (!result) {
      return fail(
        "source_unavailable",
        path,
        `Node ${reference.nodeKey} has no terminal value in scope ${scopeKey}.`,
      );
    }
    assertPlainRecord(
      result,
      `/nodeResults/${reference.nodeKey}/${scopeKey}`,
      new WeakSet<object>(),
    );
    if (!terminalNodeStatuses.has(result.status)) {
      return fail(
        "node_not_terminal",
        path,
        `Node ${reference.nodeKey} is not terminal.`,
      );
    }
    if (reference.source === "node_output") {
      if (result.status !== "completed" || !Object.hasOwn(result, "output")) {
        return fail(
          "node_not_completed",
          path,
          `Node ${reference.nodeKey} has no completed output.`,
        );
      }
      source = cloneResolvedValue(
        result.output,
        `/nodeResults/${reference.nodeKey}/${scopeKey}/output`,
        depth,
        budget,
      );
    } else {
      const envelope = Object.create(null) as Record<string, WorkflowJsonValue>;
      addNode(budget, depth, 0, path);
      addTextUnits(budget, "status".length, childPath(path, "status"));
      addNode(
        budget,
        depth + 1,
        result.status.length,
        childPath(path, "status"),
      );
      envelope.status = result.status;
      if (Object.hasOwn(result, "output")) {
        addTextUnits(budget, "output".length, childPath(path, "output"));
        envelope.output = cloneResolvedValue(
          result.output,
          childPath(path, "output"),
          depth + 1,
          budget,
        );
      }
      if (Object.hasOwn(result, "error")) {
        addTextUnits(budget, "error".length, childPath(path, "error"));
        envelope.error = cloneResolvedValue(
          result.error,
          childPath(path, "error"),
          depth + 1,
          budget,
        );
      }
      source = Object.freeze(envelope);
    }
  }

  const selected = pointerValue(
    source,
    reference.pointer,
    childPath(path, "pointer"),
  );
  if (!selected.found) {
    return { found: false };
  }
  return {
    found: true,
    value: selected.value as WorkflowJsonValue,
  };
}

function isDirectReferenceTag(
  value: unknown,
): value is Readonly<{ $value: unknown }> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "$value")
  );
}

function isStringTemplateTag(value: unknown): value is Readonly<{
  $string: readonly (string | Readonly<{ $value: WorkflowValueReference }>)[];
}> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "$string") &&
    Array.isArray((value as Readonly<Record<string, unknown>>).$string)
  );
}

function isCoalesceTemplateTag(value: unknown): value is Readonly<{
  $coalesce: readonly Readonly<{ $value: WorkflowValueReference }>[];
}> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "$coalesce") &&
    Array.isArray((value as Readonly<Record<string, unknown>>).$coalesce)
  );
}

function resolveTemplateValue(
  value: unknown,
  context: ResolveWorkflowValueContext,
  path: string,
  depth: number,
  budget: TraversalBudget,
): WorkflowJsonValue {
  if (isDirectReferenceTag(value)) {
    const resolved = resolveReference(
      parseReference(value.$value, childPath(path, "$value")),
      context,
      path,
      depth,
      budget,
    );
    if (!resolved.found) {
      return fail(
        "pointer_not_found",
        path,
        "A workflow value reference points to a missing value.",
      );
    }
    return resolved.value;
  }
  if (isStringTemplateTag(value)) {
    let rendered = "";
    value.$string.forEach((segment, index) => {
      if (typeof segment === "string") {
        rendered += segment;
        return;
      }
      const resolved = resolveReference(
        segment.$value,
        context,
        childPath(childPath(path, "$string"), String(index)),
        depth + 1,
        budget,
      );
      if (!resolved.found) {
        fail(
          "pointer_not_found",
          childPath(childPath(path, "$string"), String(index)),
          "A string template reference points to a missing value.",
        );
      }
      if (resolved.value !== null && typeof resolved.value === "object") {
        fail(
          "invalid_template",
          childPath(childPath(path, "$string"), String(index)),
          "A string template can only embed text, number, boolean or null values.",
        );
      }
      rendered += String(resolved.value ?? "");
    });
    return cloneResolvedValue(rendered, path, depth, budget);
  }
  if (isCoalesceTemplateTag(value)) {
    for (const [index, candidate] of value.$coalesce.entries()) {
      try {
        const resolved = resolveReference(
          candidate.$value,
          context,
          childPath(childPath(path, "$coalesce"), String(index)),
          depth + 1,
          budget,
        );
        if (resolved.found) return resolved.value;
      } catch (error) {
        if (
          !(error instanceof WorkflowValueProtocolError) ||
          (error.code !== "node_not_completed" &&
            error.code !== "source_unavailable" &&
            error.code !== "pointer_not_found")
        ) {
          throw error;
        }
      }
    }
    return fail(
      "source_unavailable",
      path,
      "No $coalesce candidate produced an available value.",
    );
  }
  if (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "$literal")
  ) {
    return cloneResolvedValue(
      (value as Readonly<Record<string, unknown>>).$literal,
      path,
      depth,
      budget,
    );
  }
  if (Array.isArray(value)) {
    addNode(budget, depth, 0, path);
    return Object.freeze(
      value.map((item, index) =>
        resolveTemplateValue(
          item,
          context,
          childPath(path, String(index)),
          depth + 1,
          budget,
        ),
      ),
    ) as unknown as WorkflowJsonValue;
  }
  if (!!value && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    addNode(budget, depth, 0, path);
    const resolved = Object.create(null) as Record<string, WorkflowJsonValue>;
    for (const key of Object.keys(record).sort()) {
      addTextUnits(budget, key.length, childPath(path, key));
      resolved[key] = resolveTemplateValue(
        record[key],
        context,
        childPath(path, key),
        depth + 1,
        budget,
      );
    }
    return Object.freeze(resolved);
  }
  return cloneResolvedValue(value, path, depth, budget);
}

export function probeWorkflowValueTemplate(
  template: unknown,
  context: ResolveWorkflowValueContext,
): WorkflowValueProbe {
  inspectWorkflowValueTemplate(template);
  const budget = newBudget();
  if (isDirectReferenceTag(template)) {
    return resolveReference(
      parseReference(template.$value, "/$value"),
      context,
      "",
      0,
      budget,
    );
  }
  return {
    found: true,
    value: resolveTemplateValue(template, context, "", 0, budget),
  };
}

export function resolveWorkflowValueTemplate(
  template: unknown,
  context: ResolveWorkflowValueContext,
): WorkflowJsonValue {
  const result = probeWorkflowValueTemplate(template, context);
  if (!result.found) {
    return fail(
      "pointer_not_found",
      "",
      "A workflow value reference points to a missing value.",
    );
  }
  return result.value;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  }
  if (
    !!left &&
    typeof left === "object" &&
    !Array.isArray(left) &&
    !!right &&
    typeof right === "object" &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Readonly<Record<string, unknown>>;
    const rightRecord = right as Readonly<Record<string, unknown>>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          jsonValuesEqual(leftRecord[key], rightRecord[key]),
      )
    );
  }
  return false;
}

export interface WorkflowSwitchSelection {
  readonly caseIndex: number | null;
  readonly next: readonly string[];
}

export function selectWorkflowSwitchTargets(
  node: Extract<WorkflowTopologyNodeV1, { readonly kind: "switch" }>,
  probe: WorkflowValueProbe,
): WorkflowSwitchSelection {
  if (
    !probe.found &&
    !node.cases.some(({ when }) => when.operator === "exists")
  ) {
    return fail(
      "pointer_not_found",
      `/nodes/${node.key}/value`,
      "A missing Switch value requires an explicit exists case.",
    );
  }

  for (const [index, candidate] of node.cases.entries()) {
    const { when } = candidate;
    let matches = false;
    if (when.operator === "exists") {
      matches = probe.found;
    } else if (probe.found && when.operator === "equals") {
      matches = jsonValuesEqual(probe.value, when.value);
    } else if (probe.found && when.operator === "not_equals") {
      matches = !jsonValuesEqual(probe.value, when.value);
    } else if (probe.found && when.operator === "in") {
      matches = when.value.some((value) => jsonValuesEqual(probe.value, value));
    }
    if (matches) {
      return Object.freeze({
        caseIndex: index,
        next: Object.freeze([...candidate.next]),
      });
    }
  }
  return Object.freeze({
    caseIndex: null,
    next: Object.freeze([...node.defaultNext]),
  });
}
