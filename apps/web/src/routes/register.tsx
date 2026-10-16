import {
  ArrowRightOutlined,
  LockOutlined,
  MailOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { createRoute, Link } from "@tanstack/react-router";
import { Button, Form, type InputRef } from "antd";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import { httpStatus } from "../api/http-status.js";
import { authClient } from "../auth/auth-client.js";
import { emailVerificationCallbackUrl } from "../auth/email-verification.js";
import { safeReturnTo } from "../auth/entry-recovery.js";
import {
  emailRegistrationRequiresVerification,
  fetchLoginMethods,
  signInEmailRegistration,
} from "../auth/oauth.js";
import {
  validateRegistrationFields,
  type RegistrationFieldErrors,
} from "../auth/registration-form.js";
import { InlineNotice, PageLoading } from "../components/feedback.js";
import {
  KanvasInput,
  KanvasPasswordInput,
} from "../components/kanvas-input.js";
import {
  PublicEntryShell,
  PublicResult,
} from "../components/public-entry-shell.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { rootRoute } from "./root.js";

interface RegisterSearch {
  readonly returnTo?: string;
}

type RegistrationError =
  "closed" | "rateLimited" | "signInFailed" | "unavailable";

function registrationError(error: {
  readonly status?: number | undefined;
  readonly message?: string | undefined;
}): RegistrationError {
  if (error.status === httpStatus.tooManyRequests) return "rateLimited";
  if (/sign.?up.*disabled|registration.*closed/iu.test(error.message ?? "")) {
    return "closed";
  }
  return "unavailable";
}

function RegisterPage(): React.JSX.Element {
  const { t } = useTranslation();
  const search = registerRoute.useSearch();
  const session = authClient.useSession();
  const methods = useQuery({
    queryKey: ["authentication", "login-methods"],
    queryFn: fetchLoginMethods,
    retry: false,
  });
  const emailVerificationRequired = emailRegistrationRequiresVerification(
    methods.data,
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<RegistrationError>();
  const [submittedEmail, setSubmittedEmail] = useState<string>();
  const [resending, setResending] = useState(false);
  const [resendState, setResendState] = useState<"sent" | "failed">();
  const displayNameRef = useRef<InputRef>(null);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);
  const passwordConfirmationRef = useRef<InputRef>(null);
  useDocumentTitle(t("publicEntry.register.documentTitle"));

  useEffect(() => {
    if (session.data) {
      window.location.replace(search.returnTo ?? "/");
    }
  }, [search.returnTo, session.data]);

  function goToLogin(): void {
    window.location.assign(
      search.returnTo
        ? `/login?returnTo=${encodeURIComponent(search.returnTo)}`
        : "/login",
    );
  }

  function updateField(
    setter: (value: string) => void,
    field: keyof RegistrationFieldErrors,
  ): (event: ChangeEvent<HTMLInputElement>) => void {
    return (event) => {
      setter(event.target.value);
      setFieldErrors((current) => {
        const remaining = { ...current };
        delete remaining[field];
        return remaining;
      });
      setError(undefined);
    };
  }

  async function submit(): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors = validateRegistrationFields({
      displayName,
      email: normalizedEmail,
      password,
      passwordConfirmation,
    });
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError(undefined);
      window.requestAnimationFrame(() => {
        if (nextErrors.displayName) displayNameRef.current?.focus();
        else if (nextErrors.email) emailRef.current?.focus();
        else if (nextErrors.password) passwordRef.current?.focus();
        else passwordConfirmationRef.current?.focus();
      });
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await authClient.signUp.email({
        name: displayName.trim(),
        email: normalizedEmail,
        password,
        callbackURL: emailVerificationCallbackUrl(
          window.location.origin,
          search.returnTo,
        ),
      });
      if (result.error) {
        setError(registrationError(result.error));
        return;
      }
      if (!emailVerificationRequired) {
        try {
          await signInEmailRegistration(normalizedEmail, password);
        } catch {
          setError("signInFailed");
          return;
        }
        window.location.replace(search.returnTo ?? "/");
        return;
      }
      setSubmittedEmail(normalizedEmail);
      setPassword("");
      setPasswordConfirmation("");
    } catch {
      setError("unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  async function resend(): Promise<void> {
    if (!submittedEmail) return;
    setResending(true);
    setResendState(undefined);
    try {
      const result = await authClient.sendVerificationEmail({
        email: submittedEmail,
        callbackURL: emailVerificationCallbackUrl(
          window.location.origin,
          search.returnTo,
        ),
      });
      setResendState(result.error ? "failed" : "sent");
    } catch {
      setResendState("failed");
    } finally {
      setResending(false);
    }
  }

  if (session.isPending || session.data || methods.isPending) {
    return <PageLoading label={t("publicEntry.register.checking")} />;
  }

  if (submittedEmail) {
    return (
      <PublicEntryShell>
        <div className="grid w-full justify-items-center">
          {resendState ? (
            <InlineNotice
              className="mb-4 w-full max-w-[520px]"
              title={t(`publicEntry.register.resend.${resendState}`)}
              tone={resendState === "sent" ? "positive" : "danger"}
            />
          ) : null}
          <PublicResult
            description={t("publicEntry.register.sentDescription", {
              email: submittedEmail,
            })}
            icon={<MailOutlined />}
            primaryAction={{
              icon: <ReloadOutlined />,
              label: t("publicEntry.register.resend.action"),
              loading: resending,
              onClick: () => {
                void resend();
              },
            }}
            secondaryAction={{
              icon: <ArrowRightOutlined />,
              iconPlacement: "end",
              label: t("publicEntry.register.backToLogin"),
              onClick: goToLogin,
            }}
            title={t("publicEntry.register.sentTitle")}
            tone="success"
          />
        </div>
      </PublicEntryShell>
    );
  }

  if (methods.isError) {
    return (
      <PublicEntryShell>
        <PublicResult
          description={t("publicEntry.register.unavailableDescription")}
          icon={<LockOutlined />}
          primaryAction={{
            icon: <ReloadOutlined />,
            label: t("common.retry"),
            loading: methods.isFetching,
            onClick: () => {
              void methods.refetch();
            },
          }}
          secondaryAction={{
            icon: <ArrowRightOutlined />,
            iconPlacement: "end",
            label: t("publicEntry.register.signIn"),
            onClick: goToLogin,
          }}
          title={t("publicEntry.register.unavailableTitle")}
          tone="danger"
        />
      </PublicEntryShell>
    );
  }

  if (
    error === "closed" ||
    methods.data?.emailPasswordRegistrationEnabled !== true
  ) {
    return (
      <PublicEntryShell>
        <PublicResult
          description={t("publicEntry.register.closedDescription")}
          icon={<LockOutlined />}
          primaryAction={{
            icon: <ArrowRightOutlined />,
            iconPlacement: "end",
            label: t("publicEntry.register.signIn"),
            onClick: goToLogin,
          }}
          title={t("publicEntry.register.closedTitle")}
          tone="neutral"
        />
      </PublicEntryShell>
    );
  }

  const errorMessage = error
    ? t(`publicEntry.register.errors.${error}`)
    : undefined;
  const descriptionKey = emailVerificationRequired
    ? "publicEntry.register.description"
    : "publicEntry.register.descriptionWithoutVerification";
  let submitKey = "publicEntry.register.submit";
  if (submitting) submitKey = "publicEntry.register.submitting";
  else if (!emailVerificationRequired) {
    submitKey = "publicEntry.register.submitWithoutVerification";
  }
  return (
    <PublicEntryShell
      contentClassName="!place-items-start sm:!place-items-center"
      headerEnd={
        <Link
          search={search.returnTo ? { returnTo: search.returnTo } : {}}
          to="/login"
        >
          {t("publicEntry.register.signIn")}
        </Link>
      }
    >
      <section className="w-full max-w-[480px]">
        <h1
          className="m-0 text-3xl font-bold leading-tight tracking-[-0.04em] text-ink"
          data-page-focus-target="false"
        >
          {t("publicEntry.register.title")}
        </h1>
        <p className="mb-0 mt-3 text-sm leading-6 text-muted">
          {t(descriptionKey)}
        </p>
        {errorMessage ? (
          <InlineNotice className="mt-5" title={errorMessage} tone="danger" />
        ) : null}
        <Form
          className="mt-6"
          layout="vertical"
          onFinish={() => {
            void submit();
          }}
          requiredMark={false}
        >
          <Form.Item
            help={
              fieldErrors.displayName ? (
                <span id="register-name-error" role="alert">
                  {t("publicEntry.register.validation.displayNameRequired")}
                </span>
              ) : undefined
            }
            htmlFor="register-name"
            label={t("publicEntry.register.displayName")}
            validateStatus={fieldErrors.displayName ? "error" : ""}
          >
            <KanvasInput
              aria-errormessage={
                fieldErrors.displayName ? "register-name-error" : undefined
              }
              aria-invalid={fieldErrors.displayName ? true : undefined}
              autoComplete="name"
              autoFocus
              data-page-focus-target
              disabled={submitting}
              id="register-name"
              maxLength={160}
              onChange={updateField(setDisplayName, "displayName")}
              placeholder={t("publicEntry.register.displayNamePlaceholder")}
              ref={displayNameRef}
              size="large"
              value={displayName}
            />
          </Form.Item>
          <Form.Item
            help={
              fieldErrors.email ? (
                <span id="register-email-error" role="alert">
                  {t(
                    `publicEntry.register.validation.email.${fieldErrors.email}`,
                  )}
                </span>
              ) : undefined
            }
            htmlFor="register-email"
            label={t("publicEntry.register.email")}
            validateStatus={fieldErrors.email ? "error" : ""}
          >
            <KanvasInput
              aria-errormessage={
                fieldErrors.email ? "register-email-error" : undefined
              }
              aria-invalid={fieldErrors.email ? true : undefined}
              autoCapitalize="none"
              autoComplete="email"
              disabled={submitting}
              id="register-email"
              maxLength={320}
              onChange={updateField(setEmail, "email")}
              placeholder={t("publicEntry.register.emailPlaceholder")}
              ref={emailRef}
              size="large"
              spellCheck={false}
              value={email}
            />
          </Form.Item>
          <Form.Item
            help={
              fieldErrors.password ? (
                <span id="register-password-error" role="alert">
                  {t(
                    `publicEntry.register.validation.password.${fieldErrors.password}`,
                  )}
                </span>
              ) : undefined
            }
            htmlFor="register-password"
            label={t("publicEntry.register.password")}
            validateStatus={fieldErrors.password ? "error" : ""}
          >
            <KanvasPasswordInput
              aria-errormessage={
                fieldErrors.password ? "register-password-error" : undefined
              }
              aria-invalid={fieldErrors.password ? true : undefined}
              autoComplete="new-password"
              disabled={submitting}
              id="register-password"
              maxLength={128}
              onChange={updateField(setPassword, "password")}
              placeholder={t("publicEntry.register.passwordPlaceholder")}
              ref={passwordRef}
              size="large"
              value={password}
            />
          </Form.Item>
          <Form.Item
            help={
              fieldErrors.passwordConfirmation ? (
                <span id="register-password-confirmation-error" role="alert">
                  {t(
                    `publicEntry.register.validation.passwordConfirmation.${fieldErrors.passwordConfirmation}`,
                  )}
                </span>
              ) : undefined
            }
            htmlFor="register-password-confirmation"
            label={t("publicEntry.register.passwordConfirmation")}
            validateStatus={fieldErrors.passwordConfirmation ? "error" : ""}
          >
            <KanvasPasswordInput
              aria-errormessage={
                fieldErrors.passwordConfirmation
                  ? "register-password-confirmation-error"
                  : undefined
              }
              aria-invalid={fieldErrors.passwordConfirmation ? true : undefined}
              autoComplete="new-password"
              disabled={submitting}
              id="register-password-confirmation"
              maxLength={128}
              onChange={updateField(
                setPasswordConfirmation,
                "passwordConfirmation",
              )}
              placeholder={t(
                "publicEntry.register.passwordConfirmationPlaceholder",
              )}
              ref={passwordConfirmationRef}
              size="large"
              value={passwordConfirmation}
            />
          </Form.Item>
          <Button
            block
            htmlType="submit"
            icon={<ArrowRightOutlined />}
            iconPlacement="end"
            loading={submitting}
            size="large"
            type="primary"
          >
            {t(submitKey)}
          </Button>
        </Form>
      </section>
    </PublicEntryShell>
  );
}

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  validateSearch: (search: Record<string, unknown>): RegisterSearch => {
    const returnTo = safeReturnTo(search.returnTo);
    return returnTo ? { returnTo } : {};
  },
  component: RegisterPage,
});
