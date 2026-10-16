import {
  ArrowRightOutlined,
  DownOutlined,
  HomeOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Alert, Button, Form, type InputRef } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  fetchCurrentHumanContext,
  redeemInstanceSetup,
  registerInstanceSetupAccount,
  resolveInstanceSetup,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import brokenLinkIcon from "../assets/icons/ant-design/DisconnectOutlined.svg";
import {
  captureInstanceSetupToken,
  clearCapturedInstanceSetupToken,
  firstInstanceSetupErrorField,
  instanceSetupFailureRecovery,
  instanceSetupSlugHtmlPattern,
  validateInstanceSetupFields,
  type InstanceSetupField,
} from "../auth/instance-setup-form.js";
import {
  createInstanceSetupPageState,
  reduceInstanceSetupPage,
} from "../auth/instance-setup-page-state.js";
import { authClient } from "../auth/auth-client.js";
import { PageLoading } from "../components/feedback.js";
import {
  KanvasInput,
  KanvasPasswordInput,
} from "../components/kanvas-input.js";
import { DoodleIcon } from "../components/doodle-icon.js";
import {
  PublicEntryShell,
  PublicResult,
} from "../components/public-entry-shell.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import {
  hasUnsavedFormChanges,
  UnsavedChangesGuard,
} from "../components/unsaved-changes-guard.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { cn } from "../lib/cn.js";
import { queryClient } from "../query-client.js";

const setupReturnTo = "/setup";

