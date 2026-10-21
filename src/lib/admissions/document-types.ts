/** The kinds of document an application or student file can hold. Lives here (not in the documents service) so the admissions policy can use it without a circular import. */
export const DOCUMENT_TYPES = ["BIRTH_CERTIFICATE", "PREVIOUS_REPORT", "PASSPORT_PHOTO", "TRANSFER_LETTER", "IDENTITY", "MEDICAL", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
