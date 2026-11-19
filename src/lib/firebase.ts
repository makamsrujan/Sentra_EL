import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { DeviceRuntimeConfig } from '../types/deviceProtocol';
import type { SentraMemoryItem, SentraSettings } from '../types/sentra';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export const BLUEPRINT_LIMITS = {
  idPattern: /^[a-zA-Z0-9_-]+$/,
  idMaxLength: 128,
  deviceIdMaxLength: 64,
  displayNameMaxLength: 80,
  emailMaxLength: 160,
  memoryLabelMaxLength: 120,
  memoryNoteMaxLength: 1000,
  memoryRoomMaxLength: 80,
  friendlyNameMaxLength: 80,
  firmwareVersionMaxLength: 40,
  userTranscriptMaxLength: 2000,
  assistantTranscriptMaxLength: 4000,
  allowedVoices: ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'] as const,
} as const;

export type LiveVoiceName = (typeof BLUEPRINT_LIMITS.allowedVoices)[number];

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { ok: false, error: 'Firestore client is offline. Check Firebase configuration.' };
    }
    // Permission denied on locked 'test/connection' still confirms online Firestore reachability
    return { ok: true };
  }
}

function sanitizeId(
  raw: string,
  fallbackPrefix = 'id',
  maxLen: number = BLUEPRINT_LIMITS.idMaxLength
): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, maxLen);
  if (cleaned && BLUEPRINT_LIMITS.idPattern.test(cleaned)) return cleaned;
  return `${fallbackPrefix}-${Date.now()}`.slice(0, maxLen);
}

function clampString(value: string, maxLen: number, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback.slice(0, maxLen);
  return trimmed.slice(0, maxLen);
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleAuthProvider);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
}

