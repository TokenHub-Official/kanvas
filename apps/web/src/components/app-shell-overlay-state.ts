export interface AppShellOverlayState {
  readonly accountMenuOpen: boolean;
  readonly createDialogOpen: boolean;
  readonly createImportError?: string | undefined;
  readonly workspaceDrawerOpen: boolean;
  readonly workspaceMenuOpen: boolean;
  readonly workspaceQuery: string;
}

type AppShellOverlayAction =
  | { readonly type: "account_menu_changed"; readonly open: boolean }
  | { readonly type: "breakpoint_changed"; readonly desktop: boolean }
  | { readonly type: "close_workspace_panels" }
  | { readonly type: "create_closed" }
  | { readonly type: "create_error_cleared" }
  | { readonly type: "create_import_failed"; readonly error: string }
  | { readonly type: "create_import_succeeded" }
  | { readonly type: "create_opened" }
  | { readonly type: "drawer_opened" }
  | { readonly type: "workspace_menu_changed"; readonly open: boolean }
  | { readonly type: "workspace_query_changed"; readonly query: string };

export const initialAppShellOverlayState: AppShellOverlayState = {
  accountMenuOpen: false,
  createDialogOpen: false,
  workspaceDrawerOpen: false,
  workspaceMenuOpen: false,
  workspaceQuery: "",
};

export function reduceAppShellOverlay(
  state: AppShellOverlayState,
  action: AppShellOverlayAction,
): AppShellOverlayState {
  switch (action.type) {
    case "workspace_menu_changed":
      return {
        ...state,
        accountMenuOpen: action.open ? false : state.accountMenuOpen,
        workspaceMenuOpen: action.open,
        workspaceQuery: action.open ? state.workspaceQuery : "",
      };
    case "account_menu_changed":
      return {
        ...state,
        accountMenuOpen: action.open,
        workspaceMenuOpen: action.open ? false : state.workspaceMenuOpen,
        workspaceQuery: action.open ? "" : state.workspaceQuery,
      };
    case "drawer_opened":
      return {
        ...state,
        accountMenuOpen: false,
        workspaceDrawerOpen: true,
      };
    case "close_workspace_panels":
      return {
        ...state,
        workspaceDrawerOpen: false,
        workspaceMenuOpen: false,
        workspaceQuery: "",
      };
    case "breakpoint_changed":
      return {
        ...state,
        accountMenuOpen: false,
        workspaceDrawerOpen: action.desktop ? false : state.workspaceDrawerOpen,
        workspaceMenuOpen: action.desktop ? state.workspaceMenuOpen : false,
        workspaceQuery: "",
      };
    case "workspace_query_changed":
      return { ...state, workspaceQuery: action.query };
    case "create_opened":
      return {
        ...state,
        createDialogOpen: true,
        createImportError: undefined,
      };
    case "create_closed":
    case "create_import_succeeded":
      return {
        ...state,
        createDialogOpen: false,
        createImportError: undefined,
      };
    case "create_import_failed":
      return { ...state, createImportError: action.error };
    case "create_error_cleared":
      return { ...state, createImportError: undefined };
  }
}
