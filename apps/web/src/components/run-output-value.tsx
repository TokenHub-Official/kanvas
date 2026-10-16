import {
  Descriptions,
  Table,
  type DescriptionsProps,
  type TableColumnsType,
} from "antd";
import type { ReactNode } from "react";

import { cn } from "../lib/cn.js";

export type RunOutputSchema = Readonly<Record<string, unknown>>;

interface OutputLabels {
  readonly empty: string;
  readonly no: string;
  readonly yes: string;
}

interface OutputNodeProps {
  readonly labels: OutputLabels;
  readonly schema?: RunOutputSchema;
  readonly value: unknown;
}

interface OutputTableRow {
  readonly key: number;
  readonly value: RunOutputSchema;
}

const hexadecimalColorPattern =
  /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu;

function outputRecord(value: unknown): RunOutputSchema | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RunOutputSchema)
    : undefined;
}

function outputText(value: unknown, labels: OutputLabels): string {
  if (typeof value === "string") return value || labels.empty;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? labels.yes : labels.no;
  if (value === undefined || value === null) return labels.empty;
  return labels.empty;
}

function outputArrayItemKey(
  value: unknown,
  occurrences: Map<string, number>,
): string {
  let representation: string;
  if (value === null) representation = "null";
  else if (typeof value === "string") representation = `string:${value}`;
  else if (typeof value === "number") representation = `number:${value}`;
  else if (typeof value === "boolean") representation = `boolean:${value}`;
  else if (typeof value === "bigint") representation = `bigint:${value}`;
  else {
    try {
      representation = `structured:${JSON.stringify(value) ?? "unknown"}`;
    } catch {
      representation = "structured:unknown";
    }
  }
  const occurrence = occurrences.get(representation) ?? 0;
  occurrences.set(representation, occurrence + 1);
  return `${representation}:${occurrence}`;
}

function schemaProperties(
  schema: RunOutputSchema | undefined,
): RunOutputSchema {
  return outputRecord(schema?.properties) ?? {};
}

function propertySchema(
  schema: RunOutputSchema | undefined,
  key: string,
): RunOutputSchema | undefined {
  return outputRecord(schemaProperties(schema)[key]);
}

function itemSchema(
  schema: RunOutputSchema | undefined,
  index: number,
): RunOutputSchema | undefined {
  const prefixItems = schema?.prefixItems;
  if (Array.isArray(prefixItems)) {
    const tupleItem = outputRecord(prefixItems[index]);
    if (tupleItem) return tupleItem;
  }
  return outputRecord(schema?.items);
}

function schemaTitle(schema: RunOutputSchema | undefined): string | undefined {
  return typeof schema?.title === "string" && schema.title.trim()
    ? schema.title.trim()
    : undefined;
}

function orderedKeys(
  records: readonly RunOutputSchema[],
  schema: RunOutputSchema | undefined,
): readonly string[] {
  const presentKeys: string[] = [];
  const present = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!present.has(key)) {
        present.add(key);
        presentKeys.push(key);
      }
    }
  }
  const declaredKeys = Object.keys(schemaProperties(schema)).filter((key) =>
    present.has(key),
  );
  const declared = new Set(declaredKeys);
  return [...declaredKeys, ...presentKeys.filter((key) => !declared.has(key))];
}

function isNumericColumn(
  records: readonly RunOutputSchema[],
  key: string,
  schema: RunOutputSchema | undefined,
): boolean {
  if (schema?.type === "integer" || schema?.type === "number") return true;
  const values = records.flatMap((record) =>
    Object.hasOwn(record, key) ? [record[key]] : [],
  );
  return (
    values.length > 0 && values.every((value) => typeof value === "number")
  );
}

function OutputScalar({ labels, value }: OutputNodeProps): React.JSX.Element {
  const text = outputText(value, labels);
  if (typeof value === "string" && hexadecimalColorPattern.test(value)) {
    return (
      <span className="inline-flex max-w-full items-center gap-2 font-mono text-xs">
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-sm border border-line"
          style={{ backgroundColor: value }}
        />
        <span className="break-all">{text}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-words",
        typeof value === "number" || typeof value === "bigint"
          ? "font-mono text-xs tabular-nums"
          : undefined,
      )}
    >
      {text}
    </span>
  );
}

