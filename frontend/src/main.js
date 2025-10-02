// src/main.js
import "./assets/main.css";
import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import IndexPage from "./pages/IndexPage.vue";
import RegisterPage from "./pages/RegisterPage.vue";
import LoginPage from "./pages/LoginPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import GroupingsPage from "./pages/GroupingsPage.vue";
import { auth, refreshMe } from "./services/auth";
import { branding } from "./services/branding";
import TeamGenerator from "./pages/TeamGenerator.vue"; // Importing TeamGenerator component

// --- Router ---
const routes = [
  { path: "/login", component: LoginPage, meta: { public: true } },
  { path: "/", component: IndexPage, meta: { requiresAuth: true } },
  { path: "/register", component: RegisterPage, meta: { requiresAuth: true } },
  {
    path: "/groupings",
    component: GroupingsPage,
    meta: { requiresAuth: true },
  },
  { path: "/teams", component: TeamGenerator, meta: { requiresAuth: true } }, // Adding TeamGenerator route
  { path: "/settings", component: SettingsPage, meta: { requiresAuth: true } },
];

const router = createRouter({ history: createWebHistory(), routes });

// Guard: ensure we know who the user is (and load branding) before protected routes
let bootstrapped = false;
router.beforeEach(async (to) => {
  if (!bootstrapped) {
    await Promise.all([
      refreshMe(), // sets auth.user
      branding.load(), // loads activity_name/type/fee for header & UI
    ]);
    bootstrapped = true;
  }

  // require auth for protected routes
  if (to.meta?.requiresAuth && !auth.user) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }

  // if already logged in, don't go to /login
  if (to.path === "/login" && auth.user) {
    const redirect =
      typeof to.query.redirect === "string" && to.query.redirect
        ? to.query.redirect
        : "/";
    return { path: redirect };
  }

  // super-only settings
  if (to.path === "/settings" && auth.user?.role !== "super") {
    return { path: "/" };
  }
});

const app = createApp(App);
app.config.globalProperties.$auth = auth;

// branding.load(); // no need, we already load it in the guard
app.use(router).mount("#app");
