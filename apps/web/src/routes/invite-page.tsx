import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudSyncOutlined,
  HomeOutlined,
  MailOutlined,
  ReloadOutlined,
  StopOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Alert, Button, Form } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  acceptWorkspaceInvitation,
  ApiProblem,
  fetchCurrentHumanContext,
  registerInvitationAccount,
  resolveWorkspaceInvitation,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import {
  EmailRegistrationSignInError,
  emailRegistrationRequiresVerification,
  fetchLoginMethods,
  signInEmailRegistration,
  startOAuth,
  type LoginProvider,
} from "../auth/oauth.js";
import { emailVerificationCallbackUrl } from "../auth/email-verification.js";
import { authClient } from "../auth/auth-client.js";
import { clearWorkspacePreference } from "../auth/entry-recovery.js";
import {
  invitationAcceptanceErrorCode,
  invitationPrimaryAction,
  type InvitationAuthenticationState,
} from "../auth/invitation-recovery.js";
import brokenLinkIcon from "../assets/icons/ant-design/DisconnectOutlined.svg";
import openingEnvelopeIcon from "../assets/icons/ant-design/MailOutlined.svg";
import { DoodleIcon } from "../components/doodle-icon.js";
import { PageLoading } from "../components/feedback.js";
import {
  KanvasInput,
  KanvasPasswordInput,
} from "../components/kanvas-input.js";
import {
  PublicEntryShell,
  PublicResult,
} from "../components/public-entry-shell.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { queryClient } from "../query-client.js";

const inviteRouteApi = getRouteApi("/invite/$invitationToken");

