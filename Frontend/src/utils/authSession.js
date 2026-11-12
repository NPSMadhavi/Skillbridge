const STUDENT_KEY = 'skillbridge_user';

function readRaw(storage) {
  try {
    return storage.getItem(STUDENT_KEY);
  } catch {
    return null;
  }
}

function parseSession(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const user = data.user;
    if (!user || typeof user !== 'object') return null;
    const hasIdentity = Boolean(
      user.id ||
      user.email ||
      user.fullName ||
      user.name ||
      user.firstName
    );
    if (!hasIdentity) return null;
    if (!data.token) return null;
    try {
      const parts = data.token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.exp && Date.now() >= payload.exp * 1000) {
          return null;
        }
      }
    } catch (_) {}
    return data;
  } catch {
    return null;
  }
}

/** Clears a broken or demo student session from both storages. */
export function clearStudentSession() {
  try {
    sessionStorage.removeItem(STUDENT_KEY);
    localStorage.removeItem(STUDENT_KEY);
    sessionStorage.removeItem('skillbridge_tenant');
    localStorage.removeItem('skillbridge_tenant');
  } catch {
    /* ignore */
  }
}

/**
 * Returns a valid logged-in student session, or null.
 * Never invents a demo "James" user. Invalid/stale storage is cleared.
 */
export function getStudentSession() {
  const sessionRaw = readRaw(sessionStorage);
  const localRaw = readRaw(localStorage);

  const fromSession = parseSession(sessionRaw);
  if (fromSession) {
    const tenantCode = fromSession.tenant?.code || fromSession.user?.tenantCode;
    if (tenantCode && tenantCode !== 'default') {
      try {
        sessionStorage.setItem('skillbridge_tenant', tenantCode);
        localStorage.setItem('skillbridge_tenant', tenantCode);
      } catch (_) {}
    }
    return fromSession;
  }

  const fromLocal = parseSession(localRaw);
  if (fromLocal) {
    try {
      sessionStorage.setItem(STUDENT_KEY, JSON.stringify(fromLocal));
      const tenantCode = fromLocal.tenant?.code || fromLocal.user?.tenantCode;
      if (tenantCode && tenantCode !== 'default') {
        sessionStorage.setItem('skillbridge_tenant', tenantCode);
        localStorage.setItem('skillbridge_tenant', tenantCode);
      }
    } catch {
      /* ignore */
    }
    return fromLocal;
  }

  // Stale keys like "{}" or demo payloads without a real token — drop them
  if (sessionRaw || localRaw) {
    clearStudentSession();
  }
  return null;
}

export function getStudentUser() {
  return getStudentSession()?.user || null;
}

export function isStudentAuthenticated() {
  return Boolean(getStudentSession());
}

export function getStudentDisplayName(user, fallback = 'Learner') {
  if (!user) return fallback;
  if (user.fullName) return user.fullName;
  if (user.name) return user.name;
  const combined = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return combined || user.email || fallback;
}
