import AsyncStorage from '@react-native-async-storage/async-storage';

// Cache version - increment to invalidate all caches
const CACHE_VERSION = 1;

// TTL values in milliseconds (easy to change centrally)
export const CACHE_TTL = {
  profile: 10 * 60 * 1000, // 10 minutes
  dailyMetrics: 2 * 60 * 1000, // 2 minutes
  bodyState: 10 * 60 * 1000, // 10 minutes
  trends: 10 * 60 * 1000, // 10 minutes
  documents: 10 * 60 * 1000, // 10 minutes
  medications: 10 * 60 * 1000, // 10 minutes
} as const;

// Cache key prefixes
type CacheKey = keyof typeof CACHE_TTL;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: number;
}

class HomeCache {
  private static instance: HomeCache;
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private isDev = __DEV__;

  private constructor() {}

  static getInstance(): HomeCache {
    if (!HomeCache.instance) {
      HomeCache.instance = new HomeCache();
    }
    return HomeCache.instance;
  }

  // Build user-specific cache key
  private buildKey(userId: string, key: CacheKey): string {
    return `home:${userId}:${key}:v${CACHE_VERSION}`;
  }

  // Get cached data
  async get<T>(userId: string, key: CacheKey): Promise<{ data: T | null; fromCache: boolean; age: number }> {
    const cacheKey = this.buildKey(userId, key);
    const ttl = CACHE_TTL[key];

    // Check memory cache first
    const memoryEntry = this.memoryCache.get(cacheKey);
    if (memoryEntry) {
      const age = Date.now() - memoryEntry.timestamp;
      if (age < ttl) {
        if (this.isDev) {
          if (__DEV__) console.log(`[DashboardPerf] cacheHit=${key} cacheAge=${age}ms source=memory`);
        }
        return { data: memoryEntry.data, fromCache: true, age };
      }
    }

    // Check AsyncStorage
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      if (stored) {
        const entry: CacheEntry<T> = JSON.parse(stored);
        const age = Date.now() - entry.timestamp;
        
        // Update memory cache
        this.memoryCache.set(cacheKey, entry);
        
        if (age < ttl) {
          if (this.isDev) {
            if (__DEV__) console.log(`[DashboardPerf] cacheHit=${key} cacheAge=${age}ms source=storage`);
          }
          return { data: entry.data, fromCache: true, age };
        }
      }
    } catch (error) {
      if (this.isDev) {
        console.error(`[DashboardPerf] cacheReadError=${key}`, error);
      }
    }

    return { data: null, fromCache: false, age: 0 };
  }

  // Set cached data
  async set<T>(userId: string, key: CacheKey, data: T): Promise<void> {
    const cacheKey = this.buildKey(userId, key);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };

    // Update memory cache
    this.memoryCache.set(cacheKey, entry);

    // Persist to AsyncStorage
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
      if (this.isDev) {
        if (__DEV__) console.log(`[DashboardPerf] cacheSet=${key} timestamp=${entry.timestamp}`);
      }
    } catch (error) {
      if (this.isDev) {
        console.error(`[DashboardPerf] cacheWriteError=${key}`, error);
      }
    }
  }

  // Check if data is stale
  isStale(userId: string, key: CacheKey): boolean {
    const cacheKey = this.buildKey(userId, key);
    const entry = this.memoryCache.get(cacheKey);
    if (!entry) return true;
    
    const age = Date.now() - entry.timestamp;
    return age >= CACHE_TTL[key];
  }

  // Clear cache for a specific user
  async clearUserCache(userId: string): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const userKeys = keys.filter(key => key.startsWith(`home:${userId}:`));
      if (userKeys.length > 0) {
        await AsyncStorage.multiRemove(userKeys);
      }
      
      // Clear memory cache for this user
      for (const key of this.memoryCache.keys()) {
        if (key.startsWith(`home:${userId}:`)) {
          this.memoryCache.delete(key);
        }
      }
      
      if (this.isDev) {
        if (__DEV__) console.log(`[DashboardPerf] clearUserCache userId=${userId} keysCleared=${userKeys.length}`);
      }
    } catch (error) {
      if (this.isDev) {
        console.error(`[DashboardPerf] clearUserCacheError`, error);
      }
    }
  }

  // Clear all caches (useful for logout)
  async clearAll(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith('home:'));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
      
      this.memoryCache.clear();
      
      if (this.isDev) {
        if (__DEV__) console.log(`[DashboardPerf] clearAll keysCleared=${cacheKeys.length}`);
      }
    } catch (error) {
      if (this.isDev) {
        console.error(`[DashboardPerf] clearAllError`, error);
      }
    }
  }
}

export const homeCache = HomeCache.getInstance();