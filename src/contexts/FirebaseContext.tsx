import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  deleteMemoryFromFirestore,
  saveLiveConversationTurnToFirestore,
  saveMemoryToFirestore,
  saveWearableProfileToFirestore,
  signInWithGoogle,
  signOutFirebase,
  subscribeUserConversations,
  subscribeUserMemories,
  syncUserAccountToFirestore,
  testConnection,
  type LiveConversationLogItem,
  type LiveVoiceName,
} from '../lib/firebase';
import type { DeviceRuntimeConfig } from '../types/deviceProtocol';
import type { SentraMemoryItem, SentraSettings } from '../types/sentra';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  firestoreOnline: boolean;
  authError: string | null;
  firestoreMemories: SentraMemoryItem[];
  recentConversations: LiveConversationLogItem[];
  signIn: () => Promise<User | null>;
  signOut: () => Promise<void>;
  syncProfile: (settings: SentraSettings, preferredVoiceName?: LiveVoiceName) => Promise<void>;
  saveMemory: (item: {
    id?: string;
    label: string;
    note: string;
    room?: string;
    source?: SentraMemoryItem['source'];
  }) => Promise<void>;
  removeMemory: (id: string) => Promise<void>;
  saveWearableProfile: (params: {
    deviceId: string;
    friendlyName: string;
    firmwareVersion?: string | null;
    runtimeConfig: DeviceRuntimeConfig;
  }) => Promise<void>;
  logLiveConversationTurn: (params: {
    sessionId: string;
    deviceId: string;
    model: string;
    userTranscript: string;
    assistantTranscript: string;
    forwardDistanceCm: number | null;
  }) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreOnline, setFirestoreOnline] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firestoreMemories, setFirestoreMemories] = useState<SentraMemoryItem[]>([]);
  const [recentConversations, setRecentConversations] = useState<LiveConversationLogItem[]>([]);

  useEffect(() => {
    testConnection().then((res) => {
      setFirestoreOnline(res.ok);
      if (!res.ok && res.error) {
        setAuthError(res.error);
      }
    });

    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setFirestoreMemories([]);
        setRecentConversations([]);
      }
    });

    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const unsubMemories = subscribeUserMemories(
      user.uid,
      (items) => setFirestoreMemories(items),
      (err) => setAuthError(err.message)
    );
    const unsubConvs = subscribeUserConversations(
      user.uid,
      (items) => setRecentConversations(items),
      (err) => setAuthError(err.message)
    );
    return () => {
      unsubMemories();
      unsubConvs();
    };
  }, [authReady, user]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    try {
      return await signInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    try {
      await signOutFirebase();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
    }
  }, []);

  const syncProfile = useCallback(
    async (settings: SentraSettings, preferredVoiceName?: LiveVoiceName) => {
      if (!user) return;
      await syncUserAccountToFirestore({ user, settings, preferredVoiceName });
    },
    [user]
  );

  const saveMemory = useCallback(
    async (item: {
      id?: string;
      label: string;
      note: string;
      room?: string;
      source?: SentraMemoryItem['source'];
    }) => {
      if (!user) return;
      await saveMemoryToFirestore(user.uid, item);
    },
    [user]
  );

  const removeMemory = useCallback(
    async (id: string) => {
      if (!user) return;
      await deleteMemoryFromFirestore(id);
    },
    [user]
  );

  const saveWearableProfile = useCallback(
    async (params: {
      deviceId: string;
      friendlyName: string;
      firmwareVersion?: string | null;
      runtimeConfig: DeviceRuntimeConfig;
    }) => {
      if (!user) return;
      await saveWearableProfileToFirestore({
        uid: user.uid,
        ...params,
      });
    },
    [user]
  );

  const logLiveConversationTurn = useCallback(
    async (params: {
      sessionId: string;
      deviceId: string;
      model: string;
      userTranscript: string;
      assistantTranscript: string;
      forwardDistanceCm: number | null;
    }) => {
      if (!user) return;
      await saveLiveConversationTurnToFirestore({
        uid: user.uid,
        ...params,
      });
    },
    [user]
  );

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        firestoreOnline,
        authError,
        firestoreMemories,
        recentConversations,
        signIn,
        signOut,
        syncProfile,
        saveMemory,
        removeMemory,
        saveWearableProfile,
        logLiveConversationTurn,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside a FirebaseProvider');
  }
  return ctx;
}
