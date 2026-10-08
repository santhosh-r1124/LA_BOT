'use client';

import type { AuthUser, TokenPair } from '@legal-platform/auth';
import { isTokenExpired } from '@legal-platform/auth';
import type { AdvocateProfile } from '@legal-platform/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiRequestError } from './api-client';
import {
  authClient,
  type AdvocateProfileUpdatePayload,
  type AdvocateRegisterPayload,
  type LoginPayload,
} from './auth-client';

const ACCESS_TOKEN_KEY = 'lp_advocate_access_token';
const REFRESH_TOKEN_KEY = 'lp_advocate_refresh_token';

/** Why a saved session could not be restored: the API did not answer. */
export type SessionIssue = 'network' | null;

interface AuthContextValue {
  user: AuthUser | null;
  profile: AdvocateProfile | null;
  accessToken: string | null;
  loading: boolean;
  /**
   * `'network'` when a saved session exists but the API could not be reached.
   * The saved tokens are kept, so {@link AuthContextValue.retrySession} can
   * pick up where the person left off once the API is back.
   */
  sessionIssue: SessionIssue;
  retrySession: () => Promise<void>;
  registerAdvocate: (payload: AdvocateRegisterPayload) => Promise<void>;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (payload: AdvocateProfileUpdatePayload) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredTokens(): { access: string | null; refresh: string | null } {
  if (typeof window === 'undefined') return { access: null, refresh: null };
  try {
    return {
      access: window.localStorage.getItem(ACCESS_TOKEN_KEY),
      refresh: window.localStorage.getItem(REFRESH_TOKEN_KEY),
    };
  } catch {
    return { access: null, refresh: null };
  }
}

function storeTokens(access: string | null, refresh: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (access) window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
    else window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    if (refresh) window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Private browsing / storage disabled — the session just won't survive a reload.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<AdvocateProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionIssue, setSessionIssue] = useState<SessionIssue>(null);
  const restoreStarted = useRef(false);

  const applyTokens = useCallback((access: string, refresh: string) => {
    setAccessToken(access);
    setRefreshToken(refresh);
    storeTokens(access, refresh);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setProfile(null);
    setAccessToken(null);
    setRefreshToken(null);
    setSessionIssue(null);
    storeTokens(null, null);
  }, []);

  const loadSession = useCallback(async (access: string) => {
    const [me, advocateProfile] = await Promise.all([
      authClient.me(access),
      authClient.advocateProfile(access),
    ]);
    setUser(me);
    setProfile(advocateProfile);
  }, []);

  /**
   * Brings back a saved session. A rejected session (expired, revoked, not an
   * advocate) is cleared; an unreachable API is not, so a restart of the API
   * does not sign anyone out.
   */
  const restoreSession = useCallback(async () => {
    const { access, refresh } = readStoredTokens();
    if (!access || !refresh) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let currentAccess = access;
      if (isTokenExpired(currentAccess)) {
        const pair = await authClient.refresh(refresh);
        currentAccess = pair.access_token;
        applyTokens(pair.access_token, pair.refresh_token);
      } else {
        setAccessToken(currentAccess);
        setRefreshToken(refresh);
      }
      await loadSession(currentAccess);
      setSessionIssue(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.isNetworkError) {
        setSessionIssue('network');
      } else {
        clearSession();
      }
    } finally {
      setLoading(false);
    }
  }, [applyTokens, clearSession, loadSession]);

  useEffect(() => {
    // Once only, even under React strict mode's double effect: refresh tokens
    // rotate, so a second refresh with the same token would sign the person out.
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void restoreSession();
  }, [restoreSession]);

  /** Applies a fresh token pair and loads the advocate profile behind it. */
  const establishSession = useCallback(
    async (pair: TokenPair) => {
      applyTokens(pair.access_token, pair.refresh_token);
      try {
        await loadSession(pair.access_token);
      } catch (err) {
        clearSession();
        if (err instanceof ApiRequestError && (err.status === 403 || err.status === 404)) {
          // A valid account that is not an advocate (for example a consumer account).
          void authClient.logout(pair.refresh_token).catch(() => undefined);
          throw new ApiRequestError(
            403,
            'not_an_advocate',
            "This email isn't registered as an advocate. Register as an advocate first.",
          );
        }
        throw err;
      }
    },
    [applyTokens, clearSession, loadSession],
  );

  const registerAdvocate = useCallback(
    async (payload: AdvocateRegisterPayload) => {
      await establishSession(await authClient.registerAdvocate(payload));
    },
    [establishSession],
  );

  const login = useCallback(
    async (payload: LoginPayload) => {
      await establishSession(await authClient.login(payload));
    },
    [establishSession],
  );

  const logout = useCallback(async () => {
    if (refreshToken) {
      try {
        await authClient.logout(refreshToken);
      } catch {
        // Best-effort — clear the local session regardless.
      }
    }
    clearSession();
  }, [refreshToken, clearSession]);

  /** The current access token, rotated first when it is about to expire. */
  const getValidAccessToken = useCallback(async (): Promise<string> => {
    if (!accessToken || !refreshToken) {
      throw new ApiRequestError(401, 'unauthorized', 'You are not signed in.');
    }
    if (!isTokenExpired(accessToken)) return accessToken;
    try {
      const pair = await authClient.refresh(refreshToken);
      applyTokens(pair.access_token, pair.refresh_token);
      return pair.access_token;
    } catch (err) {
      if (err instanceof ApiRequestError && !err.isNetworkError) {
        clearSession();
        throw new ApiRequestError(401, 'session_expired', 'Your session has expired. Log in again.');
      }
      throw err;
    }
  }, [accessToken, refreshToken, applyTokens, clearSession]);

  const updateProfile = useCallback(
    async (payload: AdvocateProfileUpdatePayload) => {
      const token = await getValidAccessToken();
      setProfile(await authClient.updateAdvocateProfile(token, payload));
    },
    [getValidAccessToken],
  );

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    await loadSession(await getValidAccessToken());
  }, [accessToken, getValidAccessToken, loadSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      accessToken,
      loading,
      sessionIssue,
      retrySession: restoreSession,
      registerAdvocate,
      login,
      logout,
      updateProfile,
      refresh,
    }),
    [
      user,
      profile,
      accessToken,
      loading,
      sessionIssue,
      restoreSession,
      registerAdvocate,
      login,
      logout,
      updateProfile,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