interface InvitationRegistrationFields {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

function invitationRegistrationErrorKey(
  error: unknown,
):
  | "accountExists"
  | "emailMismatch"
  | "invitationChanged"
  | "signInFailed"
  | "unavailable" {
  if (error instanceof EmailRegistrationSignInError) {
    return "signInFailed";
  }
  if (!(error instanceof ApiProblem)) {
    return "unavailable";
  }
  if (error.code === "invitation_registration.email_mismatch") {
    return "emailMismatch";
  }
  if (error.code === "invitation_registration.account_exists") {
    return "accountExists";
  }
  if (
    error.status === httpStatus.notFound ||
    error.code === "invitation_registration.changed"
  ) {
    return "invitationChanged";
  }
  return "unavailable";
}

export function InvitePage(): React.JSX.Element {
  const { t } = useTranslation();
  useDocumentTitle(t("publicEntry.invite.documentTitle"));
  const { invitationToken } = inviteRouteApi.useParams();
  const navigate = useNavigate();
  const invitationReturnTo = `/invite/${invitationToken}`;
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [switchAccountError, setSwitchAccountError] = useState<string>();
  const [registrationVisible, setRegistrationVisible] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string>();
  const [resending, setResending] = useState(false);
  const [verificationError, setVerificationError] = useState(false);
  const [oidcPending, setOidcPending] = useState<string>();
  const methods = useQuery({
    queryKey: ["authentication", "login-methods"],
    queryFn: fetchLoginMethods,
    retry: false,
  });
  const emailVerificationRequired = emailRegistrationRequiresVerification(
    methods.data,
  );
  const invitation = useQuery({
    queryKey: ["workspace-invitation", invitationToken],
    queryFn: () => resolveWorkspaceInvitation(invitationToken),
    retry: false,
  });
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    retry: false,
  });
  const invitationRecovery = usePageQueryRecovery(invitation.refetch);
  const accept = useMutation({
    mutationFn: async () => {
      if (!context.data) {
        throw new Error("Current Human context is unavailable.");
      }
      return acceptWorkspaceInvitation(context.data.csrfToken, {
        invitationToken,
      });
    },
    onSuccess: (accepted) => {
      queryClient.clear();
      void navigate({
        params: {
          workspaceId: accepted.workspaceId,
        },
        replace: true,
        to: "/w/$workspaceId",
      });
    },
    onError: async (error) => {
      await invitation.refetch();
      if (
        error instanceof ApiProblem &&
        error.status === httpStatus.unauthorized
      ) {
        await context.refetch();
      }
    },
  });
  const registration = useMutation({
    mutationFn: async (fields: InvitationRegistrationFields) => {
      const email = fields.email.trim().toLowerCase();
      await registerInvitationAccount({
        invitationToken,
        email,
        displayName: fields.displayName.trim(),
        password: fields.password,
      });
      if (!emailVerificationRequired) {
        await signInEmailRegistration(email, fields.password);
      }
      return { email, verificationRequired: emailVerificationRequired };
    },
    onSuccess: async ({ email, verificationRequired }) => {
      setVerificationError(false);
      if (verificationRequired) {
        setVerificationEmail(email);
        setRegistrationVisible(false);
        return;
      }
      setVerificationEmail(undefined);
      const [currentContext, currentInvitation] = await Promise.all([
        context.refetch(),
        invitation.refetch(),
      ]);
      if (currentContext.isError || currentInvitation.isError) {
        setVerificationError(true);
      }
      setRegistrationVisible(false);
    },
    onError: async (error) => {
      if (
        error instanceof ApiProblem &&
        (error.status === httpStatus.notFound ||
          error.code === "invitation_registration.changed")
      ) {
        await invitation.refetch();
      }
    },
  });

  function retryIdentity(): void {
    void context.refetch();
  }
  function retryLoginMethods(): void {
    void methods.refetch();
  }
  function requestVerificationEmail(): void {
    void resendVerification();
  }

  async function resendVerification(): Promise<void> {
    if (!emailVerificationRequired) return;
    const email =
      verificationEmail ?? registration.variables?.email.trim().toLowerCase();
    if (!email || resending) return;
    setResending(true);
    setVerificationError(false);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: emailVerificationCallbackUrl(
          window.location.origin,
          invitationReturnTo,
        ),
      });
      if (result.error) throw new Error("Verification delivery failed");
      setVerificationEmail(email);
      setRegistrationVisible(false);
    } catch {
      setVerificationError(true);
    } finally {
      setResending(false);
    }
  }

  async function continueWithOidc(provider: LoginProvider): Promise<void> {
    if (oidcPending) return;
    setOidcPending(provider.id);
    setVerificationError(false);
    try {
      const refreshed = await invitation.refetch();
      if (refreshed.data?.state !== "pending")
        throw new Error("Invitation unavailable");
      await startOAuth(
        provider,
        invitationReturnTo,
        `/login?returnTo=${encodeURIComponent(invitationReturnTo)}`,
      );
    } catch {
      setVerificationError(true);
      setOidcPending(undefined);
    }
  }

  if (invitation.isPending) {
    return <PageLoading label={t("publicEntry.invite.loading")} />;
  }
  if (invitation.isError) {
    const invalidInvitation =
      invitation.error instanceof ApiProblem &&
      (invitation.error.status === httpStatus.badRequest ||
        invitation.error.status === httpStatus.notFound);
    return (
      <PublicEntryShell>
        <PublicResult
          description={
            invalidInvitation
              ? t("publicEntry.invite.invalidDescription")
              : t("publicEntry.invite.unavailableDescription")
          }
          icon={
            invalidInvitation ? (
              <DoodleIcon
                aspectRatio="163 / 154"
                className="h-[72px] w-auto"
                source={brokenLinkIcon}
              />
            ) : (
              <CloudSyncOutlined />
            )
          }
          primaryAction={{
            icon: invalidInvitation ? <HomeOutlined /> : <ReloadOutlined />,
            label: invalidInvitation
              ? t("common.returnHome")
              : t("publicEntry.invite.retryInvitation"),
            loading: !invalidInvitation && invitationRecovery.pending,
            onClick: () => {
              if (invalidInvitation) {
                void navigate({
                  to: "/",
                });
                return;
              }
              invitationRecovery.retry();
            },
          }}
          {...(invalidInvitation
            ? {}
            : {
                secondaryAction: {
                  icon: <HomeOutlined />,
                  label: t("common.returnHome"),
                  onClick: () => {
                    void navigate({ to: "/" });
                  },
                },
              })}
          title={
            invalidInvitation
              ? t("publicEntry.invite.invalidTitle")
              : t("publicEntry.invite.unavailableTitle")
          }
          tone={invalidInvitation ? "danger" : "warning"}
          visualVariant={invalidInvitation ? "illustration" : "symbol"}
        />
      </PublicEntryShell>
    );
  }

  const value = invitation.data;
  const unauthenticated =
    context.error instanceof ApiProblem &&
    context.error.status === httpStatus.unauthorized;
  let authenticationState: InvitationAuthenticationState = "error";
  if (context.data) {
    authenticationState = "authenticated";
  } else if (unauthenticated) {
    authenticationState = "unauthenticated";
  } else if (context.isPending) {
    authenticationState = "pending";
  }
  const primaryAction = invitationPrimaryAction(
    value.state,
    authenticationState,
    Boolean(
      context.data?.workspaces.some(
        (workspace) => workspace.id === value.workspace.id,
      ),
    ),
    value.identityStatus,
  );

  async function switchAccount(): Promise<void> {
    if (accept.isPending || switchingAccount) {
      return;
    }
    setSwitchingAccount(true);
    setSwitchAccountError(undefined);
    accept.reset();
    try {
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error("Session revocation failed.");
      }
      queryClient.clear();
      clearWorkspacePreference(window.localStorage);
      void navigate({
        search: {
          returnTo: invitationReturnTo,
        },
        to: "/login",
      });
    } catch {
      setSwitchingAccount(false);
      setSwitchAccountError(t("publicEntry.invite.switchErrorDescription"));
    }
  }

  function goToLogin(): void {
    void navigate({
      search: {
        returnTo: invitationReturnTo,
      },
      to: "/login",
    });
  }

  function returnHome(): void {
    void navigate({
      to: "/",
    });
  }

  function requestAccountSwitch(): void {
    void switchAccount();
  }

  function submitRegistration(fields: InvitationRegistrationFields): void {
    registration.reset();
    setVerificationError(false);
    registration.mutate(fields);
  }

  function cancelRegistration(): void {
    registration.reset();
    setRegistrationVisible(false);
  }

  function confirmInvitation(): void {
    setSwitchAccountError(undefined);
    accept.mutate();
  }

  if (value.state === "expired" || value.state === "revoked") {
    const expired = value.state === "expired";
    return (
      <PublicEntryShell>
        <PublicResult
          description={t(
            expired
              ? "publicEntry.invite.expiredDescription"
              : "publicEntry.invite.revokedDescription",
          )}
          icon={expired ? <ClockCircleOutlined /> : <StopOutlined />}
          primaryAction={{
            icon: <HomeOutlined />,
            label: t("common.returnHome"),
            onClick: returnHome,
          }}
          title={t(
            expired
              ? "publicEntry.invite.expiredTitle"
              : "publicEntry.invite.revokedTitle",
          )}
          tone={expired ? "warning" : "danger"}
        />
      </PublicEntryShell>
    );
  }

  if (value.state === "accepted") {
    if (primaryAction === "verify-identity") {
      return <PageLoading label={t("publicEntry.invite.validatingIdentity")} />;
    }

    if (primaryAction === "retry-identity") {
      return (
        <PublicEntryShell>
          <PublicResult
            description={t("publicEntry.invite.identityUnavailableDescription")}
            icon={<CloudSyncOutlined />}
            primaryAction={{
              icon: <ReloadOutlined />,
              label: t("publicEntry.invite.retryIdentity"),
              onClick: () => {
                void context.refetch();
              },
            }}
            secondaryAction={{
              icon: <HomeOutlined />,
              label: t("common.returnHome"),
              onClick: returnHome,
            }}
            title={t("publicEntry.invite.identityUnavailableTitle")}
            tone="warning"
          />
        </PublicEntryShell>
      );
    }

    if (primaryAction === "access-removed") {
      return (
        <PublicEntryShell>
          <PublicResult
            title={t("publicEntry.invite.accessRemovedTitle")}
            description={t("publicEntry.invite.accessRemovedDescription")}
            icon={<StopOutlined />}
            tone="warning"
            primaryAction={{
              icon: <HomeOutlined />,
              label: t("common.returnHome"),
              onClick: returnHome,
            }}
          />
        </PublicEntryShell>
      );
    }

    if (primaryAction === "switch-account-to-enter") {
      return (
        <PublicEntryShell headerEnd={context.data?.human.displayName}>
          <PublicResult
            description={
              switchAccountError ??
              t("publicEntry.invite.currentAccountNoAccessDescription")
            }
            icon={<SwapOutlined />}
            primaryAction={{
              icon: <SwapOutlined />,
              label: switchingAccount
                ? t("common.switchingAccount")
                : t("publicEntry.invite.switchThenEnter"),
              loading: switchingAccount,
              onClick: requestAccountSwitch,
            }}
            secondaryAction={{
              icon: <HomeOutlined />,
              label: t("common.returnHome"),
              onClick: returnHome,
            }}
            title={t("publicEntry.invite.currentAccountNoAccessTitle")}
            tone={switchAccountError ? "danger" : "warning"}
          />
        </PublicEntryShell>
      );
    }

    const enterWorkspace = primaryAction === "enter-workspace";
    return (
      <PublicEntryShell headerEnd={context.data?.human.displayName}>
        <PublicResult
          description={t("publicEntry.invite.acceptedDescription", {
            workspace: value.workspace.name,
          })}
          icon={<CheckCircleOutlined />}
          primaryAction={{
            icon: <ArrowRightOutlined />,
            iconPlacement: "end",
            label: enterWorkspace
              ? t("publicEntry.invite.enterWorkspace")
              : t("publicEntry.invite.loginThenEnter"),
            onClick: enterWorkspace
              ? () => {
                  void navigate({
                    params: {
                      workspaceId: value.workspace.id,
                    },
                    to: "/w/$workspaceId",
                  });
                }
              : goToLogin,
          }}
          title={t("publicEntry.invite.acceptedTitle", {
            workspace: value.workspace.name,
          })}
          tone="success"
        />
      </PublicEntryShell>
    );
  }

  const role = t(`publicEntry.invite.roles.${value.workspaceRole}`);
  const currentAccount =
    context.data?.human.verifiedEmail ?? context.data?.human.displayName;

  return (
    <PublicEntryShell
      headerEnd={context.data ? context.data.human.displayName : undefined}
    >
      <section className="w-full max-w-[620px] rounded-[28px] border border-[var(--line)] bg-[var(--paper)] px-6 py-8 shadow-[0_20px_60px_rgb(37_34_65/8%)] sm:px-10 sm:py-11">
        <div
          aria-hidden="true"
          className="grid h-24 w-24 place-items-center rounded-[26px] bg-[var(--primary-soft)] text-[var(--primary)]"
        >
          <DoodleIcon
            aspectRatio="177 / 206"
            className="h-[76px] w-auto"
            source={openingEnvelopeIcon}
          />
        </div>
        <h1
          className="m-0 mt-7 text-[34px] font-bold leading-tight tracking-[-0.04em] text-[var(--ink)] sm:text-[42px]"
          data-page-focus-target
          tabIndex={-1}
        >
          {t("publicEntry.invite.pendingTitle", {
            workspace: value.workspace.name,
          })}
        </h1>
        <p className="m-0 mt-3 text-sm leading-6 text-[var(--muted)] sm:text-base">
          {t("publicEntry.invite.pendingDescription", {
            organization: value.organization.name,
            role,
          })}
        </p>

        <dl className="m-0 mt-8 border-y border-[var(--line)]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 py-4">
            <dt className="text-xs font-bold text-[var(--muted)]">
              {t("publicEntry.invite.invitedEmail")}
            </dt>
            <dd className="m-0 min-w-0 truncate text-right text-sm font-semibold text-[var(--ink)]">
              {value.targetEmailMasked}
            </dd>
          </div>
        </dl>

        {currentAccount ? (
          <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-[var(--mist)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <span className="block text-xs font-bold text-[var(--muted)]">
                {t("publicEntry.invite.currentAccount")}
              </span>
              <strong className="mt-1 block truncate text-sm text-[var(--ink)]">
                {currentAccount}
              </strong>
            </div>
            {primaryAction === "accept" ? (
              <Button
                className="self-start sm:self-auto"
                disabled={accept.isPending}
                icon={<SwapOutlined />}
                loading={switchingAccount}
                onClick={requestAccountSwitch}
                type="text"
              >
                {switchingAccount
                  ? t("common.switchingAccount")
                  : t("common.switchAccount")}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 grid gap-3">
          {switchAccountError ? (
            <Alert title={switchAccountError} showIcon type="error" />
          ) : null}

          {primaryAction === "verify-identity" ? (
            <Button block loading size="large" type="primary">
              {t("publicEntry.invite.validatingIdentity")}
            </Button>
          ) : null}
          {primaryAction === "retry-identity" ? (
            <>
              <Alert
                description={t(
                  "publicEntry.invite.identityUnavailableDescription",
                )}
                title={t("publicEntry.invite.identityUnavailableTitle")}
                showIcon
                type="error"
              />
              <Button
                block
                icon={<ReloadOutlined />}
                onClick={retryIdentity}
                size="large"
              >
                {t("publicEntry.invite.retryIdentity")}
              </Button>
            </>
          ) : null}
          {verificationError ? (
            <Alert
              type="error"
              showIcon
              title={t("publicEntry.invite.verificationFailed")}
            />
          ) : null}
          {primaryAction === "register-or-login" && verificationEmail ? (
            <div className="grid gap-3">
              <Alert
                type="info"
                showIcon
                icon={<MailOutlined />}
                title={t("publicEntry.invite.verificationSent")}
                description={t("publicEntry.invite.verificationDescription")}
              />
              <Button loading={resending} onClick={requestVerificationEmail}>
                {t("publicEntry.invite.resendVerification")}
              </Button>
              <Button onClick={goToLogin}>
                {t("publicEntry.invite.existingAccountLogin")}
              </Button>
            </div>
          ) : null}
          {primaryAction === "register-or-login" &&
          registrationVisible &&
          !verificationEmail ? (
            <Form<InvitationRegistrationFields>
              layout="vertical"
              onFinish={submitRegistration}
              requiredMark={false}
            >
              <Form.Item
                label={t("publicEntry.invite.email")}
                name="email"
                rules={[
                  {
                    required: true,
                    message: t(
                      "publicEntry.invite.registrationValidation.emailRequired",
                    ),
                  },
                  {
                    type: "email",
                    message: t(
                      "publicEntry.invite.registrationValidation.emailInvalid",
                    ),
                  },
                ]}
              >
                <KanvasInput
                  autoCapitalize="none"
                  autoComplete="email"
                  disabled={registration.isPending}
                  placeholder={t("publicEntry.invite.emailPlaceholder")}
                  size="large"
                  spellCheck={false}
                />
              </Form.Item>
              <Form.Item
                label={t("publicEntry.invite.displayName")}
                name="displayName"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: t(
                      "publicEntry.invite.registrationValidation.displayNameRequired",
                    ),
                  },
                ]}
              >
                <KanvasInput
                  autoComplete="name"
                  disabled={registration.isPending}
                  placeholder={t("publicEntry.invite.displayNamePlaceholder")}
                  size="large"
                />
              </Form.Item>
              <Form.Item
                label={t("publicEntry.invite.password")}
                name="password"
                rules={[
                  {
                    required: true,
                    message: t(
                      "publicEntry.invite.registrationValidation.passwordRequired",
                    ),
                  },
                  {
                    min: 8,
                    message: t(
                      "publicEntry.invite.registrationValidation.passwordLength",
                    ),
                  },
                ]}
              >
                <KanvasPasswordInput
                  autoComplete="new-password"
                  disabled={registration.isPending}
                  placeholder={t("publicEntry.invite.passwordPlaceholder")}
                  size="large"
                />
              </Form.Item>
              {registration.error ? (
                <div className="-mt-2 mb-5">
                  <Alert
                    role="alert"
                    showIcon
                    title={t(
                      `publicEntry.invite.registrationErrors.${invitationRegistrationErrorKey(
                        registration.error,
                      )}`,
                    )}
                    type="error"
                    variant="filled"
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
                    ? t("publicEntry.invite.registering")
                    : t(
                        emailVerificationRequired
                          ? "publicEntry.invite.register"
                          : "publicEntry.invite.registerWithoutVerification",
                      )}
                </Button>
                <Button
                  disabled={registration.isPending}
                  onClick={cancelRegistration}
                  size="large"
                >
                  {t("publicEntry.invite.cancelRegistration")}
                </Button>
              </div>
              {registration.isError ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={goToLogin}>
                    {t("publicEntry.invite.existingAccountLogin")}
                  </Button>
                  {emailVerificationRequired ? (
                    <Button
                      loading={resending}
                      onClick={requestVerificationEmail}
                    >
                      {t("publicEntry.invite.resendVerification")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Form>
          ) : null}
          {primaryAction === "register-or-login" &&
          !registrationVisible &&
          !verificationEmail ? (
            <>
              {methods.isError ? (
                <Button onClick={retryLoginMethods}>{t("common.retry")}</Button>
              ) : null}
              {methods.isSuccess &&
              !methods.data.emailPasswordInvitationEnabled &&
              !methods.data.providers.some(
                (provider) => provider.type === "oidc",
              ) ? (
                <p className="m-0 text-sm text-muted">
                  {t("publicEntry.invite.existingOnly")}
                </p>
              ) : null}
              {methods.data?.providers
                .filter((provider) => provider.type === "oidc")
                .map((provider) => (
                  <Button
                    key={provider.id}
                    block
                    loading={oidcPending === provider.id}
                    disabled={Boolean(oidcPending)}
                    onClick={() => void continueWithOidc(provider)}
                  >
                    {t("publicEntry.oauth.signIn", { name: provider.name })}
                  </Button>
                ))}
              {methods.data?.emailPasswordInvitationEnabled ? (
                <Button
                  block
                  icon={<ArrowRightOutlined />}
                  iconPlacement="end"
                  onClick={() => {
                    setRegistrationVisible(true);
                  }}
                  size="large"
                  type="primary"
                >
                  {t("publicEntry.invite.createAccount")}
                </Button>
              ) : null}
              <Button block onClick={goToLogin} size="large">
                {t("publicEntry.invite.existingAccountLogin")}
              </Button>
            </>
          ) : null}
          {primaryAction === "switch-account-to-accept" ? (
            <>
              <Alert
                description={t(
                  value.identityStatus === "unverified"
                    ? "publicEntry.invite.unverifiedAccountDescription"
                    : "publicEntry.invite.accountMismatchDescription",
                )}
                title={t("publicEntry.invite.accountMismatchTitle")}
                showIcon
                type="warning"
                variant="filled"
              />
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
                  : t("publicEntry.invite.switchThenAccept")}
              </Button>
            </>
          ) : null}
          {primaryAction === "accept" && context.data ? (
            <>
              {accept.error ? (
                <Alert
                  title={t(
                    `publicEntry.invite.errors.${invitationAcceptanceErrorCode(
                      accept.error instanceof ApiProblem
                        ? accept.error.status
                        : undefined,
                    )}`,
                  )}
                  showIcon
                  type="error"
                />
              ) : null}
              <Button
                block
                disabled={switchingAccount}
                icon={<ArrowRightOutlined />}
                iconPlacement="end"
                loading={accept.isPending}
                onClick={confirmInvitation}
                size="large"
                type="primary"
              >
                {accept.isPending
                  ? t("publicEntry.invite.confirming")
                  : t("publicEntry.invite.confirm")}
              </Button>
            </>
          ) : null}
        </div>
      </section>
    </PublicEntryShell>
  );
}
