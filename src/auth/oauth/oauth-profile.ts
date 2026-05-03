export enum OAuthProvider {
  Google = 'google',
  Apple = 'apple',
}

export type OAuthIdentityProfile = {
  provider: OAuthProvider;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  isEmailAuthoritative: boolean;
};
