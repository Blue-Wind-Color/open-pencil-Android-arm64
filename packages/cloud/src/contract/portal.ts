/**
 * The pages a Cloud server shows on its own address: sign-in, desktop sign-in approval, account
 * settings, and the administration console. Every runtime serves the portal's `cloud.html` at
 * and below these paths, and at the server's root, which the portal sends on to its home;
 * everything else reaches the API.
 */
export const CLOUD_PORTAL_PAGE_ROOTS = ['/auth', '/cloud/device', '/account', '/admin'] as const

export function isCloudPortalPage(path: string): boolean {
  return (
    path === '/' ||
    CLOUD_PORTAL_PAGE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
  )
}
