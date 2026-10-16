const unsignedDecimalPattern = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const signedDecimalPattern = /^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const decimalScale = 1_000_000_000_000n;
const maximumDecimalUnits = 10n ** 36n - 1n;

export class FixedDecimalError extends TypeError {
  public readonly code = "fixed_decimal.invalid";

  public constructor(message: string) {
    super(message);
    this.name = "FixedDecimalError";
  }
}

export function decimalToUnits(value: unknown, label = "amount"): bigint {
  if (typeof value !== "string" || !unsignedDecimalPattern.test(value)) {
    throw new FixedDecimalError(
      `${label} must be an unsigned DECIMAL(36,12) string.`,
    );
  }
  const [integer = "0", fraction = ""] = value.split(".");
  const units =
    BigInt(integer) * decimalScale + BigInt(fraction.padEnd(12, "0") || "0");
  if (units > maximumDecimalUnits) {
    throw new FixedDecimalError(`${label} exceeds DECIMAL(36,12).`);
  }
  return units;
}

export function signedDecimalToUnits(value: unknown, label = "amount"): bigint {
  if (typeof value !== "string" || !signedDecimalPattern.test(value)) {
    throw new FixedDecimalError(
      `${label} must be a signed DECIMAL(36,12) string.`,
    );
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const units = decimalToUnits(unsigned, label);
  return negative ? -units : units;
}

export function decimalUnitsToString(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  if (absolute > maximumDecimalUnits) {
    throw new FixedDecimalError("Amount exceeds DECIMAL(36,12).");
  }
  const integer = absolute / decimalScale;
  const fraction = (absolute % decimalScale)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/u, "");
  const unsigned = fraction
    ? `${integer.toString()}.${fraction}`
    : integer.toString();
  return negative ? `-${unsigned}` : unsigned;
}

export function normalizeUnsignedDecimal(
  value: unknown,
  label = "amount",
): string {
  return decimalUnitsToString(decimalToUnits(value, label));
}

export function minimumDecimal(values: readonly string[]): string {
  if (values.length === 0) {
    throw new FixedDecimalError(
      "At least one amount is required to compute a minimum.",
    );
  }
  let minimum = decimalToUnits(values[0], "amount[0]");
  for (let index = 1; index < values.length; index += 1) {
    const current = decimalToUnits(values[index], `amount[${String(index)}]`);
    if (current < minimum) {
      minimum = current;
    }
  }
  return decimalUnitsToString(minimum);
}
