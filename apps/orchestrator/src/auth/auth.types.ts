export const AUTH_REPOSITORY = 'AUTH_REPOSITORY';
export const PASSWORD_HASHER = 'PASSWORD_HASHER';
export const TOKEN_SERVICE = 'TOKEN_SERVICE';
export const AUTH_POLICY = 'AUTH_POLICY';
export const AUTH_CLOCK = 'AUTH_CLOCK';
export const JWT_CONFIG = 'JWT_CONFIG';

export type UserRole = 'ADMIN' | 'CAREGIVER' | 'VIEWER';

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string | null;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ClientContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface StoredRefreshToken extends RefreshTokenRecord {
  user: AuthUser;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSeconds: number;
  refreshExpiresAt: Date;
  refreshTokenId: string;
}

export interface TokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  tokenType: 'access' | 'refresh';
  jti: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthPolicy {
  maxLoginAttempts: number;
  lockDurationMinutes: number;
}

export interface JwtConfig {
  secret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  clearExpiredLock(userId: string): Promise<void>;
  recordFailedLogin(userId: string): Promise<number>;
  lockUser(userId: string, lockedUntil: Date, context: ClientContext): Promise<void>;
  recordSuccessfulLogin(userId: string, context: ClientContext): Promise<Date>;
  saveRefreshToken(record: RefreshTokenRecord): Promise<void>;
  findActiveRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null>;
  rotateRefreshToken(currentTokenId: string, nextToken: RefreshTokenRecord): Promise<boolean>;
  revokeRefreshToken(tokenHash: string, userId?: string): Promise<void>;
}

export interface PasswordHasher {
  verify(hash: string, plainText: string): Promise<boolean>;
}

export interface TokenService {
  issueTokenPair(user: AuthUser): TokenPair;
  verifyAccessToken(token: string): TokenClaims;
  verifyRefreshToken(token: string): TokenClaims;
}

export type AuthClock = () => Date;
