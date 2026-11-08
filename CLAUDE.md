# About this app

This file describes this app's stack, structure, and conventions. **Keep it updated and short**: when the app gains a backend, new conventions, or significant structure, edit this file (and the README) in place so future sessions inherit that knowledge. This file is loaded into every session, so it describes the current state only. Never add dated or per-task entries, change logs, or test results, even if earlier ones exist. Put notable decisions in `docs/HISTORY.md` as one line each, and keep this file under about 200 lines.

## Stack

- Expo cross-platform app (iOS / Android / Web), TypeScript (strict), Expo Router (file-based routing under `app/`)
- NativeWind (Tailwind for RN) for styling
- Yarn Berry (v4.x) — check `.yarnrc.yml` for the linker; with Plug'n'Play there is no traditional `node_modules`. Patching dependencies is a last resort; use `yarn patch`, never hand-edit.
- React Query available for server state when a backend is wired
- Path aliases are defined in `tsconfig.json` `paths` — use them instead of long relative imports.

## Theming

Keep colors and typography centralized in the app's existing theme setup (Tailwind config, theme files, or CSS variables) and use them through NativeWind classes — never hardcode per screen. When changing colors/typography, update the central definitions. Support both light and dark with readable contrast if the app supports both.

## Conventions

- **Reuse first:** use the app's existing component, icon, and styling libraries and patterns before adding new ones. Check `package.json` and existing components before introducing a dependency.
- **Icons:** use the app's existing icon approach. If icons need NativeWind classes, make sure they go through a wrapper or interop that applies them.
- **Navigation:** set an explicit human-friendly `title` for every screen header — never let route names like `(tabs)` or `products/[id]` appear in the UI. Keep `app/index.tsx` for redirects, not feature UI; use `_layout.tsx` files for stacks/tabs.
- **API routes:** server-only logic can live in Expo Router API routes (`+api.ts` files under `app/`). They require `web.output: "server"` in the app config and run in the preview; secrets they read use unprefixed environment variables, never `EXPO_PUBLIC_`.
- **Fonts:** load through the `expo-font` config plugin (declared in the app config) or `useFonts` in the root layout — follow whichever the app already uses.
- **Screens:** wrap in SafeAreaView (react-native-safe-area-context) and handle scrolling/gestures correctly. Keep bottom tab bars compact — pad content inside screens, not via `tabBarStyle`.
- **Components:** keep components small and focused, follow the app's existing folder structure, and reuse before creating.
- **Performance:** `FlatList`/`SectionList` for long lists — never `ScrollView` + `.map()` for large collections.

## Critical files

- `app/_layout.tsx` — root layout and app-wide providers
- `tailwind.config.js` and `global.css` — NativeWind config and global styles
- `app.config.*` — Expo app config

## Draftbit starter structure (if present)

Apps created from the Draftbit starter ship with the pieces below. Follow them where they exist; don't add them to apps that don't have them.

- **Theming:** `theming/ThemeProvider.tsx` injects theme objects (colors + typography) as CSS variables via NativeWind's `vars()`; typography is flattened (`h1.fontSize` → `--h1-fontSize`). Theme shape in `theming/Theme.ts`, concrete themes in `theming/themes/light.ts` and `dark.ts`, mapped to classes (`text-foreground`, `bg-background`, `text-h1`, `border-border`, …) in `tailwind.config.js`. `lib/useColorScheme.tsx` syncs the system preference. Use `useTheme()` only for raw values; change colors/typography in the theme files.
- **Components:** React Native Reusables (shadcn-style, `@rn-primitives/*`) in `components/ui/`, layout pieces in `components/layout/`, `cn` helper in `lib/utils.ts`. Build higher-level components on these primitives. Without `components/ui/` and `@rn-primitives/*` in `package.json`, compose React Native primitives with NativeWind instead and don't pull `@rn-primitives/*` in unless asked.
- **Icons:** `lib/icons/LucideIcon` wraps Lucide so NativeWind classes apply — `<LucideIcon name="Home" className="h-6 w-6 text-foreground" />`. Don't import from `lucide-react-native` directly, and validate `name` against the wrapper's registry.
- **Portals:** web uses `WebPortalContext`, native uses `PortalHost` from `@rn-primitives/portal`, both set up in `app/_layout.tsx`; the `components/ui/` primitives rely on them.
- **Modals on web:** `react-native` `Modal` renders outside the `ThemeProvider` wrapper on web in apps created before the template fix, so theme classes (`bg-card`, `text-foreground`, `border-border`, …) resolve to nothing and the modal shows up transparent. Prefer the `components/ui/` dialog/sheet primitives or a route; if you use `Modal`, wrap its content in `<ThemeProvider key={theme.name} initialThemeName={theme.name} themes={[theme]}>` with `theme` from `useTheme()`.
- **Alias:** `~/*` maps to the project root, e.g. `import { useTheme } from '~/theming/ThemeProvider';`.

## Current state

<!-- Update this section as the app evolves: connected backend and how data flows,
     key screens and routes, state stores, env vars the app expects, known TODOs. -->

- Fresh scaffold; no backend connected yet.
