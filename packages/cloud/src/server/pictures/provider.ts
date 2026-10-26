import { signInMethod } from '#cloud/server/auth/activity'
import type { BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'

import type { UserPictureService } from './service'

/** Whether an endpoint signs in with another service, which may name the person's picture. */
function providerSignIn(context: { path?: string } | null): boolean {
  const path = context?.path ?? ''
  return path.startsWith('/callback/') || path === '/sign-in/social'
}

/**
 * Keeps the picture a Google account gave the person once a sign-in issues their session, so pages
 * show the server's copy and never load it from Google. Accounts made before the server kept
 * pictures move over the next time they sign in this way. Better Auth also takes an `image` on
 * email sign-up and user updates; only a provider's sign-in may set one through it, since the
 * server fetches it, and the server writes its own addresses itself.
 */
export function providerPictures(pictures: UserPictureService): BetterAuthPlugin {
  const refused = (image: unknown, context: { path?: string } | null) =>
    image !== undefined && image !== null && !providerSignIn(context)
  return {
    id: 'openpencil-provider-pictures',
    init: () => ({
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (user, context) =>
                refused(user.image, context) ? { data: { ...user, image: null } } : true
            },
            update: {
              // Better Auth merges what a hook returns into the update, so `image` is unset.
              before: async (user, context) =>
                refused(user.image, context) ? { data: { image: undefined } } : true
            }
          }
        }
      }
    }),
    hooks: {
      after: [
        {
          matcher: (context) => signInMethod(context) !== null,
          handler: createAuthMiddleware(async (context) => {
            const user = context.context.newSession?.user
            if (user?.image && !pictures.served(user.image)) {
              await pictures.copyFromProvider(user.id, user.image)
            }
          })
        }
      ]
    }
  }
}
