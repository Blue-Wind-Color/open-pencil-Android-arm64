import { CloudPortalAPIError, type CloudAuthFailure } from '@open-pencil/cloud/client'
import { useCloudPortalMessages } from '@open-pencil/vue/i18n'

import { cloudAuthFailureMessage } from '@/app/cloud/sessions/account-form'

/** Words for a failed sign-in step, and for errors the provider sends back in the URL. */
export function usePortalFailureMessages() {
  const messages = useCloudPortalMessages()
  const failure = (kind: CloudAuthFailure) => cloudAuthFailureMessage(kind, messages.value)
  /** The provider's `error` query values after a social sign-in comes back, or null. */
  function callback(query: Record<string, unknown>): string | null {
    const values = ['error', 'error_description', 'error_code']
      .map((key) => query[key])
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (values.length === 0) return null
    if (values.includes('access_denied')) return messages.value.failureCancelled
    if (values.includes('enrollment_closed')) return messages.value.failureEnrollmentClosed
    if (values.includes('enrollment_approval_required')) return null
    return messages.value.failureUnavailable
  }
  /** Words for a failed account or console request. */
  function api(error: unknown): string {
    const value = messages.value
    if (!(error instanceof CloudPortalAPIError)) return value.failureUnavailable
    switch (error.kind) {
      case 'network':
      case 'timeout':
        return value.errorNetwork
      case 'authorization-required':
        return value.errorNotAllowed
      case 'authentication-required':
        return value.errorSessionNotFresh
      case 'cancelled':
      case 'protocol':
        return value.failureUnavailable
      case 'domain':
        break
    }
    switch (error.code) {
      case 'current_password_invalid':
        return value.failureInvalidCredentials
      case 'password_too_short':
        return value.failurePasswordTooShort
      case 'password_too_long':
        return value.failurePasswordTooLong
      case 'last_authentication_method':
        return value.errorLastMethod
      case 'session_not_fresh':
        return value.errorSessionNotFresh
      case 'last_admin_required':
        return value.errorLastAdmin
      case 'self_admin_action_forbidden':
        return value.errorSelfAction
      case 'mfa_required':
        return value.errorTwoStepRequired
      case 'invalid_enrollment_transition':
        return value.errorAlreadyDecided
      case 'rate_limited':
        return value.failureRateLimited
      default:
        return value.failureUnavailable
    }
  }
  return { failure, callback, api }
}
