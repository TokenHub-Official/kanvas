export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DomainError";
  }
}
