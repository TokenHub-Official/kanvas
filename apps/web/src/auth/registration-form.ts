export interface RegistrationFieldErrors {
  readonly displayName?: "required";
  readonly email?: "required" | "invalid";
  readonly password?: "required" | "length";
  readonly passwordConfirmation?: "required" | "mismatch";
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const minimumPasswordLength = 8;
const maximumPasswordLength = 128;

export function validateRegistrationFields(fields: {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
  readonly passwordConfirmation: string;
}): RegistrationFieldErrors {
  const email = fields.email.trim();
  const errors: {
    displayName?: "required";
    email?: "required" | "invalid";
    password?: "required" | "length";
    passwordConfirmation?: "required" | "mismatch";
  } = {};
  if (!fields.displayName.trim()) errors.displayName = "required";
  if (!email) errors.email = "required";
  else if (!emailPattern.test(email)) errors.email = "invalid";
  if (!fields.password) errors.password = "required";
  else if (
    fields.password.length < minimumPasswordLength ||
    fields.password.length > maximumPasswordLength
  ) {
    errors.password = "length";
  }
  if (!fields.passwordConfirmation) {
    errors.passwordConfirmation = "required";
  } else if (fields.passwordConfirmation !== fields.password) {
    errors.passwordConfirmation = "mismatch";
  }
  return errors;
}
