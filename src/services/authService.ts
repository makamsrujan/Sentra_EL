/**
 * Client Authentication & Database Sync Service
 */

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

const TOKEN_KEY = 'sentra_auth_token';
const USER_KEY = 'sentra_auth_user';

class AuthService {
  private user: User | null = null;
  private token: string | null = null;
  private listeners: Array<(state: AuthState) => void> = [];

  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    if (storedUser) {
      try {
        this.user = JSON.parse(storedUser);
      } catch {
        this.user = null;
      }
    }

    // Verify token validity on boot if present
    if (this.token) {
      this.fetchCurrentUser().catch(() => {
        this.logout();
      });
    }
  }

  public getState(): AuthState {
    return {
      user: this.user,
      token: this.token,
      isAuthenticated: Boolean(this.token && this.user),
    };
  }

  public subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    listener(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  public async register(email: string, password: string, name: string): Promise<User> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    this.token = data.token;
    this.user = data.user;
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    this.notify();
    return data.user;
  }

  public async login(email: string, password: string): Promise<User> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Login failed');
    }

    this.token = data.token;
    this.user = data.user;
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    this.notify();
    return data.user;
  }

  public async fetchCurrentUser(): Promise<User | null> {
    if (!this.token) return null;

    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!res.ok) {
      this.logout();
      return null;
    }

    const data = await res.json();
    if (data.ok && data.user) {
      this.user = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.notify();
      return data.user;
    }

    return null;
  }

  public logout() {
    this.user = null;
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.notify();
  }

  public getToken(): string | null {
    return this.token;
  }

  // Database Memory Sync
  public async syncMemoriesToDatabase(memories: any[]): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await fetch('/api/memories/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ items: memories }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Fetch Memories from Database
  public async fetchMemoriesFromDatabase(): Promise<any[]> {
    if (!this.token) return [];
    try {
      const res = await fetch('/api/memories', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = await res.json();
      return data.ok && Array.isArray(data.memories) ? data.memories : [];
    } catch {
      return [];
    }
  }

  // Save Settings to Database
  public async saveUserSettings(settings: any): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await fetch('/api/user/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(settings),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Load Settings from Database
  public async loadUserSettings(): Promise<any | null> {
    if (!this.token) return null;
    try {
      const res = await fetch('/api/user/settings', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = await res.json();
      return data.ok ? data.settings : null;
    } catch {
      return null;
    }
  }
}

export const authService = new AuthService();
