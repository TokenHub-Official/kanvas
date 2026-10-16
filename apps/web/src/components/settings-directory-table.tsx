import { Table, type TableColumnsType, type TableProps } from "antd";
import type { Key, ReactNode } from "react";

export function SettingsDirectoryTable<TRow extends { readonly key: Key }>({
  bulkToolbar,
  columns,
  dataSource,
  emptyText,
  footer,
  rowSelection,
  toolbar,
  loading = false,
  scrollX = 840,
}: {
  readonly bulkToolbar?: ReactNode;
  readonly columns: TableColumnsType<TRow>;
  readonly dataSource: readonly TRow[];
  readonly emptyText: ReactNode;
  readonly footer?: ReactNode;
  readonly rowSelection?: TableProps<TRow>["rowSelection"];
  readonly toolbar?: ReactNode;
  readonly loading?: boolean;
  readonly scrollX?: number | string;
}): React.JSX.Element {
  return (
    <section className="mt-5 overflow-hidden rounded-[20px] bg-paper shadow-[0_12px_32px_rgb(35_32_68_/_6%)]">
      {toolbar ? (
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          {toolbar}
        </div>
      ) : null}
      {bulkToolbar ? (
        <div className="bg-mist/45 px-4 py-2.5 sm:px-5">{bulkToolbar}</div>
      ) : null}
      <Table<TRow>
        classNames={{
          body: {
            cell: "px-4",
          },
          header: {
            cell: "px-4 py-2.5 text-xs font-semibold",
          },
        }}
        columns={columns}
        loading={loading}
        dataSource={[...dataSource]}
        locale={{ emptyText }}
        pagination={false}
        scroll={{ x: scrollX }}
        size="middle"
        {...(rowSelection
          ? {
              rowSelection: {
                columnWidth: 52,
                ...rowSelection,
              },
            }
          : {})}
      />
      {footer ? (
        <div className="border-t border-line px-4 py-3 sm:px-5">{footer}</div>
      ) : null}
    </section>
  );
}
