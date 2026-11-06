import {
  SecretProviderMismatchError,
  type SealedSecret,
  type SecretBox,
  type SecretContext,
} from "./types";

/**
 * Local development only: stores the secret as is, without encryption.
 * `getSecretBox()` never returns it in production.
 */
export const plaintextSecretBox: SecretBox = {
  provider: "plaintext",

  async seal(plaintext: string, _context: SecretContext): Promise<SealedSecret> {
    return { v: 1, provider: "plaintext", value: plaintext };
  },

  async open(sealed: SealedSecret, _context: SecretContext): Promise<string> {
    if (sealed.provider !== "plaintext") {
      throw new SecretProviderMismatchError("plaintext", sealed.provider);
    }
    return sealed.value;
  },
};