interface SetupRegistrationFields {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

function setupRegistrationErrorKey(
  error: unknown,
):
  | "accountExists"
  | "emailMismatch"
  | "loginRequired"
  | "setupChanged"
  | "unavailable" {
  if (!(error instanceof ApiProblem)) {
    return "unavailable";
  }
  if (error.code === "instance_setup_registration.email_mismatch") {
    return "emailMismatch";
  }
  if (error.code === "instance_setup_registration.account_exists") {
    return "accountExists";
  }
  if (error.code === "instance_setup_registration.login_required") {
    return "loginRequired";
  }
  if (
    error.code === "instance_setup.token_rejected" ||
    error.code === "instance_setup.already_initialized"
  ) {
    return "setupChanged";
  }
  return "unavailable";
}

function SetupAccountEntry({
  accountRegistration,
  setupToken,
}: {
  readonly accountRegistration: "available" | "login_only";
  readonly setupToken: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [registrationVisible, setRegistrationVisible] = useState(false);
  const registration = useMutation({
    mutationFn: async (fields: SetupRegistrationFields) => {
      const email = fields.email.trim().toLowerCase();
      await registerInstanceSetupAccount({
        setupToken,
        email,
        displayName: fields.displayName.trim(),
        password: fields.password,
      });
      const signIn = await authClient.signIn.email({
        email,
        password: fields.password,
        rememberMe: true,
      });
      if (signIn.error) {
        throw new Error("Setup account sign-in failed.");
      }
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.assign(setupReturnTo);
    },
  });

  function goToLogin(): void {
    void navigate({
      search: { returnTo: setupReturnTo },
      to: "/login",
    });
  }

  function returnHome(): void {
    window.location.assign("/");
  }

  function submitRegistration(fields: SetupRegistrationFields): void {
    registration.mutate(fields);
  }

  function openRegistration(): void {
    setRegistrationVisible(true);
  }

  function cancelRegistration(): void {
    setRegistrationVisible(false);
  }

  if (accountRegistration === "login_only") {
    return (
      <PublicEntryShell>
        <PublicResult
          description={t("publicEntry.setup.loginRequiredDescription")}
          icon={<SafetyCertificateOutlined />}
          primaryAction={{
            icon: <ArrowRightOutlined />,
            iconPlacement: "end",
            label: t("publicEntry.setup.login"),
            onClick: goToLogin,
          }}
          secondaryAction={{
            icon: <HomeOutlined />,
            label: t("publicEntry.setup.returnToKanvas"),
            onClick: returnHome,
          }}
          title={t("publicEntry.setup.loginRequiredTitle")}
        />
      </PublicEntryShell>
    );
  }

  return (
    <PublicEntryShell>
      <section className="w-full max-w-[560px] rounded-[28px] border border-[var(--line)] bg-[var(--paper)] px-6 py-8 shadow-[0_20px_60px_rgb(37_34_65/8%)] sm:px-10 sm:py-11">
        <h1
          className="m-0 text-[34px] font-bold leading-tight tracking-[-0.04em] text-[var(--ink)] sm:text-[40px]"
          data-page-focus-target
          tabIndex={-1}
        >
          {t("publicEntry.setup.accountTitle")}
        </h1>
        <p className="m-0 mt-3 text-sm leading-6 text-[var(--muted)]">
          {t("publicEntry.setup.accountDescription")}
        </p>

        {registrationVisible ? (
          <Form<SetupRegistrationFields>
            className="mt-8"
            layout="vertical"
            onFinish={submitRegistration}
            requiredMark={false}
          >
            <Form.Item
              label={t("publicEntry.setup.email")}
              name="email"
              rules={[
                {
                  required: true,
                  message: t(
                    "publicEntry.setup.registrationValidation.emailRequired",
                  ),
                },
                {
                  type: "email",
                  message: t(
                    "publicEntry.setup.registrationValidation.emailInvalid",
                  ),
                },
              ]}
            >
              <KanvasInput
                autoCapitalize="none"
                autoComplete="email"
                disabled={registration.isPending}
                placeholder="owner@company.com"
                size="large"
                spellCheck={false}
              />
            </Form.Item>
            <Form.Item
              label={t("publicEntry.setup.displayName")}
              name="displayName"
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: t(
                    "publicEntry.setup.registrationValidation.displayNameRequired",
                  ),
                },
              ]}
            >
              <KanvasInput
                autoComplete="name"
                disabled={registration.isPending}
                placeholder={t("publicEntry.setup.displayNamePlaceholder")}
                size="large"
              />
            </Form.Item>
            <Form.Item
              label={t("publicEntry.setup.password")}
              name="password"
              rules={[
                {
                  required: true,
                  message: t(
                    "publicEntry.setup.registrationValidation.passwordRequired",
                  ),
                },
                {
                  min: 8,
                  message: t(
                    "publicEntry.setup.registrationValidation.passwordLength",
                  ),
                },
              ]}
            >
              <KanvasPasswordInput
                autoComplete="new-password"
                disabled={registration.isPending}
                placeholder={t("publicEntry.setup.passwordPlaceholder")}
                size="large"
              />
            </Form.Item>
            {registration.error ? (
              <div className="-mt-2 mb-5">
                <Alert
                  role="alert"
                  showIcon
                  title={t(
                    `publicEntry.setup.registrationErrors.${setupRegistrationErrorKey(
                      registration.error,
                    )}`,
                  )}
                  type="error"
                  variant="outlined"
                />
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Button
                block
                htmlType="submit"
                icon={<ArrowRightOutlined />}
                iconPlacement="end"
                loading={registration.isPending}
                size="large"
                type="primary"
              >
                {registration.isPending
                  ? t("publicEntry.setup.registering")
                  : t("publicEntry.setup.register")}
              </Button>
              <Button
                disabled={registration.isPending}
                onClick={cancelRegistration}
                size="large"
              >
                {t("publicEntry.setup.cancelRegistration")}
              </Button>
            </div>
          </Form>
        ) : (
          <div className="mt-8 grid gap-3">
            <Button
              block
              icon={<ArrowRightOutlined />}
              iconPlacement="end"
              onClick={openRegistration}
              size="large"
              type="primary"
            >
              {t("publicEntry.setup.createAccount")}
            </Button>
            <Button block onClick={goToLogin} size="large">
              {t("publicEntry.setup.existingAccountLogin")}
            </Button>
          </div>
        )}
      </section>
    </PublicEntryShell>
  );
}

export function SetupPage(): React.JSX.Element {
  const { t } = useTranslation();
  useDocumentTitle(t("publicEntry.setup.documentTitle"));
  const navigate = useNavigate();
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    retry: false,
  });
  const [setupState, updateSetupState] = useReducer(
    reduceInstanceSetupPage,
    undefined,
    () =>
      createInstanceSetupPageState(
        typeof window === "undefined"
          ? ""
          : (captureInstanceSetupToken(
              window.location.hash,
              window.sessionStorage,
            ) ?? ""),
      ),
  );
  const {
    error,
    fieldErrors,
    organizationName,
    organizationSlug,
    setupLinkUnavailable,
    setupToken,
    submitting,
    switchAccountAvailable,
    switchAccountError,
    switchingAccount,
    urlSettingsOpen,
    workspaceName,
    workspaceSlug,
  } = setupState;
  const setupSummary = useQuery({
    queryKey: ["instance-setup", "summary"],
    queryFn: () => resolveInstanceSetup({ setupToken }),
    enabled: setupToken.length > 0,
    retry: false,
  });
  const contextRecovery = usePageQueryRecovery(context.refetch);
  const setupRecovery = usePageQueryRecovery(setupSummary.refetch);
  const organizationNameInputRef = useRef<InputRef>(null);
  const organizationSlugInputRef = useRef<InputRef>(null);
  const workspaceNameInputRef = useRef<InputRef>(null);
  const workspaceSlugInputRef = useRef<InputRef>(null);
  const setupNavigationCommittedRef = useRef(false);

  useEffect(() => {
    if (!setupToken || typeof window === "undefined" || !window.location.hash) {
      return;
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, [setupToken]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !(setupSummary.error instanceof ApiProblem) ||
      (setupSummary.error.status !== httpStatus.forbidden &&
        setupSummary.error.status !== httpStatus.conflict)
    ) {
      return;
    }
    clearCapturedInstanceSetupToken(window.sessionStorage);
    updateSetupState({ type: "token_rejected" });
  }, [setupSummary.error]);

  function focusSetupField(field: InstanceSetupField): void {
    if (field === "setupToken") {
      return;
    }
    const target = {
      organizationName: organizationNameInputRef,
      organizationSlug: organizationSlugInputRef,
      workspaceName: workspaceNameInputRef,
      workspaceSlug: workspaceSlugInputRef,
    }[field];
    target.current?.focus();
  }

  if (setupLinkUnavailable) {
    return (
      <PublicEntryShell>
        <PublicResult
          description={t("publicEntry.setup.linkRequiredDescription")}
          icon={
            <DoodleIcon
              aspectRatio="163 / 154"
              className="h-[72px] w-auto"
              source={brokenLinkIcon}
            />
          }
          primaryAction={{
            icon: <HomeOutlined />,
            label: t("publicEntry.setup.returnToKanvas"),
            onClick: () => {
              window.location.assign("/");
            },
          }}
          title={t("publicEntry.setup.linkRequiredTitle")}
          tone="warning"
          visualVariant="illustration"
        />
      </PublicEntryShell>
    );
  }

  function translatedFieldError(field: InstanceSetupField): string | undefined {
    const code = fieldErrors[field];
    return code ? t(`publicEntry.setup.validation.${code}`) : undefined;
  }

  function fieldHelp(field: InstanceSetupField): ReactNode {
    const message = translatedFieldError(field);
    return message ? (
      <span id={`setup-${field}-error`} role="alert">
        {message}
      </span>
    ) : undefined;
  }

  if (context.data?.workspaces[0]) {
    return <Navigate replace to="/" />;
  }
  if (setupSummary.isError) {
    return (
      <PublicEntryShell>
        <PublicResult
          description={t("publicEntry.setup.unavailableDescription")}
          primaryAction={{
            icon: <ReloadOutlined />,
            label: t("common.retry"),
            loading: setupRecovery.pending,
            onClick: setupRecovery.retry,
          }}
          icon={<SafetyCertificateOutlined />}
          secondaryAction={{
            icon: <HomeOutlined />,
            label: t("publicEntry.setup.returnToKanvas"),
            onClick: () => window.location.assign("/"),
          }}
          title={t("publicEntry.setup.unavailableTitle")}
          tone="danger"
        />
      </PublicEntryShell>
    );
  }
  if (context.isPending || setupSummary.isPending || !setupSummary.data) {
    return <PageLoading label={t("publicEntry.setup.loading")} />;
  }
  if (
    context.error instanceof ApiProblem &&
    context.error.status === httpStatus.unauthorized
  ) {
    return (
      <SetupAccountEntry
        accountRegistration={setupSummary.data.accountRegistration}
        setupToken={setupToken}
      />
    );
  }
  if (context.isError) {
    return (
      <PublicEntryShell>
        <PublicResult
          primaryAction={{
            icon: <ReloadOutlined />,
            label: t("common.retry"),
            loading: contextRecovery.pending,
            onClick: contextRecovery.retry,
          }}
          icon={<SafetyCertificateOutlined />}
          title={t("publicEntry.setup.identityUnavailableTitle")}
          tone="danger"
        />
      </PublicEntryShell>
    );
  }
  const currentContext = context.data;

  async function submit(): Promise<void> {
    const values = {
      setupToken: setupToken.trim(),
      organizationName: organizationName.trim(),
      organizationSlug: organizationSlug.trim(),
      workspaceName: workspaceName.trim(),
      workspaceSlug: workspaceSlug.trim(),
    };
    const nextFieldErrors = validateInstanceSetupFields(values);
    const firstError = firstInstanceSetupErrorField(nextFieldErrors);
    if (firstError) {
      updateSetupState({
        type: "validation_failed",
        fieldErrors: nextFieldErrors,
        revealUrlSettings:
          firstError === "organizationSlug" || firstError === "workspaceSlug",
      });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusSetupField(firstError);
        });
      });
      return;
    }
    updateSetupState({ type: "submission_started" });
    try {
      const result = await redeemInstanceSetup(
        currentContext.csrfToken,
        values,
      );
      clearCapturedInstanceSetupToken(window.sessionStorage);
      queryClient.clear();
      setupNavigationCommittedRef.current = true;
      await navigate({
        params: {
          workspaceId: result.workspaceId,
        },
        replace: true,
        to: "/w/$workspaceId",
      });
    } catch (caught) {
      setupNavigationCommittedRef.current = false;
      const recovery = instanceSetupFailureRecovery(
        caught instanceof ApiProblem ? caught.status : undefined,
        caught instanceof ApiProblem ? caught.code : undefined,
      );
      if (caught instanceof ApiProblem) {
        if (recovery.errorCode === "tokenRejected") {
          clearCapturedInstanceSetupToken(window.sessionStorage);
          updateSetupState({ type: "token_rejected" });
        }
      }
      if (recovery.errorCode === "sessionExpired") {
        queryClient.clear();
        setupNavigationCommittedRef.current = true;
        await navigate({
          replace: true,
          search: {
            reason: "authentication-required",
            returnTo: setupReturnTo,
          },
          to: "/login",
        });
        return;
      }
      if (
        caught instanceof ApiProblem &&
        caught.status === httpStatus.conflict
      ) {
        queryClient.clear();
        try {
          const recovered = await fetchCurrentHumanContext();
          const workspace = recovered.workspaces[0];
          if (workspace) {
            setupNavigationCommittedRef.current = true;
            window.location.assign(`/w/${workspace.id}`);
            return;
          }
        } catch {
          // Keep the authoritative setup conflict below.
        }
      }
      updateSetupState({
        type: "submission_failed",
        error: t(`publicEntry.setup.errors.${recovery.errorCode}`),
        switchAccountAvailable: recovery.switchAccount,
      });
    } finally {
      updateSetupState({ type: "submission_finished" });
    }
  }

  async function switchAccount(): Promise<void> {
    if (submitting || switchingAccount) {
      return;
    }
    updateSetupState({ type: "switch_account_started" });
    try {
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error("Session revocation failed.");
      }
      queryClient.clear();
      setupNavigationCommittedRef.current = true;
      await navigate({
        search: {
          returnTo: setupReturnTo,
        },
        to: "/login",
      });
    } catch {
      setupNavigationCommittedRef.current = false;
      updateSetupState({
        type: "switch_account_failed",
        error: t("publicEntry.setup.switchErrorDescription"),
      });
    }
  }

  function submitSetupForm(): void {
    void submit();
  }

  function updateOrganizationName(event: ChangeEvent<HTMLInputElement>): void {
    updateSetupState({
      type: "organization_name_changed",
      value: event.target.value,
    });
  }

  function updateWorkspaceName(event: ChangeEvent<HTMLInputElement>): void {
    updateSetupState({
      type: "workspace_name_changed",
      value: event.target.value,
    });
  }

  function toggleUrlSettings(): void {
    updateSetupState({ type: "toggle_url_settings" });
  }

  function updateOrganizationSlug(event: ChangeEvent<HTMLInputElement>): void {
    updateSetupState({
      type: "organization_slug_changed",
      value: event.target.value,
    });
  }

  function updateWorkspaceSlug(event: ChangeEvent<HTMLInputElement>): void {
    updateSetupState({
      type: "workspace_slug_changed",
      value: event.target.value,
    });
  }

  function requestAccountSwitch(): void {
    void switchAccount();
  }

  const hasUnsavedSetup = hasUnsavedFormChanges(
    [organizationName, organizationSlug, workspaceName, workspaceSlug],
    submitting,
  );

  return (
    <>
      <UnsavedChangesGuard
        active={hasUnsavedSetup}
        bypass={setupNavigationCommittedRef}
        title={t("publicEntry.setup.leaveTitle")}
      >
        {t("publicEntry.setup.leaveDescription")}
      </UnsavedChangesGuard>
      <PublicEntryShell
        headerEnd={t("common.account", {
          name: currentContext.human.displayName,
        })}
      >
        <section className="w-full max-w-[720px]">
          <h1
            className="m-0 text-[34px] font-bold leading-tight tracking-[-0.04em] text-[var(--ink)] sm:text-[40px]"
            data-page-focus-target
            tabIndex={-1}
          >
            {t("publicEntry.setup.title")}
          </h1>

          <div className="mt-8">
            <Form
              layout="vertical"
              onFinish={submitSetupForm}
              requiredMark={false}
            >
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Form.Item
                  help={fieldHelp("organizationName")}
                  htmlFor="setup-organization-name"
                  label={t("publicEntry.setup.organizationName")}
                  validateStatus={fieldErrors.organizationName ? "error" : ""}
                >
                  <KanvasInput
                    aria-errormessage={
                      fieldErrors.organizationName
                        ? "setup-organizationName-error"
                        : undefined
                    }
                    aria-invalid={
                      fieldErrors.organizationName ? true : undefined
                    }
                    autoComplete="organization"
                    disabled={submitting}
                    id="setup-organization-name"
                    maxLength={160}
                    onChange={updateOrganizationName}
                    placeholder={t(
                      "publicEntry.setup.organizationNamePlaceholder",
                    )}
                    ref={organizationNameInputRef}
                    size="large"
                    status={fieldErrors.organizationName ? "error" : ""}
                    value={organizationName}
                  />
                </Form.Item>

                <Form.Item
                  help={fieldHelp("workspaceName")}
                  htmlFor="setup-workspace-name"
                  label={t("publicEntry.setup.workspaceName")}
                  validateStatus={fieldErrors.workspaceName ? "error" : ""}
                >
                  <KanvasInput
                    aria-errormessage={
                      fieldErrors.workspaceName
                        ? "setup-workspaceName-error"
                        : undefined
                    }
                    aria-invalid={fieldErrors.workspaceName ? true : undefined}
                    autoComplete="off"
                    disabled={submitting}
                    id="setup-workspace-name"
                    maxLength={160}
                    onChange={updateWorkspaceName}
                    placeholder={t(
                      "publicEntry.setup.workspaceNamePlaceholder",
                    )}
                    ref={workspaceNameInputRef}
                    size="large"
                    status={fieldErrors.workspaceName ? "error" : ""}
                    value={workspaceName}
                  />
                </Form.Item>
              </div>

              <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
                <button
                  aria-expanded={urlSettingsOpen}
                  className={cn(
                    "flex min-h-12 w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent px-4 py-3 text-left text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--primary-soft)] focus-visible:!outline-none focus-visible:!shadow-[0_0_0_3px_var(--acid)]",
                    urlSettingsOpen ? "rounded-t-[15px]" : "rounded-[15px]",
                  )}
                  onClick={toggleUrlSettings}
                  type="button"
                >
                  <span>{t("publicEntry.setup.urlSettings")}</span>
                  <DownOutlined
                    aria-hidden="true"
                    className={cn(
                      "text-xs text-[var(--muted)] transition-transform",
                      urlSettingsOpen && "rotate-180",
                    )}
                  />
                </button>
                {urlSettingsOpen ? (
                  <div className="rounded-b-[15px] border-t border-[var(--line)] px-4 pt-4 pb-1">
                    <p className="m-0 mb-4 text-xs leading-5 text-[var(--muted)]">
                      {t("publicEntry.setup.urlSettingsDescription")}
                    </p>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                      <Form.Item
                        help={fieldHelp("organizationSlug")}
                        htmlFor="setup-organization-slug"
                        label={t("publicEntry.setup.organizationSlug")}
                        validateStatus={
                          fieldErrors.organizationSlug ? "error" : ""
                        }
                      >
                        <KanvasInput
                          aria-errormessage={
                            fieldErrors.organizationSlug
                              ? "setup-organizationSlug-error"
                              : undefined
                          }
                          aria-invalid={
                            fieldErrors.organizationSlug ? true : undefined
                          }
                          autoCapitalize="none"
                          autoComplete="off"
                          disabled={submitting}
                          id="setup-organization-slug"
                          maxLength={80}
                          onChange={updateOrganizationSlug}
                          pattern={instanceSetupSlugHtmlPattern}
                          placeholder={t(
                            "publicEntry.setup.organizationSlugPlaceholder",
                          )}
                          ref={organizationSlugInputRef}
                          size="large"
                          spellCheck={false}
                          status={fieldErrors.organizationSlug ? "error" : ""}
                          value={organizationSlug}
                        />
                      </Form.Item>
                      <Form.Item
                        help={fieldHelp("workspaceSlug")}
                        htmlFor="setup-workspace-slug"
                        label={t("publicEntry.setup.workspaceSlug")}
                        validateStatus={
                          fieldErrors.workspaceSlug ? "error" : ""
                        }
                      >
                        <KanvasInput
                          aria-errormessage={
                            fieldErrors.workspaceSlug
                              ? "setup-workspaceSlug-error"
                              : undefined
                          }
                          aria-invalid={
                            fieldErrors.workspaceSlug ? true : undefined
                          }
                          autoCapitalize="none"
                          autoComplete="off"
                          disabled={submitting}
                          id="setup-workspace-slug"
                          maxLength={80}
                          onChange={updateWorkspaceSlug}
                          pattern={instanceSetupSlugHtmlPattern}
                          placeholder={t(
                            "publicEntry.setup.workspaceSlugPlaceholder",
                          )}
                          ref={workspaceSlugInputRef}
                          size="large"
                          spellCheck={false}
                          status={fieldErrors.workspaceSlug ? "error" : ""}
                          value={workspaceSlug}
                        />
                      </Form.Item>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-6 grid gap-3">
                {error ? (
                  <Alert
                    title={error}
                    showIcon
                    type={switchAccountAvailable ? "warning" : "error"}
                    variant="outlined"
                  />
                ) : null}

                {switchAccountError ? (
                  <Alert
                    description={switchAccountError}
                    title={t("publicEntry.setup.switchErrorTitle")}
                    showIcon
                    type="error"
                    variant="outlined"
                  />
                ) : null}

                {switchAccountAvailable ? (
                  <Button
                    block
                    icon={<SwapOutlined />}
                    loading={switchingAccount}
                    onClick={requestAccountSwitch}
                    size="large"
                    type="primary"
                  >
                    {switchingAccount
                      ? t("common.switchingAccount")
                      : t("common.switchAccount")}
                  </Button>
                ) : (
                  <Button
                    block
                    disabled={switchingAccount}
                    htmlType="submit"
                    icon={<ArrowRightOutlined />}
                    iconPlacement="end"
                    loading={submitting}
                    size="large"
                    type="primary"
                  >
                    {submitting
                      ? t("publicEntry.setup.submitting")
                      : t("publicEntry.setup.submit")}
                  </Button>
                )}
              </div>
            </Form>
          </div>
        </section>
      </PublicEntryShell>
    </>
  );
}