function OutputRecordTable({
  labels,
  records,
  schema,
}: {
  readonly labels: OutputLabels;
  readonly records: readonly RunOutputSchema[];
  readonly schema?: RunOutputSchema;
}): React.JSX.Element {
  const keys = orderedKeys(records, schema);
  if (keys.length === 0) {
    return <OutputScalar labels={labels} value={null} />;
  }
  const columns: TableColumnsType<OutputTableRow> = keys.map((key) => {
    const fieldSchema = propertySchema(schema, key);
    const title = schemaTitle(fieldSchema) ?? key;
    return {
      align: isNumericColumn(records, key, fieldSchema) ? "right" : "left",
      key,
      render: (_value, row) => (
        <OutputNode
          labels={labels}
          {...(fieldSchema ? { schema: fieldSchema } : {})}
          value={row.value[key]}
        />
      ),
      title: <span {...(title === key ? {} : { title: key })}>{title}</span>,
    };
  });
  const dataSource = records.map((value, key) => ({ key, value }));
  return (
    <Table<OutputTableRow>
      bordered
      classNames={{
        body: {
          cell: "max-w-80 align-top text-sm leading-5 text-ink",
        },
        header: {
          cell: "whitespace-nowrap text-xs font-semibold text-ink-muted",
        },
      }}
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      rowHoverable={false}
      scroll={{ x: "max-content" }}
      size="small"
    />
  );
}

function OutputObject({
  labels,
  schema,
  value,
}: OutputNodeProps & { readonly value: RunOutputSchema }): React.JSX.Element {
  const keys = orderedKeys([value], schema);
  if (keys.length === 0) {
    return <OutputScalar labels={labels} value={null} />;
  }
  const items: DescriptionsProps["items"] = keys.map((key) => {
    const fieldSchema = propertySchema(schema, key);
    const title = schemaTitle(fieldSchema) ?? key;
    return {
      children: (
        <OutputNode
          labels={labels}
          {...(fieldSchema ? { schema: fieldSchema } : {})}
          value={value[key]}
        />
      ),
      key,
      label: <span {...(title === key ? {} : { title: key })}>{title}</span>,
    };
  });
  return (
    <Descriptions
      bordered
      classNames={{
        content: "min-w-0 break-words text-sm leading-5 text-ink",
        label:
          "w-[min(12rem,38%)] break-words text-xs font-semibold text-ink-muted",
      }}
      colon={false}
      column={1}
      items={items}
      size="small"
    />
  );
}

function OutputArray({
  labels,
  schema,
  value,
}: OutputNodeProps & {
  readonly value: readonly unknown[];
}): React.JSX.Element {
  if (value.length === 0) {
    return <OutputScalar labels={labels} value={null} />;
  }
  const records = value.map(outputRecord);
  if (records.every((record): record is RunOutputSchema => Boolean(record))) {
    const recordsSchema = itemSchema(schema, 0);
    return (
      <OutputRecordTable
        labels={labels}
        records={records}
        {...(recordsSchema ? { schema: recordsSchema } : {})}
      />
    );
  }
  const occurrences = new Map<string, number>();
  const items = value.map((item, index) => ({
    item,
    key: outputArrayItemKey(item, occurrences),
    schema: itemSchema(schema, index),
  }));
  return (
    <ol className="m-0 grid list-decimal gap-2 pl-6 text-sm leading-5 text-ink">
      {items.map((item) => {
        return (
          <li className="min-w-0 pl-1" key={item.key}>
            <OutputNode
              labels={labels}
              {...(item.schema ? { schema: item.schema } : {})}
              value={item.item}
            />
          </li>
        );
      })}
    </ol>
  );
}

function OutputNode({ labels, schema, value }: OutputNodeProps): ReactNode {
  if (Array.isArray(value)) {
    return (
      <OutputArray
        labels={labels}
        {...(schema ? { schema } : {})}
        value={value}
      />
    );
  }
  const record = outputRecord(value);
  if (record) {
    return (
      <OutputObject
        labels={labels}
        {...(schema ? { schema } : {})}
        value={record}
      />
    );
  }
  return (
    <OutputScalar
      labels={labels}
      {...(schema ? { schema } : {})}
      value={value}
    />
  );
}

export function RunOutputValue({
  className,
  emptyLabel = "—",
  noLabel,
  schema,
  value,
  yesLabel,
}: {
  readonly className?: string;
  readonly emptyLabel?: string;
  readonly noLabel: string;
  readonly schema?: RunOutputSchema;
  readonly value: unknown;
  readonly yesLabel: string;
}): React.JSX.Element {
  const labels = {
    empty: emptyLabel,
    no: noLabel,
    yes: yesLabel,
  };
  const structured = Array.isArray(value) || Boolean(outputRecord(value));
  return (
    <div
      className={cn(
        structured
          ? "max-h-80 max-w-full overflow-auto rounded-xl bg-mist p-2"
          : "whitespace-pre-wrap break-words rounded-xl bg-mist px-3 py-2 text-sm leading-6 text-ink",
        className,
      )}
    >
      <OutputNode
        labels={labels}
        {...(schema ? { schema } : {})}
        value={value}
      />
    </div>
  );
}
