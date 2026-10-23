/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />
/// <reference types="unplugin-icons/types/vue" />

interface ImportMetaEnv {
  /** `on` only in official release builds; without it the app sends no pings or usage stats. */
  readonly VITE_OPENPENCIL_FEEDBACK?: string
  /** The official Cloud server's address, set by the build an official deployment serves. */
  readonly VITE_OPENPENCIL_OFFICIAL_CLOUD_URL?: string
}

declare const __OPENPENCIL_APP_VERSION__: string
/** Whether this is the editor a Cloud server serves on its own address (`bun run build:cloud`). */
declare const __OPENPENCIL_CLOUD_SITE__: boolean
declare const __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: string | null
declare const __OPENPENCIL_LOCAL_AUTOMATION_URL__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_HTTP_URL__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
