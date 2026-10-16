export function registrationControlDisabled(options: {
  readonly enabled: boolean;
  readonly emailRegistrationAvailable: boolean;
  readonly oidcProviderCount: number;
}): boolean {
  return (
    !options.enabled &&
    options.oidcProviderCount === 0 &&
    !options.emailRegistrationAvailable
  );
}
