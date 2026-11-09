import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AppFrame } from "./components/shell.tsx";
import { validateActivitySearch } from "./lib/search.ts";
import { ActivityScreen } from "./screens/activity.tsx";
import { CategoryScreen } from "./screens/category.tsx";
import { CloseScreen } from "./screens/close.tsx";
import { CounterpartyScreen } from "./screens/counterparty.tsx";
import { HomeScreen } from "./screens/home.tsx";
import { ImportScreen } from "./screens/import.tsx";
import { PlanScreen } from "./screens/plan.tsx";
import { SettingsScreen } from "./screens/settings.tsx";
import { WalletScreen } from "./screens/wallet.tsx";

const root = createRootRoute({
  component: () => (
    <AppFrame>
      <Outlet />
    </AppFrame>
  ),
});

const home = createRoute({ getParentRoute: () => root, path: "/", component: HomeScreen });
const activity = createRoute({
  getParentRoute: () => root,
  path: "/activity",
  validateSearch: validateActivitySearch,
  component: function Activity() {
    return <ActivityScreen search={activity.useSearch()} />;
  },
});
const monthSearch = (s: Record<string, unknown>): { month?: string } =>
  typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? { month: s.month } : {};

const category = createRoute({
  getParentRoute: () => root,
  path: "/category/$id",
  validateSearch: monthSearch,
  component: function Category() {
    return <CategoryScreen id={category.useParams().id} month={category.useSearch().month} />;
  },
});
const wallet = createRoute({
  getParentRoute: () => root,
  path: "/wallet/$id",
  validateSearch: monthSearch,
  component: function Wallet() {
    const id = wallet.useParams().id;
    return <WalletScreen id={id === "sadapay" ? "sadapay" : "nayapay"} month={wallet.useSearch().month} />;
  },
});
const counterparty = createRoute({
  getParentRoute: () => root,
  path: "/counterparty/$id",
  component: function Counterparty() {
    return <CounterpartyScreen id={counterparty.useParams().id} />;
  },
});
const plan = createRoute({ getParentRoute: () => root, path: "/plan", component: PlanScreen });
const close = createRoute({
  getParentRoute: () => root,
  path: "/close",
  validateSearch: monthSearch,
  component: function Close() {
    const { month } = close.useSearch();
    return <CloseScreen {...(month ? { month } : {})} />;
  },
});
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsScreen });
const importRoute = createRoute({ getParentRoute: () => root, path: "/import", component: ImportScreen });

const tree = root.addChildren([
  home,
  activity,
  category,
  wallet,
  counterparty,
  plan,
  close,
  settings,
  importRoute,
]);

export function makeRouter() {
  return createRouter({
    routeTree: tree,
    history: createHashHistory(),
    defaultPreload: false,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
