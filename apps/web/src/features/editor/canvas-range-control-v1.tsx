import { Slider } from "antd";

export function CanvasRangeControlV1({
  className,
  formatValue = (value) => String(value),
  label,
  maximum,
  minimum,
  onChange,
  onCommit,
  step,
  value,
}: {
  readonly className?: string;
  readonly formatValue?: (value: number) => string;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onChange: (value: number) => void;
  readonly onCommit?: () => void;
  readonly step: number;
  readonly value: number;
}): React.JSX.Element {
  return (
    <div className={`grid min-w-0 gap-2 ${className ?? ""}`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 text-xs font-semibold text-[#52535d]">
          {label}
        </span>
        <output className="min-w-[46px] rounded-[7px] bg-[#f0f1f4] px-[7px] py-[3px] text-right text-[11px] leading-snug text-[#4c4d57] tabular-nums">
          {formatValue(value)}
        </output>
      </div>
      <Slider
        ariaLabelForHandle={label}
        max={maximum}
        min={minimum}
        onChange={onChange}
        {...(onCommit ? { onChangeComplete: onCommit } : {})}
        step={step}
        tooltip={{ open: false }}
        value={value}
      />
    </div>
  );
}
