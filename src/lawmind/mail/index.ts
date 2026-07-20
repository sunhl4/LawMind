export {
  MAIL_PROVIDER_PRESETS,
  getMailProviderPreset,
  resolveImapEndpoints,
  resolveSmtpEndpoints,
  type MailProviderId,
  type MailAuthKind,
  type MailProviderPreset,
} from "./provider-presets.js";
export {
  listMailAccounts,
  listPublicMailAccounts,
  getMailAccount,
  upsertMailAccount,
  deleteMailAccount,
  resolveMailAccountForMatter,
  toPublicMailAccount,
  saveMailAccount,
  type MailAccount,
  type MailAccountPublic,
  type UpsertMailAccountInput,
  type MailWatchContact,
} from "./mail-accounts.js";
export {
  sanitizeWatchContacts,
  messageMatchesWatchContacts,
  describeWatchContacts,
  normalizeEmailAddress,
} from "./watch-contacts.js";
export {
  getMailAccountSecret,
  upsertMailAccountSecret,
  deleteMailAccountSecret,
  hasMailAccountSecret,
  type MailAccountSecret,
} from "./mail-secrets.js";
export {
  testMailAccountConnection,
  syncMailAccountToMatter,
  syncMatterMailbox,
  sendMailViaAccount,
  persistFetchedMessages,
  countEnabledMailAccounts,
  type SyncInboxResult,
} from "./sync-inbox.js";
export {
  testImapConnection,
  fetchImapMessages,
  shouldPersistMailAttachment,
  writeFetchedAttachments,
} from "./imap-client.js";
export { sendSmtpMail } from "./smtp-client.js";
export { testGraphMailConnection, fetchGraphMessages, sendGraphMail } from "./graph-mail.js";