export async function syncUserAccountToFirestore(params: {
  user: User;
  settings: SentraSettings;
  preferredVoiceName?: LiveVoiceName;
}): Promise<void> {
  const { user, settings } = params;
  const uid = sanitizeId(user.uid, 'user', BLUEPRINT_LIMITS.idMaxLength);
  const voice: LiveVoiceName =
    params.preferredVoiceName &&
    (BLUEPRINT_LIMITS.allowedVoices as readonly string[]).includes(params.preferredVoiceName)
      ? params.preferredVoiceName
      : 'Zephyr';

  const settingsDocRef = doc(db, 'users', uid);
  const privateDocRef = doc(db, 'users', uid, 'private', 'profile');

  try {
    let existingCreatedAt: unknown = null;
    try {
      const snap = await getDocFromServer(settingsDocRef);
      if (snap.exists()) {
        existingCreatedAt = snap.data()?.createdAt ?? null;
      }
    } catch {
      existingCreatedAt = null;
    }

    const baseSettingsPayload = {
      uid,
      displayName: clampString(
        user.displayName || user.email?.split('@')[0] || 'SENTRA User',
        BLUEPRINT_LIMITS.displayNameMaxLength,
        'SENTRA User'
      ),
      speechRate: Math.min(2.0, Math.max(0.5, Number(settings.speechRate) || 1.05)),
      voiceVolume: Math.min(1, Math.max(0, Number(settings.voiceVolume) || 0.9)),
      voiceMuted: Boolean(settings.voiceMuted),
      audioFeedback: Boolean(settings.audioFeedback),
      reachGuidanceEnabled: Boolean(settings.reachGuidanceEnabled),
      preferredVoiceName: voice,
      selectedWearableDeviceId: sanitizeId(
        settings.selectedWearableDeviceId || 'ESP32-S3-SENTRA-001',
        'ESP32',
        BLUEPRINT_LIMITS.deviceIdMaxLength
      ),
      createdAt: existingCreatedAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(settingsDocRef, baseSettingsPayload, { merge: Boolean(existingCreatedAt) });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }

  if (user.email) {
    try {
      let existingPrivateCreatedAt: unknown = null;
      try {
        const snap = await getDocFromServer(privateDocRef);
        if (snap.exists()) {
          existingPrivateCreatedAt = snap.data()?.createdAt ?? null;
        }
      } catch {
        existingPrivateCreatedAt = null;
      }

      await setDoc(
        privateDocRef,
        {
          uid,
          email: clampString(user.email, BLUEPRINT_LIMITS.emailMaxLength, 'user@example.com'),
          createdAt: existingPrivateCreatedAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: Boolean(existingPrivateCreatedAt) }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}/private/profile`);
    }
  }
}

export function subscribeUserMemories(
  uid: string,
  onData: (items: SentraMemoryItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeUid = sanitizeId(uid, 'user');
  const q = query(collection(db, 'memories'), where('userId', '==', safeUid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: SentraMemoryItem[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const tsMillis =
          typeof d.updatedAt?.toMillis === 'function'
            ? d.updatedAt.toMillis()
            : typeof d.createdAt?.toMillis === 'function'
            ? d.createdAt.toMillis()
            : Date.now();
        return {
          id: docSnap.id,
          label: String(d.label || 'Saved Location'),
          note: String(d.note || ''),
          room: String(d.room || 'Current Area'),
          source:
            d.source === 'live_verified' ||
            d.source === 'remembered_historical' ||
            d.source === 'user_manual'
              ? d.source
              : 'user_manual',
          timestamp: tsMillis,
          at: new Date(tsMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          heading: null,
        };
      });
      items.sort((a, b) => b.timestamp - a.timestamp);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'memories');
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export async function saveMemoryToFirestore(
  uid: string,
  item: {
    id?: string;
    label: string;
    note: string;
    room?: string;
    source?: SentraMemoryItem['source'];
  }
): Promise<string> {
  const safeUid = sanitizeId(uid, 'user');
  const docId = sanitizeId(item.id || `mem-${Date.now()}`, 'mem');
  const ref = doc(db, 'memories', docId);

  try {
    await setDoc(ref, {
      userId: safeUid,
      label: clampString(item.label, BLUEPRINT_LIMITS.memoryLabelMaxLength, 'Saved Location'),
      note: clampString(item.note, BLUEPRINT_LIMITS.memoryNoteMaxLength, 'No details'),
      room: clampString(item.room || 'Current Area', BLUEPRINT_LIMITS.memoryRoomMaxLength, 'Current Area'),
      source:
        item.source === 'live_verified' ||
        item.source === 'remembered_historical' ||
        item.source === 'user_manual'
          ? item.source
          : 'user_manual',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `memories/${docId}`);
  }
}

export async function deleteMemoryFromFirestore(memoryId: string): Promise<void> {
  const docId = sanitizeId(memoryId, 'mem');
  try {
    await deleteDoc(doc(db, 'memories', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `memories/${docId}`);
  }
}

export async function saveWearableProfileToFirestore(params: {
  uid: string;
  deviceId: string;
  friendlyName: string;
  firmwareVersion?: string | null;
  runtimeConfig: DeviceRuntimeConfig;
}): Promise<void> {
  const safeUid = sanitizeId(params.uid, 'user');
  const safeDeviceId = sanitizeId(params.deviceId, 'ESP32', BLUEPRINT_LIMITS.deviceIdMaxLength);
  const ref = doc(db, 'wearableDevices', safeDeviceId);

  try {
    let existingCreatedAt: unknown = null;
    try {
      const snap = await getDocFromServer(ref);
      if (snap.exists()) {
        existingCreatedAt = snap.data()?.createdAt ?? null;
      }
    } catch {
      existingCreatedAt = null;
    }

    await setDoc(
      ref,
      {
        userId: safeUid,
        deviceId: safeDeviceId,
        friendlyName: clampString(
          params.friendlyName || safeDeviceId,
          BLUEPRINT_LIMITS.friendlyNameMaxLength,
          safeDeviceId
        ),
        firmwareVersion: clampString(
          params.firmwareVersion || '1.0.0',
          BLUEPRINT_LIMITS.firmwareVersionMaxLength,
          '1.0.0'
        ),
        frameSize:
          params.runtimeConfig.frameSize === 'QVGA' ||
          params.runtimeConfig.frameSize === 'VGA' ||
          params.runtimeConfig.frameSize === 'SVGA'
            ? params.runtimeConfig.frameSize
            : 'VGA',
        jpegQuality: Math.min(63, Math.max(4, Math.round(params.runtimeConfig.jpegQuality || 12))),
        tofSampleIntervalMs: Math.min(
          5000,
          Math.max(50, Math.round(params.runtimeConfig.tofSampleIntervalMs || 250))
        ),
        proximityCriticalCm: Math.min(
          250,
          Math.max(10, Math.round(params.runtimeConfig.proximityCriticalCm || 45))
        ),
        createdAt: existingCreatedAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: Boolean(existingCreatedAt) }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `wearableDevices/${safeDeviceId}`);
  }
}

export async function saveLiveConversationTurnToFirestore(params: {
  uid: string;
  sessionId: string;
  deviceId: string;
  model: string;
  userTranscript: string;
  assistantTranscript: string;
  forwardDistanceCm: number | null;
}): Promise<void> {
  const safeUid = sanitizeId(params.uid, 'user');
  const safeSessionId = sanitizeId(params.sessionId, 'conv');
  const safeDeviceId = sanitizeId(params.deviceId || 'browser', 'browser', BLUEPRINT_LIMITS.deviceIdMaxLength);
  const ref = doc(db, 'conversations', safeSessionId);

  const clampedDistance =
    params.forwardDistanceCm !== null && Number.isFinite(params.forwardDistanceCm)
      ? Math.min(2000, Math.max(0, Math.round(params.forwardDistanceCm)))
      : -1;

  try {
    await setDoc(ref, {
      userId: safeUid,
      deviceId: safeDeviceId,
      model: clampString(params.model || 'gemini-3.8-live', 64, 'gemini-3.8-live'),
      userTranscript: params.userTranscript.trim().slice(0, BLUEPRINT_LIMITS.userTranscriptMaxLength),
      assistantTranscript: clampString(
        params.assistantTranscript,
        BLUEPRINT_LIMITS.assistantTranscriptMaxLength,
        'Live response complete.'
      ),
      forwardDistanceCm: clampedDistance,
      status: 'completed',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `conversations/${safeSessionId}`);
  }
}

export interface LiveConversationLogItem {
  id: string;
  deviceId: string;
  model: string;
  userTranscript: string;
  assistantTranscript: string;
  forwardDistanceCm: number | null;
  timestamp: number;
}

export function subscribeUserConversations(
  uid: string,
  onData: (items: LiveConversationLogItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeUid = sanitizeId(uid, 'user');
  const q = query(collection(db, 'conversations'), where('userId', '==', safeUid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: LiveConversationLogItem[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const tsMillis =
          typeof d.createdAt?.toMillis === 'function' ? d.createdAt.toMillis() : Date.now();
        return {
          id: docSnap.id,
          deviceId: String(d.deviceId || 'browser'),
          model: String(d.model || 'gemini-3.8-live'),
          userTranscript: String(d.userTranscript || ''),
          assistantTranscript: String(d.assistantTranscript || ''),
          forwardDistanceCm:
            typeof d.forwardDistanceCm === 'number' && d.forwardDistanceCm >= 0
              ? d.forwardDistanceCm
              : null,
          timestamp: tsMillis,
        };
      });
      items.sort((a, b) => b.timestamp - a.timestamp);
      onData(items.slice(0, 25));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'conversations');
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}
