/**
 * Public service surface.
 * Other modules may import only this file, never this module's repo.
 */
export {
  AUTH_DELETE_RETRY_DAYS,
  EXPORT_VERSION,
  deleteMyAccount,
  exportMyData,
  runRetention,
  type PrivacyUser,
} from "./privacy-service";
export {
  privacyContributors,
  registerPrivacyContributors,
  type DeletionContext,
  type PrivacyContributor,
} from "./contributors";
export { recordConsent, storedConsent } from "./consent-service";
export { consentInput, deleteAccountInput } from "../schemas";
export { setPrivacyPorts, type PrivacyPorts } from "../../../ports";
