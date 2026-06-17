export type TotpRecord = {
  id: string;
  userId: string;
  secretEncrypted: string;
  enabledAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RecoveryCodeRecord = {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: Date;
  usedAt: Date | null;
  replacedAt: Date | null;
};

export type TotpSetup = {
  provisioningUri: string;
};

