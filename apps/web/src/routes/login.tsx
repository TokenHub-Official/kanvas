import { ArrowRightOutlined } from "@ant-design/icons";
import { Button, Form, type InputRef } from "antd";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import drawingCanvasIcon from "../assets/icons/ant-design/EditOutlined.svg";
import { authClient } from "../auth/auth-client.js";
import { emailVerificationCallbackUrl } from "../auth/email-verification.js";
import {
  fetchLoginMethods,
  oauthErrorKey,
  startOAuth,
  type LoginProvider,
} from "../auth/oauth.js";
import {
  authenticationRecoveryDecision,
  loginErrorCode,
  safeReturnTo,
  shouldRedirectAuthenticatedLogin,
  type LoginErrorCode,
} from "../auth/entry-recovery.js";
import {
  validateLoginFields,
  type LoginFieldErrors,
} from "../auth/login-form.js";
import { Brand } from "../components/brand.js";
import { DoodleIcon } from "../components/doodle-icon.js";
import { InlineNotice, PageLoading } from "../components/feedback.js";
import {
  KanvasInput,
  KanvasPasswordInput,
} from "../components/kanvas-input.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { rootRoute } from "./root.js";

interface LoginSearch {
  readonly error?: string;
  readonly reason?: "authentication-required";
  readonly returnTo?: string;
}

