export interface LoginFieldErrors {
  readonly email?: "required";
  readonly password?: "required";
}

export function validateLoginFields(
  email: string,
  password: string,
): LoginFieldErrors {
  return {
    ...(email.trim() ? {} : { email: "required" as const }),
    ...(password ? {} : { password: "required" as const }),
  };
}
