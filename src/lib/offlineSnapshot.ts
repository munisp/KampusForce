export type OfflineSnapshot<T> = { userId: number; savedAt: string; data: T };

const PRIVATE_PREFIX = "kf_private_snapshot:";

export function readOfflineSnapshot<T>(name: string, userId: number): OfflineSnapshot<T> | null {
  try {
    const snapshot = JSON.parse(localStorage.getItem(`${PRIVATE_PREFIX}${name}`) || "null") as OfflineSnapshot<T> | null;
    return snapshot?.userId === userId && snapshot.data ? snapshot : null;
  } catch {
    return null;
  }
}

export function writeOfflineSnapshot<T>(name: string, userId: number, data: T) {
  const snapshot: OfflineSnapshot<T> = { userId, savedAt: new Date().toISOString(), data };
  localStorage.setItem(`${PRIVATE_PREFIX}${name}`, JSON.stringify(snapshot));
}

export function clearPrivateOfflineSnapshots() {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PRIVATE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}