function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  useDocumentTitle(t("publicEntry.login.documentTitle"));
  const navigate = useNavigate();
  const search = loginRoute.useSearch();
  const session = authClient.useSession();
  const methods = useQuery({
    queryKey: ["authentication", "login-methods"],
    queryFn: fetchLoginMethods,
    retry: false,
  });
  const [oauthPending, setOauthPending] = useState<string>();
  const authenticationRecoveryRequired =
    search.reason === "authentication-required";
  const redirectAuthenticatedSession = shouldRedirectAuthenticatedLogin({
    authenticationRecoveryRequired,
    hasOAuthError: Boolean(search.error),
    hasSession: Boolean(session.data),
  });
  const [authenticationRecoveryPending, setAuthenticationRecoveryPending] =
    useState(authenticationRecoveryRequired);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginErrorCode>();
  const [verificationResending, setVerificationResending] = useState(false);
  const [verificationResendState, setVerificationResendState] = useState<
    "sent" | "failed"
  >();
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const emailInputRef = useRef<InputRef>(null);
  const passwordInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (redirectAuthenticatedSession) {
      void navigate({
        replace: true,
        to: search.returnTo ?? "/",
      });
    }
  }, [navigate, redirectAuthenticatedSession, search.returnTo]);

  useEffect(() => {
    if (!authenticationRecoveryRequired) return;
    let active = true;
    void authenticationRecoveryDecision({
      getSession: () =>
        authClient.getSession({
          query: { disableCookieCache: true, disableRefresh: true },
        }),
    }).then((decision) => {
      if (!active) return;
      if (decision === "resume") {
        void navigate({
          replace: true,
          to: search.returnTo ?? "/",
        }).catch(() => {
          if (active) setAuthenticationRecoveryPending(false);
        });
        return;
      }
      setAuthenticationRecoveryPending(false);
    });
    return () => {
      active = false;
    };
  }, [authenticationRecoveryRequired, navigate, search.returnTo]);

  async function submit(): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const nextFieldErrors = validateLoginFields(normalizedEmail, password);
    if (nextFieldErrors.email || nextFieldErrors.password) {
      setFieldErrors(nextFieldErrors);
      setError(undefined);
      window.requestAnimationFrame(() => {
        if (nextFieldErrors.email) {
          emailInputRef.current?.focus();
          return;
        }
        passwordInputRef.current?.focus();
      });
      return;
    }
    setSubmitting(true);
    setError(undefined);
    setVerificationResendState(undefined);
    try {
      const result = await authClient.signIn.email({
        email: normalizedEmail,
        password,
        rememberMe: true,
      });
      if (result.error) {
        setError(loginErrorCode(result.error.status, result.error.code));
        return;
      }
      window.location.assign(search.returnTo ?? "/");
    } catch {
      setError("unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  async function resendVerification(): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setVerificationResending(true);
    setVerificationResendState(undefined);
    try {
      const result = await authClient.sendVerificationEmail({
        email: normalizedEmail,
        callbackURL: emailVerificationCallbackUrl(
          window.location.origin,
          search.returnTo,
        ),
      });
      if (result.error) {
        setVerificationResendState("failed");
        return;
      }
      setError(undefined);
      setVerificationResendState("sent");
    } catch {
      setVerificationResendState("failed");
    } finally {
      setVerificationResending(false);
    }
  }

  async function signInWithProvider(provider: LoginProvider): Promise<void> {
    setOauthPending(provider.id);
    setError(undefined);
    const failed = new URL("/login", window.location.origin);
    if (search.returnTo) failed.searchParams.set("returnTo", search.returnTo);
    try {
      await startOAuth(provider, search.returnTo ?? "/", failed.toString());
    } catch {
      setError("unavailable");
      setOauthPending(undefined);
    }
  }

  function updateEmail(event: ChangeEvent<HTMLInputElement>): void {
    setEmail(event.target.value);
    setFieldErrors((current) =>
      current.password ? { password: current.password } : {},
    );
    setError(undefined);
    setVerificationResendState(undefined);
  }

  function updatePassword(event: ChangeEvent<HTMLInputElement>): void {
    setPassword(event.target.value);
    setFieldErrors((current) =>
      current.email ? { email: current.email } : {},
    );
    setError(undefined);
    setVerificationResendState(undefined);
  }

  if (
    session.isPending ||
    methods.isPending ||
    authenticationRecoveryPending ||
    redirectAuthenticatedSession
  ) {
    return <PageLoading label={t("publicEntry.login.checking")} />;
  }

  let contextDescription: string | undefined;
  if (!search.error && search.returnTo?.startsWith("/invite/")) {
    contextDescription = t("publicEntry.login.invitationReturnDescription");
  } else if (
    !search.error &&
    (search.reason === "authentication-required" || search.returnTo)
  ) {
    contextDescription = t(
      "publicEntry.login.authenticationRequiredDescription",
    );
  }

  let loginFeedback: React.JSX.Element | undefined;
  if (verificationResendState) {
    loginFeedback = (
      <InlineNotice
        title={t(
          `publicEntry.login.verificationResend.${verificationResendState}`,
        )}
        tone={verificationResendState === "sent" ? "positive" : "danger"}
      />
    );
  } else if (error) {
    loginFeedback = (
      <InlineNotice
        action={
          error === "emailNotVerified" ? (
            <Button
              loading={verificationResending}
              onClick={() => {
                void resendVerification();
              }}
              size="small"
            >
              {t(
                verificationResending
                  ? "publicEntry.login.resendingVerification"
                  : "publicEntry.login.resendVerification",
              )}
            </Button>
          ) : undefined
        }
        title={t(`publicEntry.login.errors.${error}`)}
        tone="danger"
      />
    );
  }

  return (
    <main className="grid min-h-svh bg-[var(--paper)] lg:grid-cols-[minmax(480px,1.08fr)_minmax(480px,0.92fr)]">
      <section
        aria-hidden="true"
        className="relative hidden min-h-svh overflow-hidden bg-[#17171d] text-white lg:block"
      >
        <div className="absolute inset-0 flex flex-col justify-between px-[clamp(56px,7vw,112px)] py-[clamp(64px,8vh,112px)]">
          <DoodleIcon
            aspectRatio="243 / 193"
            className="h-[min(48vh,420px)] w-auto self-center text-[var(--acid)]"
            source={drawingCanvasIcon}
          />
          <p className="m-0 max-w-[11ch] text-[clamp(38px,3.4vw,56px)] font-semibold leading-[1.04] tracking-[-0.045em]">
            {t("publicEntry.login.visualMessage")}
          </p>
        </div>
      </section>

      <section className="flex min-h-svh items-start justify-center px-6 py-10 sm:px-10 lg:items-center lg:px-[clamp(56px,7vw,104px)]">
        <div className="w-full max-w-[440px]">
          <Brand />
          <div className="mt-14 lg:mt-20">
            <h1
              className="m-0 text-[34px] font-bold leading-tight tracking-[-0.04em] text-[var(--ink)]"
              data-page-focus-target="false"
            >
              {t("publicEntry.login.title")}
            </h1>

            {contextDescription ? (
              <div className="mt-4">
                <InlineNotice title={contextDescription} />
              </div>
            ) : null}

            <div className="mt-8">
              {search.error ? (
                <InlineNotice
                  className="mb-5"
                  title={t(`publicEntry.oauth.${oauthErrorKey(search.error)}`)}
                  tone="danger"
                />
              ) : null}
              {methods.isError ? (
                <InlineNotice
                  action={
                    <Button
                      loading={methods.isFetching}
                      onClick={() => {
                        void methods.refetch();
                      }}
                      size="small"
                    >
                      {t("common.retry")}
                    </Button>
                  }
                  className="mb-5"
                  title={t("publicEntry.login.connectionError")}
                  tone="danger"
                />
              ) : null}
              {methods.data?.providers.length ? (
                <div className="mb-6 grid gap-3">
                  {methods.data.providers.map((provider) => (
                    <Button
                      block
                      key={provider.id}
                      size="large"
                      loading={oauthPending === provider.id}
                      disabled={submitting || Boolean(oauthPending)}
                      onClick={() => {
                        void signInWithProvider(provider);
                      }}
                    >
                      {t("publicEntry.oauth.signIn", { name: provider.name })}
                    </Button>
                  ))}
                </div>
              ) : null}
              {methods.data?.emailAndPasswordEnabled === false && error ? (
                <InlineNotice
                  title={t(`publicEntry.login.errors.${error}`)}
                  tone="danger"
                />
              ) : null}
              {methods.data?.emailAndPasswordEnabled === false &&
              methods.data.providers.length === 0 ? (
                <InlineNotice
                  title={t("publicEntry.oauth.noMethods")}
                  tone="warning"
                />
              ) : null}
              {methods.data?.emailAndPasswordEnabled !== false ? (
                <Form
                  layout="vertical"
                  onFinish={() => {
                    void submit();
                  }}
                  requiredMark={false}
                >
                  <Form.Item
                    help={
                      fieldErrors.email ? (
                        <span id="login-email-error" role="alert">
                          {t("publicEntry.login.validation.emailRequired")}
                        </span>
                      ) : undefined
                    }
                    htmlFor="login-email"
                    label={t("publicEntry.login.email")}
                    validateStatus={fieldErrors.email ? "error" : ""}
                  >
                    <KanvasInput
                      aria-errormessage={
                        fieldErrors.email ? "login-email-error" : undefined
                      }
                      aria-invalid={fieldErrors.email ? true : undefined}
                      autoCapitalize="none"
                      autoComplete="email"
                      autoFocus
                      data-page-focus-target
                      disabled={submitting}
                      id="login-email"
                      onChange={updateEmail}
                      placeholder={t("publicEntry.login.emailPlaceholder")}
                      ref={emailInputRef}
                      size="large"
                      spellCheck={false}
                      status={fieldErrors.email ? "error" : ""}
                      value={email}
                    />
                  </Form.Item>

                  <Form.Item
                    help={
                      fieldErrors.password ? (
                        <span id="login-password-error" role="alert">
                          {t("publicEntry.login.validation.passwordRequired")}
                        </span>
                      ) : undefined
                    }
                    htmlFor="login-password"
                    label={t("publicEntry.login.password")}
                    validateStatus={fieldErrors.password ? "error" : ""}
                  >
                    <KanvasPasswordInput
                      aria-errormessage={
                        fieldErrors.password
                          ? "login-password-error"
                          : undefined
                      }
                      aria-invalid={fieldErrors.password ? true : undefined}
                      autoComplete="current-password"
                      disabled={submitting}
                      id="login-password"
                      onChange={updatePassword}
                      placeholder={t("publicEntry.login.passwordPlaceholder")}
                      ref={passwordInputRef}
                      size="large"
                      status={fieldErrors.password ? "error" : ""}
                      value={password}
                    />
                  </Form.Item>

                  <div aria-live="polite" className="-mt-4 mb-5 min-h-[48px]">
                    {loginFeedback}
                  </div>

                  <Button
                    block
                    htmlType="submit"
                    icon={<ArrowRightOutlined />}
                    iconPlacement="end"
                    loading={submitting}
                    disabled={Boolean(oauthPending)}
                    size="large"
                    type="primary"
                  >
                    {submitting
                      ? t("publicEntry.login.submitting")
                      : t("publicEntry.login.submit")}
                  </Button>
                  {methods.data?.emailPasswordRegistrationEnabled === true ? (
                    <p className="mb-0 mt-5 text-center text-sm text-muted">
                      {t("publicEntry.login.noAccount")}{" "}
                      <Link
                        search={
                          search.returnTo ? { returnTo: search.returnTo } : {}
                        }
                        to="/register"
                      >
                        {t("publicEntry.login.createAccount")}
                      </Link>
                    </p>
                  ) : null}
                </Form>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const returnTo = safeReturnTo(search.returnTo);
    return {
      ...(typeof search.error === "string"
        ? { error: search.error.slice(0, 100) }
        : {}),
      ...(returnTo ? { returnTo } : {}),
      ...(search.reason === "authentication-required"
        ? { reason: search.reason }
        : {}),
    };
  },
  component: LoginPage,
});
